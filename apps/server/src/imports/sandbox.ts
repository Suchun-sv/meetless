import { Worker } from 'node:worker_threads';

/**
 * DOCX and PDF parsing (mammoth, pdf.js) runs in a worker thread, never on the server's own
 * thread: a small hostile file can need gigabytes of heap or minutes of CPU. Each job gets
 *
 * - a heap limit (`resourceLimits`): running out kills only the worker;
 * - a wall-clock timeout that terminates the worker (a busy parse cannot starve a timer here,
 *   because the timer lives on the server's thread);
 * - a place in a small concurrency limit, with a bounded queue behind it.
 *
 * Every failure is a `SandboxError` whose `reason` is `corrupt` (the parser threw), `too_large`
 * (heap limit, page limit) or `timeout`; the worker is gone either way.
 */

export interface SandboxLimits {
  /** Old-generation heap per worker, in MB. */
  heapMb: number;
  timeoutMs: number;
  /** At most this many workers at once. */
  concurrency: number;
  /** Jobs waiting beyond this are refused at once (`busy`). */
  maxQueue: number;
  maxPdfPages: number;
}

export const DEFAULT_LIMITS: SandboxLimits = { heapMb: 384, timeoutMs: 30_000, concurrency: 2, maxQueue: 16, maxPdfPages: 2_000 };

/** The limits from the environment (`MEETLESS_EXTRACT_HEAP_MB`, `_TIMEOUT_MS`, `_CONCURRENCY`, `MEETLESS_PDF_MAX_PAGES`), else the defaults. */
export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): SandboxLimits {
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    heapMb: num(env.MEETLESS_EXTRACT_HEAP_MB, DEFAULT_LIMITS.heapMb),
    timeoutMs: num(env.MEETLESS_EXTRACT_TIMEOUT_MS, DEFAULT_LIMITS.timeoutMs),
    concurrency: num(env.MEETLESS_EXTRACT_CONCURRENCY, DEFAULT_LIMITS.concurrency),
    maxQueue: DEFAULT_LIMITS.maxQueue,
    maxPdfPages: num(env.MEETLESS_PDF_MAX_PAGES, DEFAULT_LIMITS.maxPdfPages),
  };
}

export type SandboxReason = 'corrupt' | 'too_large' | 'timeout' | 'busy';

export class SandboxError extends Error {
  constructor(readonly reason: SandboxReason) {
    super(`extract ${reason}`);
  }
}

const WORKER_URL = new URL('./extract-worker.mjs', import.meta.url);

let limits = limitsFromEnv();
let active = 0;
const waiting: (() => void)[] = [];

/** Replaces the limits (tests; the server reads them from the environment at load). */
export function setSandboxLimits(next: Partial<SandboxLimits>): void {
  limits = { ...limits, ...next };
}

export function sandboxLimits(): SandboxLimits {
  return { ...limits };
}

async function slot(): Promise<() => void> {
  if (active >= limits.concurrency) {
    if (waiting.length >= limits.maxQueue) throw new SandboxError('busy');
    await new Promise<void>((r) => waiting.push(r));
  }
  active += 1;
  return () => {
    active -= 1;
    waiting.shift()?.();
  };
}

interface WorkerReply {
  ok: boolean;
  text?: string;
  pages?: string[];
  limit?: string;
}

async function runJob(kind: 'docx' | 'pdf', bytes: Uint8Array, opts: { timeoutMs?: number } = {}): Promise<WorkerReply> {
  const release = await slot();
  try {
    const l = limits;
    return await new Promise<WorkerReply>((resolve, reject) => {
      const w = new Worker(WORKER_URL, {
        workerData: { kind, bytes, maxPdfPages: l.maxPdfPages },
        resourceLimits: { maxOldGenerationSizeMb: l.heapMb, maxYoungGenerationSizeMb: Math.min(64, Math.max(8, Math.floor(l.heapMb / 8))), stackSizeMb: 4 },
      });
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void w.terminate();
        fn();
      };
      const timer = setTimeout(() => done(() => reject(new SandboxError('timeout'))), opts.timeoutMs ?? l.timeoutMs);
      w.once('message', (m: WorkerReply) => done(() => (m.ok ? resolve(m) : reject(new SandboxError('corrupt')))));
      w.once('error', (e: NodeJS.ErrnoException) => done(() => reject(new SandboxError(e.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'too_large' : 'corrupt'))));
      w.once('exit', () => done(() => reject(new SandboxError('corrupt'))));
    });
  } finally {
    release();
  }
}

/** mammoth's raw text of a DOCX, in the sandbox. */
export async function sandboxDocxText(bytes: Uint8Array, opts?: { timeoutMs?: number }): Promise<string> {
  const r = await runJob('docx', bytes, opts);
  if (typeof r.text !== 'string') throw new SandboxError('corrupt');
  return r.text;
}

/** Per-page text of a PDF, in the sandbox; more than `maxPdfPages` pages is `too_large`. */
export async function sandboxPdfPages(bytes: Uint8Array, opts?: { timeoutMs?: number }): Promise<string[]> {
  const r = await runJob('pdf', bytes, opts);
  if (r.limit) throw new SandboxError('too_large');
  if (!Array.isArray(r.pages)) throw new SandboxError('corrupt');
  return r.pages;
}
