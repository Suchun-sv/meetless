import { randomUUID } from 'node:crypto';
import type { Id } from '@meetless/core';
import type { SyncService } from '../service';

/** Converter output (infra/dev/office/convert_server.py). */
export interface ConvertResponse {
  status: 'ready' | 'partial' | 'failed';
  error?: string;
  converter: string;
  kind: string;
  pages: { index: number; png: string }[];
  slides: { index: number; slideId: number; title: string; text: string; notes: string; hidden: boolean }[];
  blocks: { index: number; kind: string; style: string; text: string }[];
  unparsed: string[];
}

/** Content-addressed manifest of one conversion (stored as a JSON blob; keyed by source hash + kind + converter). */
export interface OfficeManifest {
  format: 'meetless.office-derivation';
  formatVersion: 1;
  sourceHash: string;
  kind: 'pptx' | 'docx';
  converter: string;
  status: 'ready' | 'partial' | 'failed';
  error: string | null;
  pageHashes: string[];
  texts: string[];
}

export interface OfficeWorkerOptions {
  /** meetless-office base URL, e.g. http://127.0.0.1:55434 */
  url: string;
  fetch?: typeof fetch;
  attempts?: number;
  retryDelayMs?: number;
  log?: (msg: string) => void;
}

const ACTOR = 'system:office';
export const CONVERTER_UNAVAILABLE = 'converter_unavailable';

interface FoundVersion {
  artifactId: Id;
  kind: 'pptx' | 'docx';
  blobHash: string;
  derived: { status: 'ready' | 'partial' | 'failed'; error: string | null } | null;
}

/**
 * Server-side conversion worker (design §7). For every pptx/docx artifact
 * version with a blobHash it obtains page images + per-slide/block text from
 * the meetless-office service, stores the images as content-addressed blobs
 * (cached by source hash + kind + converter), and records
 * `artifactVersion.derived` as the system actor `system:office`. Core's
 * `eventScope` gives that event the artifact's own scope, so a private
 * artifact's preview reaches only the artifact's owner. Failure is recorded
 * explicitly; clients then offer the original file.
 */
export class OfficeWorker {
  private queue: Id[] = [];
  private queued = new Set<Id>();
  private running: Promise<void> | null = null;
  private converter: string | null = null;
  private off: (() => void) | null = null;
  private readonly fetch: typeof fetch;
  private abortController: AbortController | null = null;

  constructor(
    private readonly svc: SyncService,
    private readonly opts: OfficeWorkerOptions,
  ) {
    this.fetch = opts.fetch ?? fetch;
  }

  start(): void {
    this.abortController = new AbortController();
    this.off = this.svc.onAppended((se) => {
      if (se.event.type === 'artifact.version_added' && se.event.payload.blobHash) this.enqueue(se.event.payload.versionId);
    });
    // Restart recovery: anything not converted yet, or that failed only because the converter was down.
    for (const a of Object.values(this.svc.current.artifacts)) {
      if (a.kind !== 'pptx' && a.kind !== 'docx') continue;
      for (const v of a.versions) {
        if (v.blobHash && (!v.derived || (v.derived.status === 'failed' && v.derived.error === CONVERTER_UNAVAILABLE))) this.enqueue(v.id);
      }
    }
  }

  /**
   * Unsubscribes, drops whatever is still queued, and aborts the in-flight
   * fetch (health check or `/convert`) through the `AbortController` whose
   * signal every worker fetch carries. An aborted conversion records nothing:
   * its version has no `derived` yet, so the next `start()` re-queues it.
   */
  async stop(): Promise<void> {
    this.off?.();
    this.off = null;
    this.queue = [];
    this.queued.clear();
    this.abortController?.abort();
    if (this.running) await this.running;
  }

