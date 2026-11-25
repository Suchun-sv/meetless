import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BRIDGE_METHODS, type UpdateState } from '../src/bridge';
import { ClientNode } from '../src/index';

/** App updates belong to the Electron shell: ClientNode only forwards to the hooks it is given. */
const dir = mkdtempSync(join(tmpdir(), 'meetless-updates-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const STATE: UpdateState = {
  current: '0.1.0',
  available: { version: '0.2.0', notes: ['Faster sync'] },
  install: 'self',
  releasesUrl: 'https://github.com/Suchun-sv/meetless/releases',
  phase: 'idle',
  percent: null,
  error: null,
};

describe('updates over the bridge', () => {
  it('adds exactly updatesCheck and updatesInstall to the bridge', () => {
    expect(BRIDGE_METHODS.filter((m) => m.startsWith('updates'))).toEqual(['updatesCheck', 'updatesInstall']);
  });

  it('without an updater (dev bridge host) both answer NOT_AVAILABLE', async () => {
    const node = await ClientNode.open({ dataDir: join(dir, 'a') });
    expect(await node.updatesCheck()).toEqual({ ok: false, code: 'NOT_AVAILABLE' });
    expect(await node.updatesInstall()).toEqual({ ok: false, code: 'NOT_AVAILABLE' });
    await node.close();
  });

  it('with an updater (Electron) they forward to it', async () => {
    const calls: string[] = [];
    const node = await ClientNode.open({
      dataDir: join(dir, 'b'),
      updates: {
        check: async () => (calls.push('check'), STATE),
        install: async () => (calls.push('install'), { ok: false, code: 'UPDATE_CHECKSUM' }),
      },
    });
    expect(await node.updatesCheck()).toEqual({ ok: true, update: STATE });
    expect(await node.updatesInstall()).toEqual({ ok: false, code: 'UPDATE_CHECKSUM' });
    expect(calls).toEqual(['check', 'install']);
    await node.close();
  });
});

describe('local files', () => {
  it('the data folder is 0700 and an old 0644 session.json becomes 0600 on open', async () => {
    const d = join(dir, 'modes');
    const node = await ClientNode.open({ dataDir: d });
    expect(statSync(d).mode & 0o777).toBe(0o700);
    await node.close();
    const old = join(dir, 'old');
    mkdirSync(old);
    writeFileSync(join(old, 'session.json'), '{}', { mode: 0o644 });
    const again = await ClientNode.open({ dataDir: old });
    expect(statSync(join(old, 'session.json')).mode & 0o777).toBe(0o600);
    await again.close();
  });
});
