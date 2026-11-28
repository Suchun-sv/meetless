/** Installed before anything else (index.ts). Hermes lacks crypto.randomUUID and AbortSignal.timeout. */
import { randomUUID } from 'expo-crypto';

const g = globalThis as { crypto?: { randomUUID?: () => string } };
if (!g.crypto) (g as { crypto: object }).crypto = {};
if (typeof g.crypto!.randomUUID !== 'function') g.crypto!.randomUUID = () => randomUUID();

const AS = (globalThis as { AbortSignal?: { timeout?: (ms: number) => AbortSignal } }).AbortSignal;
if (AS && typeof AS.timeout !== 'function') {
  AS.timeout = (ms: number) => {
    const c = new AbortController();
    setTimeout(() => c.abort(Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' })), ms);
    return c.signal;
  };
}

/** UTF-8 only; enough for shared code that decodes text blobs. */
class Utf8Decoder {
  readonly encoding = 'utf-8';
  decode(input?: ArrayBuffer | ArrayBufferView): string {
    if (!input) return '';
    const b = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    let out = '';
    for (let i = 0; i < b.length; ) {
      const c = b[i++]!;
      let cp: number;
      if (c < 0x80) cp = c;
      else if (c >= 0xc0 && c < 0xe0) cp = ((c & 0x1f) << 6) | (b[i++]! & 0x3f);
      else if (c >= 0xe0 && c < 0xf0) cp = ((c & 0x0f) << 12) | ((b[i++]! & 0x3f) << 6) | (b[i++]! & 0x3f);
      else if (c >= 0xf0) cp = ((c & 0x07) << 18) | ((b[i++]! & 0x3f) << 12) | ((b[i++]! & 0x3f) << 6) | (b[i++]! & 0x3f);
      else cp = 0xfffd;
      out += String.fromCodePoint(cp);
    }
    return out;
  }
}
const G = globalThis as { TextDecoder?: unknown };
if (typeof G.TextDecoder !== 'function') G.TextDecoder = Utf8Decoder;
