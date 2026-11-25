import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Id } from '@meetless/core';
import { MAX_IMPORT_BYTES, pdfPages } from '../imports/extract';
import type { SyncService } from '../service';

const ACTOR = 'system:pdf-text';

/** Per-version cap (brief): total extracted text, across all pages, is capped at this many characters. */
export const MAX_PDF_TEXT_CHARS = 500_000;

/** A parse that runs longer than this is abandoned and recorded as `status: 'failed', error: 'timeout'` (while not stopped). Injectable (`PdfTextWorkerOptions.parseTimeoutMs`) so tests don't wait a real minute. */
export const PARSE_TIMEOUT_MS = 60_000;

/** `stop()`'s upper bound on waiting for an in-flight parse before returning anyway. Injectable (`PdfTextWorkerOptions.stopGraceMs`) so tests don't wait real seconds. */
export const STOP_GRACE_MS = 2_000;

/**
 * `unpdf/<installed version>`, read from the installed package's own `package.json`
 * (walking up from the resolved entry file, since unpdf's `exports` map does not expose
 * `./package.json` directly). Resolved once at module load; `'unpdf/unknown'` if for any
 * reason the installed package cannot be found this way.
 */
function resolveUnpdfConverter(): string {
  try {
    const require = createRequire(import.meta.url);
    let dir = dirname(require.resolve('unpdf'));
    for (let i = 0; i < 6; i++) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string; version?: string };
        if (pkg.name === 'unpdf' && pkg.version) return `unpdf/${pkg.version}`;
      } catch {
        // not the package root yet (or no package.json here); keep walking up
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // require.resolve itself failed; fall through to the unknown marker below
  }
  return 'unpdf/unknown';
}

export const UNPDF_CONVERTER = resolveUnpdfConverter();

/** CRLF -> LF, then trimmed. An all-whitespace page becomes `''`, same as a page with no text at all. */
function cleanPage(raw: string): string {
  return raw.replace(/\r\n/g, '\n').trim();
}

/**
 * Caps the total of `texts` (joined length) at `cap` characters: pages before the
 * boundary are returned unchanged, the one page that crosses it is truncated to fit
 * exactly, and every page after that becomes `''` — the page count (and so each page's
 * index) is never changed by capping.
 */
export function capTexts(texts: string[], cap: number = MAX_PDF_TEXT_CHARS): string[] {
  let total = 0;
  const out: string[] = [];
  for (const t of texts) {
    if (total >= cap) {
      out.push('');
      continue;
    }
    const remaining = cap - total;
    if (t.length <= remaining) {
      out.push(t);
      total += t.length;
    } else {
      out.push(t.slice(0, remaining));
      total = cap;
    }
  }
  return out;
}

/** Thrown by `parseWithTimeout` when `parse()` has not settled within `parseTimeoutMs`. Never escapes the worker: `process()` always catches it. */
class ParseTimeoutError extends Error {
  constructor() {
    super('pdf parse timed out');
  }
}

/** A timer-backed delay, `unref`'d so a pending one never keeps a test process (or the real server) alive on its own. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as unknown as { unref?: () => void }).unref?.();
  });
}

export interface PdfTextWorkerOptions {
  log?: (msg: string) => void;
  /** Defaults to `pdfPages` (unpdf). Injectable so tests exercise the grace/timeout paths without a real hung parse. */
  parse?: (bytes: Uint8Array) => Promise<string[]>;
  /** Default `PARSE_TIMEOUT_MS`. */
  parseTimeoutMs?: number;
  /** Default `STOP_GRACE_MS`. */
  stopGraceMs?: number;
}

interface FoundVersion {
  artifactId: Id;
  blobHash: string;
}