  /** Resolves when the queue is empty (tests). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private find(versionId: Id): FoundVersion | null {
    for (const a of Object.values(this.svc.current.artifacts)) {
      if (a.kind !== 'pptx' && a.kind !== 'docx') continue;
      const v = a.versions.find((x) => x.id === versionId);
      if (!v) continue;
      if (!v.blobHash) return null;
      return { artifactId: a.id, kind: a.kind, blobHash: v.blobHash, derived: v.derived };
    }
    return null;
  }

  private enqueue(versionId: Id): void {
    if (this.queued.has(versionId)) return;
    const found = this.find(versionId);
    if (!found) return;
    if (found.derived && !(found.derived.status === 'failed' && found.derived.error === CONVERTER_UNAVAILABLE)) return;
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
      const id = this.queue.shift();
      if (!id) return;
      try {
        await this.process(id);
      } catch (e) {
        this.opts.log?.(`[office] ${id}: ${(e as Error).message}`);
      } finally {
        this.queued.delete(id);
      }
    }
  }

  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    const attempts = this.opts.attempts ?? 3;
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        last = e;
        // Stopping: fail fast instead of sleeping through a backoff that no longer matters.
        if (this.abortController?.signal.aborted) throw e;
        await new Promise((r) => setTimeout(r, (this.opts.retryDelayMs ?? 500) * 2 ** i));
      }
    }
    throw last;
  }

  private async health(): Promise<string> {
    if (this.converter) return this.converter;
    const res = await this.fetch(`${this.opts.url}/health`, { signal: this.abortController?.signal });
    if (!res.ok) throw new Error(`office health HTTP ${res.status}`);
    const body = (await res.json()) as { converter?: string };
    if (!body.converter) throw new Error('office health: no converter id');
    this.converter = body.converter;
    return body.converter;
  }

  private async process(versionId: Id): Promise<void> {
    const found = this.find(versionId);
    if (!found) return;
    const { artifactId, kind, blobHash } = found;

    try {
      const converter = await this.retry(() => this.health());
      const cached = await this.svc.derivations.get(blobHash, kind, converter);
      let manifest: OfficeManifest;
      if (cached?.manifestHash && (await this.svc.blobFiles.exists(cached.manifestHash))) {
        manifest = JSON.parse(new TextDecoder().decode(await this.svc.blobFiles.readBytes(cached.manifestHash))) as OfficeManifest;
      } else {
        const bytes = await this.svc.blobFiles.readBytes(blobHash);
        const res = await this.retry(async () => {
          const r = await this.fetch(`${this.opts.url}/convert?kind=${kind}`, {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream' },
            body: bytes,
            signal: this.abortController?.signal,
          });
          if (!r.ok) throw new Error(`office convert HTTP ${r.status}`);
          return (await r.json()) as ConvertResponse;
        });
        const pageHashes: string[] = [];
        for (const p of res.pages ?? []) pageHashes.push(await this.svc.putDerivedBlob(ACTOR, Buffer.from(p.png, 'base64'), 'image/png'));
        const texts = kind === 'pptx' ? (res.slides ?? []).map((s) => `${s.title}\n${s.text}`) : (res.blocks ?? []).map((b) => b.text);
        manifest = {
          format: 'meetless.office-derivation',
          formatVersion: 1,
          sourceHash: blobHash,
          kind,
          converter: res.converter || converter,
          status: res.status,
          error: res.status === 'failed' ? (res.error ?? 'unreadable') : null,
          pageHashes,
          texts,
        };
        const manifestHash = await this.svc.putDerivedBlob(ACTOR, new TextEncoder().encode(JSON.stringify(manifest)), 'application/json');
        await this.svc.derivations.put({ sourceHash: blobHash, kind, converter, status: manifest.status, manifestHash, error: manifest.error });
      }
      await this.record(artifactId, versionId, { status: manifest.status, pageHashes: manifest.pageHashes, texts: manifest.texts, error: manifest.error, converter: manifest.converter });
    } catch (e) {
      // Stopping: the fetch was aborted on purpose. Record nothing; the version has no
      // `derived` yet, so the next start() re-queues it instead of leaving it marked as failed.
      if (this.abortController?.signal.aborted) return;
      this.opts.log?.(`[office] converter unavailable for ${versionId}: ${(e as Error).message}`);
      await this.record(artifactId, versionId, { status: 'failed', pageHashes: [], texts: [], error: CONVERTER_UNAVAILABLE, converter: this.converter });
    }
  }

  private async record(
    artifactId: Id,
    versionId: Id,
    p: { status: 'ready' | 'partial' | 'failed'; pageHashes: string[]; texts: string[]; error: string | null; converter: string | null },
  ): Promise<void> {
    await this.svc.appendSystem(ACTOR, { id: randomUUID(), type: 'artifactVersion.derived', payload: { artifactId, versionId, ...p } });
  }
}
