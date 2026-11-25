import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startBridgeHost, type BridgeHost } from '../src/bridge-host/host';

/** The browser bridge host has no updater: the update calls answer NOT_AVAILABLE, never an error. */
const dir = mkdtempSync(join(tmpdir(), 'meetless-host-updates-'));
let host: BridgeHost;
beforeAll(async () => {
  host = await startBridgeHost({ dataDir: dir });
});
afterAll(async () => {
  await host.close();
  rmSync(dir, { recursive: true, force: true });
});

it.each(['updatesCheck', 'updatesInstall'])('%s answers NOT_AVAILABLE', async (m) => {
  const res = await fetch(`${host.url}/rpc/${m}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-meetless-bridge-token': host.token },
    body: JSON.stringify({ args: [] }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ result: { ok: false, code: 'NOT_AVAILABLE' } });
});
