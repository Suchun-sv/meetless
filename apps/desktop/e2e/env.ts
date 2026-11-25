import { resolve } from 'node:path';
import { decodeWire, encodeWire } from '../src/shared/wire';

const port = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535 - 9) throw new Error(`${name} must be a port number, not ${JSON.stringify(raw)}`);
  return n;
};

/**
 * Ports and paths shared by global setup and specs (all loopback). The server listens on
 * `MEETLESS_E2E_BASE` (default 4890), client bridges on base+1 to base+9, and the renderer on
 * `MEETLESS_E2E_RENDERER_PORT` (default 5179); `node scripts/block.mjs env <block>` sets both.
 */
export const E2E = {
  base: port('MEETLESS_E2E_BASE', 4890),
  rendererPort: port('MEETLESS_E2E_RENDERER_PORT', 5179),
  root: resolve(import.meta.dirname, '../.data/e2e'),
};
export const serverUrl = `http://127.0.0.1:${E2E.base}`;

/** The port of bridge slot 1..9 (base+slot). Each spec takes its own slots. */
export function bridgePort(slot: number): number {
  if (!Number.isInteger(slot) || slot < 1 || slot > 9) throw new Error(`bridge slot must be 1..9, not ${slot}`);
  return E2E.base + slot;
}

export interface BridgeSpec {
  name: string;
  port: number;
  token: string;
  locale: string;
}

export const clientUrl = (b: BridgeSpec) =>
  `http://127.0.0.1:${E2E.rendererPort}/?bridge=${encodeURIComponent(`http://127.0.0.1:${b.port}`)}&bridgeToken=${b.token}&server=${encodeURIComponent(serverUrl)}`;

export const dataDir = (b: BridgeSpec) => resolve(E2E.root, `client-${b.name}`);

/** Calls a bridge method on a client instance directly (test inspection only), over the dev bridge's wire format. */
export async function bridgeCall<T>(b: BridgeSpec, method: string, ...args: unknown[]): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${b.port}/rpc/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-meetless-bridge-token': b.token },
    body: JSON.stringify({ args: encodeWire(args) }),
  });
  const body = (await res.json()) as { result?: unknown; error?: string };
  if (!res.ok) throw new Error(body.error ?? `bridge ${method} failed (HTTP ${res.status})`);
  return decodeWire(body.result) as T;
}