/**
 * Server-side PDF text extraction (contract §12.21). For every `pdf` artifact version
 * with a `blobHash` and no `derived` yet, it reads the blob bytes and extracts per-page
 * text in-process with unpdf (the same `pdfPages` helper `extractText('pdf', …)` uses,
 * Task 5), then records `artifactVersion.derived` as the system actor `system:pdf-text`.
 * Unlike the office worker there is no external converter service, no page images, and
 * no content-hash cache: parsing a PDF is local, synchronous CPU work.
 *
 * Core's `eventScope` gives `artifactVersion.derived` the artifact's own scope, so a
 * private artifact's extracted text reaches only that artifact's owner. Each version is
 * processed at most once: `find()` skips (returns null for) a version that already has
 * `derived`, so a restart's recovery scan never re-extracts it.
 *
 * `stop()` cannot truly cancel a parse the way the office worker aborts its `fetch`:
 * unpdf has no cancellation hook. Instead each parse is bounded by `parseTimeoutMs`
 * (abandoned and recorded as `error: 'timeout'` if it runs longer, as long as the worker
 * has not been stopped meanwhile), and `stop()` itself waits at most `stopGraceMs` for
 * the in-flight parse before returning regardless. Either way nothing is recorded for a
 * parse that only settles after `stop()` has returned — `record()` checks a `stopped`
 * flag first — so that version's `derived` stays `null` and a later `start()` retries it.
 *
 * A parse that timed out is still running in-process, so the queue waits for it to settle
 * before starting the next one (at most one parse is ever running; `stop()`'s grace still
 * bounds shutdown). A blob bigger than `MAX_IMPORT_BYTES` is never read or parsed: it is
 * recorded as `status: 'failed', error: 'too_large'` from its meta size alone.
 */
export class PdfTextWorker {
  private queue: Id[] = [];
  private queued = new Set<Id>();
  private running: Promise<void> | null = null;
  private off: (() => void) | null = null;
  private stopped = false;
  /**
   * A parse that timed out keeps running in-process (unpdf cannot be cancelled): the queue does
   * not start the next parse until it settles, so a run of slow PDFs never piles up parses.
   */
  private lingering: Promise<void> | null = null;
  private readonly parse: (bytes: Uint8Array) => Promise<string[]>;

  constructor(
    private readonly svc: SyncService,
    private readonly opts: PdfTextWorkerOptions = {},
  ) {
    this.parse = opts.parse ?? pdfPages;
  }

  start(): void {
    this.stopped = false;
    this.off = this.svc.onAppended((se) => {
      if (se.event.type === 'artifact.version_added' && se.event.payload.blobHash) this.enqueue(se.event.payload.versionId);
    });
    // Restart recovery: any pdf version with a blob that has not been extracted yet.
    for (const a of Object.values(this.svc.current.artifacts)) {
      if (a.kind !== 'pdf') continue;
      for (const v of a.versions) {
        if (v.blobHash && !v.derived) this.enqueue(v.id);
      }
    }
  }

  /**
   * Unsubscribes, drops whatever is still queued, and gives the in-flight parse (if any)
   * up to `stopGraceMs` to finish before returning anyway. Sets the `stopped` flag first
   * (before anything async), so a parse that only resolves afterwards — whether it just
   * runs long or truly hangs — is guaranteed to record nothing once this has returned.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    this.off?.();
    this.off = null;
    this.queue = [];
    this.queued.clear();
    if (this.running) await Promise.race([this.running, delay(this.opts.stopGraceMs ?? STOP_GRACE_MS)]);
  }

  /** Looks up a pdf version by id; `null` if it is not a pdf, has no blob yet, or already has `derived`. */
  private find(versionId: Id): FoundVersion | null {
    for (const a of Object.values(this.svc.current.artifacts)) {
      if (a.kind !== 'pdf') continue;
      const v = a.versions.find((x) => x.id === versionId);
      if (!v) continue;
      if (!v.blobHash || v.derived) return null;
      return { artifactId: a.id, blobHash: v.blobHash };
    }
    return null;
  }

  private enqueue(versionId: Id): void {
    if (this.queued.has(versionId)) return;
    if (!this.find(versionId)) return;
    this.queued.add(versionId);
    this.queue.push(versionId);
    if (!this.running) {
      this.running = this.drain().finally(() => {
        this.running = null;
      });
    }
  }

