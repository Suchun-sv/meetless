/**
 * H3 (v0.1.0 audit): a small DOCX or PDF must not take the server down. DOCX and PDF parsing runs
 * in a worker with a heap limit and a kill timeout, after the DOCX's declared sizes are checked.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/frame';
import { checkDocx } from '../src/imports/docx-limits';
import { extractText } from '../src/imports/extract';
import { DEFAULT_LIMITS, sandboxLimits, setSandboxLimits } from '../src/imports/sandbox';
import { minimalPdf } from './support/pdf';
import { bombXml, docxWith } from './support/zip';

async function failure(p: Promise<unknown>): Promise<{ code: string; details: unknown }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return { code: e.code, details: e.details };
    throw e;
  }
  throw new Error('expected a rejection');
}

const before = sandboxLimits();
afterEach(() => setSandboxLimits(before));

describe('DOCX checks before mammoth runs', () => {
  it('a small, well-formed DOCX passes the size checks and its text comes back from the sandbox', async () => {
    const doc = docxWith(bombXml(3));
    expect(checkDocx(doc)).toBe('ok');
    expect((await extractText('docx', doc)).trim()).toBe('a\n\na\n\na');
  });

  it('a zip bomb (about 50 MB of XML in a ~150 KB file) is TOO_LARGE from its central directory alone', async () => {
    const bomb = docxWith(bombXml(1_500_000));
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    expect(checkDocx(bomb)).toBe('too_large');
    expect((await failure(extractText('docx', bomb))).code).toBe('TOO_LARGE');
  });

  it('a bomb that lies about its sizes meets the heap limit in the worker, and the server thread lives on', async () => {
    setSandboxLimits({ heapMb: 48 });
    const liar = docxWith(bombXml(1_500_000), 1000);
    expect(checkDocx(liar)).toBe('ok');
    const f = await failure(extractText('docx', liar));
    expect(['TOO_LARGE', 'EXTRACT_FAILED']).toContain(f.code);
    // The main thread still answers.
    expect(await extractText('txt', new TextEncoder().encode('still here'))).toBe('still here');
  });

  it('not a zip at all is corrupt', async () => {
    expect(checkDocx(new TextEncoder().encode('PK not really'))).toBe('corrupt');
    expect(await failure(extractText('docx', new TextEncoder().encode('PK not really')))).toEqual({ code: 'EXTRACT_FAILED', details: { reason: 'corrupt' } });
  });
});

describe('PDF in the sandbox', () => {
  it('malformed PDFs (garbage, header only, truncated) fail as corrupt without throwing anything else', async () => {
    const good = minimalPdf(['some text']);
    for (const bad of [new TextEncoder().encode('%PDF-1.7\n'), good.slice(0, Math.floor(good.length / 2)), new Uint8Array(4096).fill(0x25)]) {
      const f = await failure(extractText('pdf', bad));
      expect(f.code).toBe('EXTRACT_FAILED');
    }
  });

  it('more pages than the limit is TOO_LARGE', async () => {
    setSandboxLimits({ maxPdfPages: 2 });
    expect((await failure(extractText('pdf', minimalPdf([['a'], ['b'], ['c']])))).code).toBe('TOO_LARGE');
    setSandboxLimits({ maxPdfPages: DEFAULT_LIMITS.maxPdfPages });
    expect(await extractText('pdf', minimalPdf([['a'], ['b'], ['c']]))).toContain('c');
  });

  it('a parse over the time limit is killed and answered as timeout', async () => {
    setSandboxLimits({ timeoutMs: 1 });
    expect(await failure(extractText('pdf', minimalPdf(['x'])))).toEqual({ code: 'EXTRACT_FAILED', details: { reason: 'timeout' } });
  });

  it('more jobs than the queue holds are refused at once, not queued', async () => {
    setSandboxLimits({ concurrency: 1, maxQueue: 1 });
    const jobs = [0, 1, 2, 3].map(() => failure(extractText('pdf', minimalPdf(['q']))).catch(() => ({ code: 'OK', details: null })));
    const codes = (await Promise.all(jobs)).map((r) => r.code);
    expect(codes.filter((c) => c === 'RATE_LIMITED').length).toBeGreaterThanOrEqual(1);
  });
});

describe('kind', () => {
  it('an unknown kind is BAD_REQUEST and is never parsed as a PDF', async () => {
    expect(await failure(extractText('pptx' as never, minimalPdf(['x'])))).toEqual({ code: 'BAD_REQUEST', details: { field: 'kind' } });
  });
});
