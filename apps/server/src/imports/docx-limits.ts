/**
 * DOCX is a zip. Before mammoth inflates it, the central directory (the sizes the zip declares)
 * must look like a document, not a zip bomb: a 157 KB file can declare 50 MB of XML, and mammoth
 * needs many times that in heap. A zip that lies about its sizes still meets the sandbox's heap
 * limit and timeout (sandbox.ts).
 */

export const DOCX_MAX_ENTRIES = 5_000;
/** Total declared uncompressed size (images included). */
export const DOCX_MAX_UNPACKED = 200 * 1024 * 1024;
/** Any single XML part, `word/document.xml` above all. */
export const DOCX_MAX_XML = 16 * 1024 * 1024;
/** Compression ratio limit for entries over 1 MB unpacked (real XML compresses about 5 to 20 times). */
export const DOCX_MAX_RATIO = 100;

export type DocxCheck = 'ok' | 'corrupt' | 'too_large';

/** Checks the declared sizes in a DOCX's central directory. Never inflates anything. */
export function checkDocx(b: Uint8Array): DocxCheck {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return 'corrupt';
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  // Zip64 has no place in a document of at most 25 MB.
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) return 'too_large';
  if (count > DOCX_MAX_ENTRIES) return 'too_large';
  if (cdOffset + cdSize > buf.length) return 'corrupt';
  let p = cdOffset;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cdOffset + cdSize || buf.readUInt32LE(p) !== 0x02014b50) return 'corrupt';
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (usize === 0xffffffff || csize === 0xffffffff) return 'too_large';
    total += usize;
    if (total > DOCX_MAX_UNPACKED) return 'too_large';
    if (/\.(xml|rels)$/i.test(name) && usize > DOCX_MAX_XML) return 'too_large';
    if (usize > 1024 * 1024 && usize > DOCX_MAX_RATIO * Math.max(1, csize)) return 'too_large';
    p += 46 + nameLen + extraLen + commentLen;
  }
  return 'ok';
}
