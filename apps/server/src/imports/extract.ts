import type { InputKind } from '@meetless/core';
import { ApiError } from '../api/frame';
import { checkDocx } from './docx-limits';
import { SandboxError, sandboxDocxText, sandboxPdfPages } from './sandbox';

/** Import upload cap (contract §3 `inputs.import`): a blob over this size is `TOO_LARGE` before extraction runs. */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
/** Extracted (or directly supplied) text over this many characters is `TOO_LARGE`. */
export const MAX_IMPORT_CHARS = 500_000;

function normaliseLineEndings(s: string): string {
  // TextDecoder already strips a leading BOM; CRLF -> LF is ours to do.
  return s.replace(/\r\n/g, '\n');
}

/**
 * Per-page text of a PDF, via unpdf/pdf.js in the extraction sandbox (`sandbox.ts`: a worker
 * thread with a heap limit, a kill timeout and a page limit). One array entry per page, in
 * reading order; an empty page is `''`. Shared with the per-page artifact extraction of
 * Task 5b, which calls this same function so unpdf is invoked from one place. Rejects with a
 * `SandboxError`.
 */
export async function pdfPages(bytes: Uint8Array, opts?: { timeoutMs?: number }): Promise<string[]> {
  return sandboxPdfPages(bytes, opts);
}

/** A sandbox failure as the API answers it: limits are `TOO_LARGE`, a full queue `RATE_LIMITED`. */
function sandboxFailure(e: unknown): ApiError {
  const reason = e instanceof SandboxError ? e.reason : 'corrupt';
  if (reason === 'too_large') return new ApiError('TOO_LARGE');
  if (reason === 'busy') return new ApiError('RATE_LIMITED', { retryAfter: 5 });
  return new ApiError('EXTRACT_FAILED', { reason });
}

/**
 * Extracts plain text from an uploaded import, per `kind`:
 * - `md` / `txt`: decoded as UTF-8 (a bad byte sequence is `reason: 'encoding'`), BOM dropped,
 *   CRLF normalised to LF.
 * - `docx`: the declared zip sizes are checked first (`checkDocx`: a zip bomb is `TOO_LARGE`),
 *   then mammoth's raw text extraction runs in the sandbox (a corrupt file is `reason: 'corrupt'`).
 * - `pdf`: `pdfPages`, pages joined by a blank line (a corrupt file is `reason: 'corrupt'`).
 * In the sandbox, a parse over the heap or page limit is `TOO_LARGE` and one over the time limit
 * is `reason: 'timeout'`. Any other kind is `BAD_REQUEST { field: 'kind' }`, before any parsing.
 * Text that is empty after trimming — including a PDF with no extractable text — is
 * `reason: 'no_text'`. All three throw `ApiError('EXTRACT_FAILED', { reason })`.
 */
export async function extractText(kind: InputKind, bytes: Uint8Array): Promise<string> {
  let text: string;
  if (kind === 'md' || kind === 'txt') {
    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new ApiError('EXTRACT_FAILED', { reason: 'encoding' });
    }
    text = normaliseLineEndings(decoded);
  } else if (kind === 'docx') {
    const check = checkDocx(bytes);
    if (check === 'too_large') throw new ApiError('TOO_LARGE');
    if (check === 'corrupt') throw new ApiError('EXTRACT_FAILED', { reason: 'corrupt' });
    try {
      text = await sandboxDocxText(bytes);
    } catch (e) {
      throw sandboxFailure(e);
    }
  } else if (kind === 'pdf') {
    try {
      const pages = await pdfPages(bytes);
      text = pages.join('\n\n');
    } catch (e) {
      throw sandboxFailure(e);
    }
  } else {
    throw new ApiError('BAD_REQUEST', { field: 'kind' });
  }
  if (text.trim().length === 0) throw new ApiError('EXTRACT_FAILED', { reason: 'no_text' });
  return text;
}