  private async drain(): Promise<void> {
    for (;;) {
      // stop()'s grace bounds how long shutdown waits on this.
      while (this.lingering) {
        const l = this.lingering;
        await l;
        if (this.lingering === l) this.lingering = null;
      }
      const id = this.queue.shift();
      if (!id) return;
      try {
        await this.process(id);
      } catch (e) {
        this.opts.log?.(`[pdf-text] ${id}: ${(e as Error).message}`);
      } finally {
        this.queued.delete(id);
      }
    }
  }

  /**
   * Races `parse(bytes)` against `parseTimeoutMs`; rejects with `ParseTimeoutError` if the timer
   * wins, leaving the still-running parse in `lingering` for `drain` to wait on.
   */
  private async parseWithTimeout(bytes: Uint8Array): Promise<string[]> {
    const timeoutMs = this.opts.parseTimeoutMs ?? PARSE_TIMEOUT_MS;
    let timer!: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new ParseTimeoutError()), timeoutMs);
      (timer as unknown as { unref?: () => void }).unref?.();
    });
    let parsing: Promise<string[]>;
    try {
      parsing = this.parse(bytes);
    } catch (e) {
      parsing = Promise.reject(e);
    }
    try {
      return await Promise.race([parsing, timeout]);
    } catch (e) {
      if (e instanceof ParseTimeoutError) {
        this.lingering = parsing.then(
          () => undefined,
          () => undefined,
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  private async process(versionId: Id): Promise<void> {
    const found = this.find(versionId);
    if (!found) return;
    const { artifactId, blobHash } = found;

    // Too big to parse in-process: refused on its size alone, before any byte is read.
    const meta = await this.svc.blobMeta.get(blobHash);
    if (meta && meta.size > MAX_IMPORT_BYTES) {
      this.opts.log?.(`[pdf-text] ${versionId}: blob ${blobHash} is ${meta.size} bytes, over ${MAX_IMPORT_BYTES}`);
      await this.record(artifactId, versionId, { status: 'failed', texts: [], error: 'too_large', converter: null });
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = await this.svc.blobFiles.readBytes(blobHash);
    } catch (e) {
      this.opts.log?.(`[pdf-text] ${versionId}: blob ${blobHash} missing: ${(e as Error).message}`);
      await this.record(artifactId, versionId, { status: 'failed', texts: [], error: 'no_file', converter: null });
      return;
    }

    let pages: string[];
    try {
      pages = await this.parseWithTimeout(bytes);
    } catch (e) {
      const timedOut = e instanceof ParseTimeoutError;
      this.opts.log?.(`[pdf-text] ${versionId}: ${(e as Error).message}`);
      await this.record(artifactId, versionId, { status: 'failed', texts: [], error: timedOut ? 'timeout' : 'corrupt', converter: UNPDF_CONVERTER });
      return;
    }

    const cleaned = capTexts(pages.map(cleanPage));
    if (!cleaned.some((t) => t.length > 0)) {
      await this.record(artifactId, versionId, { status: 'failed', texts: [], error: 'no_text', converter: UNPDF_CONVERTER });
      return;
    }
    await this.record(artifactId, versionId, { status: 'ready', texts: cleaned, error: null, converter: UNPDF_CONVERTER });
  }

  private async record(
    artifactId: Id,
    versionId: Id,
    p: { status: 'ready' | 'partial' | 'failed'; texts: string[]; error: string | null; converter: string | null },
  ): Promise<void> {
    // stop() sets this synchronously before anything async, so a parse (or its timeout)
    // that only settles after stop() has returned always finds this true and writes nothing.
    if (this.stopped) return;
    await this.svc.appendSystem(ACTOR, { id: randomUUID(), type: 'artifactVersion.derived', payload: { artifactId, versionId, pageHashes: [], ...p } });
  }
}
