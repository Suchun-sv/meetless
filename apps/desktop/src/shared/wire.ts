/**
 * JSON encoding for the DEV/TEST bridge transport: Uint8Array <-> {"$bytes": base64}.
 * (Electron IPC does not need this; structured clone carries Uint8Array.)
 */
export function encodeWire(v: unknown): unknown {
  if (v instanceof Uint8Array) return { $bytes: toBase64(v) };
  if (Array.isArray(v)) return v.map(encodeWire);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encodeWire(x)]));
  return v;
}

export function decodeWire(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decodeWire);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.$bytes === 'string' && Object.keys(o).length === 1) return fromBase64(o.$bytes);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decodeWire(x)]));
  }
  return v;
}

function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
