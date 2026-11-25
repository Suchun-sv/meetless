// Runs one DOCX or PDF extraction inside a worker thread (sandbox.ts). The parent gives it a heap
// limit and kills it on a wall-clock timeout, so a hostile file can exhaust only this worker.
// Plain JavaScript so the same file runs under tsx, vitest and plain node alike.
import { parentPort, workerData } from 'node:worker_threads';

const { kind, bytes, maxPdfPages } = workerData;

async function run() {
  if (kind === 'docx') {
    const { default: mammoth } = await import('mammoth');
    const r = await mammoth.extractRawText({ buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
    return { text: r.value };
  }
  if (kind === 'pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(bytes);
    if (doc.numPages > maxPdfPages) return { limit: 'pages' };
    const { text } = await extractText(doc, { mergePages: false });
    return { pages: Array.isArray(text) ? text : [text] };
  }
  return { error: 'kind' };
}

run().then(
  (r) => parentPort.postMessage({ ok: true, ...r }),
  () => parentPort.postMessage({ ok: false }),
);
