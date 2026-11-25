import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/frame';
import { extractText, pdfPages } from '../src/imports/extract';
import { minimalPdf } from './support/pdf';

const FIX = resolve(import.meta.dirname, '../../../fixtures/office');
const fixture = (n: string) => new Uint8Array(readFileSync(resolve(FIX, n)));
const bytes = (s: string) => new TextEncoder().encode(s);

/** Awaits a rejecting promise and returns its `ApiError.details`; re-throws anything else. */
async function extractFailure(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e.details;
    throw e;
  }
  throw new Error('expected extractText to reject');
}

describe('extractText', () => {
  it('md and txt decode UTF-8, drop a BOM and normalise CRLF', async () => {
    expect(await extractText('txt', bytes('﻿a\r\nb'))).toBe('a\nb');
    expect(await extractText('md', bytes('﻿# a\r\nb'))).toBe('# a\nb');
  });

  it('a non-UTF-8 txt fails with EXTRACT_FAILED reason encoding', async () => {
    const bad = new Uint8Array([0xc3, 0x28, 0x61]); // 0xc3 wants a UTF-8 continuation byte; 0x28 ('(') is not one
    expect(await extractFailure(extractText('txt', bad))).toEqual({ reason: 'encoding' });
  });

  it('docx: the export-design fixture yields its goal paragraph', async () => {
    const text = await extractText('docx', fixture('export-design-v1.docx'));
    expect(text).toContain('Goal: customers can export customer data as a CSV file.');
  });

  it('a corrupt docx fails with reason corrupt', async () => {
    expect(await extractFailure(extractText('docx', fixture('corrupt.docx')))).toEqual({ reason: 'corrupt' });
  });

  it('pdf: a generated two-line PDF yields both lines; a PDF with no text fails with reason no_text', async () => {
    const text = await extractText('pdf', minimalPdf(['first line', 'second line']));
    expect(text).toContain('first line');
    expect(text).toContain('second line');
    expect(await extractFailure(extractText('pdf', minimalPdf([])))).toEqual({ reason: 'no_text' });
  });

  it('a corrupt pdf fails with reason corrupt', async () => {
    expect(await extractFailure(extractText('pdf', bytes('not a pdf at all')))).toEqual({ reason: 'corrupt' });
  });

  it('text that is only whitespace fails with reason no_text, regardless of kind', async () => {
    expect(await extractFailure(extractText('txt', bytes('   \n\t  ')))).toEqual({ reason: 'no_text' });
  });

  it('pdfPages gives one entry per page, reused by extractText(\'pdf\', …) and by Task 5b', async () => {
    expect(await pdfPages(minimalPdf(['only line']))).toEqual(['only line']);
    expect(await pdfPages(minimalPdf([]))).toEqual(['']);
  });
});
