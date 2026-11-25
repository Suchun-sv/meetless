import mammoth from 'mammoth';
import { extractText as pdfExtractText, getDocumentProxy } from 'unpdf';
import type { InputKind } from '@meetless/core';
import { ApiError } from '../api/frame';

/** Import upload cap (contract §3 `inputs.import`): a blob over this size is `TOO_LARGE` before extraction runs. */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
/** Extracted (or directly supplied) text over this many characters is `TOO_LARGE`. */
export const MAX_IMPORT_CHARS = 500_000;

function normaliseLineEndings(s: string): string {
  // TextDecoder already strips a leading BOM; CRLF -> LF is ours to do.
  return s.replace(/\r\n/g, '\n');
}

/**
 * Per-page text of a PDF, via unpdf/pdf.js. One array entry per page, in reading
 * order; an empty page is `''`. Shared with the per-page artifact extraction of
 * Task 5b, which calls this same function so unpdf is invoked from one place.
 */
export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocumentProxy(bytes);
  const { text } = await pdfExtractText(doc, { mergePages: false });
  return Array.isArray(text) ? text : [text];
}

/**
 * Extracts plain text from an uploaded import, per `kind`:
 * - `md` / `txt`: decoded as UTF-8 (a bad byte sequence is `reason: 'encoding'`), BOM dropped,
 *   CRLF normalised to LF.
 * - `docx`: mammoth's raw text extraction (a corrupt file is `reason: 'corrupt'`).
 * - `pdf`: `pdfPages`, pages joined by a blank line (a corrupt file is `reason: 'corrupt'`).
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
    try {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      text = result.value;
    } catch {
      throw new ApiError('EXTRACT_FAILED', { reason: 'corrupt' });
    }
  } else {
    // kind === 'pdf'
    try {
      const pages = await pdfPages(bytes);
      text = pages.join('\n\n');
    } catch {
      throw new ApiError('EXTRACT_FAILED', { reason: 'corrupt' });
    }
  }
  if (text.trim().length === 0) throw new ApiError('EXTRACT_FAILED', { reason: 'no_text' });
  return text;
}
