/** Escapes `\`, `(` and `)` for a PDF literal string, in that order so a backslash introduced by the first pass is not re-escaped. */
function escapePdfString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * A minimal, valid PDF for tests: a Catalog, a Pages tree, one Helvetica Type1 font
 * (no embedded program, so ASCII text only) shared by every page, a content stream per
 * page drawing each of its lines at its own absolute position, and a correctly-offset
 * `xref` table.
 *
 * `lines` is either the lines of a single page (`string[]`, the original shape — every
 * existing caller keeps its exact output) or the lines of each page (`string[][]`, one
 * entry per page, for multi-page tests). `minimalPdf([])` is unchanged: one page whose
 * content stream is empty — no text at all.
 */
export function minimalPdf(lines: string[] | string[][]): Uint8Array {
  const pages: string[][] = lines.length > 0 && Array.isArray(lines[0]) ? (lines as string[][]) : [lines as string[]];
  const n = pages.length;

  // Object numbers, chosen so a single page (n=1) numbers exactly as the original
  // did: 1 catalog, 2 pages, 3 page, 4 font, 5 content.
  const pagesId = 2;
  const pageIds = Array.from({ length: n }, (_, i) => 3 + i);
  const fontId = 3 + n;
  const contentIds = Array.from({ length: n }, (_, i) => 4 + n + i);

  const contents = pages.map((pageLines) => pageLines.map((line, i) => `BT /F1 12 Tf 72 ${720 - i * 18} Td (${escapePdfString(line)}) Tj ET`).join('\n'));

  const objects = [
    `<< /Type /Catalog /Pages ${pagesId} 0 R >>`,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${n} >>`,
    ...pageIds.map(
      (_, i) =>
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`,
    ),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...contents.map((content) => `<< /Length ${content.length} >>\nstream\n${content}\nendstream`),
  ];

  // Every char here is ASCII (the header, object syntax, and `content`, which the
  // caller keeps to ASCII), so `string.length` doubles as the byte offset.
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = out.length;
  const count = objects.length + 1;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += xref;
  out += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new TextEncoder().encode(out);
}
