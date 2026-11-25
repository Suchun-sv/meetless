import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { IncomingMessage } from 'node:http';
import Fastify from 'fastify';
import { hashSecret, newToken } from '../src/accounts/secrets';
import { Authenticator } from '../src/auth';
import { BlobFiles } from '../src/blobs';
import { buildApp, clientIp, fastifyTrustProxy } from '../src/http';
import { DEFAULT_DEV_USERS, configFromEnv } from '../src/index';
import { SyncService } from '../src/service';
import { MemoryAccountStore, MemoryBlobMetaStore, MemoryEventStore } from '../src/store/memory';
import type { TokenRow } from '../src/store/types';
import { cmd, http, IDS, make, serverConfig, tempDir, TOKENS, withServer, type TestServer } from './helpers';

const NOW = '2026-11-24T10:00:00.000Z';

/** Inserts a token row straight into the store and returns the plaintext and its row id. */
async function insertToken(s: TestServer, kind: 'personal' | 'agent', userId: string, label: string): Promise<{ token: string; id: string }> {
  const token = newToken(kind);
  const row: TokenRow = { id: `t-${randomUUID()}`, kind, userId, label, tokenHash: hashSecret(token), createdAt: NOW, lastUsedAt: null, revokedAt: null };
  await s.accounts.createToken(row);
  return { token, id: row.id };
}

/** HTTP status of a websocket upgrade (101 when it switched protocols), plus the socket when it opened. */
function wsOpen(base: string, token: string | null): Promise<{ status: number; ws: WebSocket | null; hello: Promise<any> | null }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/v1/ws`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    const hello = new Promise<any>((r) => ws.once('message', (m) => r(JSON.parse(String(m)))));
    ws.once('unexpected-response', (_req, res) => {
      resolve({ status: res.statusCode ?? 0, ws: null, hello: null });
      ws.terminate();
    });
    ws.once('upgrade', () => resolve({ status: 101, ws, hello }));
    ws.once('error', (e) => reject(e));
  });
}

async function wsStatus(base: string, token: string | null): Promise<number> {
  const r = await wsOpen(base, token);
  r.ws?.close();
  return r.status;
}

const closeCode = (ws: WebSocket) => new Promise<number>((r) => ws.once('close', (code) => r(code)));

describe('configFromEnv', () => {
  it('dev auth is off unless MEETLESS_DEV_AUTH=1, and with it off no dev users are configured', () => {
    expect(configFromEnv({})).toMatchObject({ devAuth: false, devUsers: [], adminInvite: true, agentUrl: null, trustProxy: 0 });
    expect(configFromEnv({ MEETLESS_DEV_AUTH: 'true' }).devAuth).toBe(false);
    const on = configFromEnv({ MEETLESS_DEV_AUTH: '1' });
    expect(on.devAuth).toBe(true);
    expect(on.devUsers).toEqual(DEFAULT_DEV_USERS);
  });

  it('MEETLESS_DEV_AUTH=1 is refused when NODE_ENV=production', () => {
    expect(() => configFromEnv({ MEETLESS_DEV_AUTH: '1', NODE_ENV: 'production' })).toThrow(
      new Error('MEETLESS_DEV_AUTH=1 is not allowed when NODE_ENV=production'),
    );
    expect(configFromEnv({ NODE_ENV: 'production' }).devAuth).toBe(false);
  });

  it('reads MEETLESS_AGENT_URL and MEETLESS_TRUST_PROXY (a hop count; anything else is refused)', () => {
    const c = configFromEnv({ MEETLESS_AGENT_URL: 'https://meetless.example.org', MEETLESS_TRUST_PROXY: '1' });
    expect(c.agentUrl).toBe('https://meetless.example.org');
    expect(c.trustProxy).toBe(1);
    expect(configFromEnv({ MEETLESS_TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(configFromEnv({ MEETLESS_TRUST_PROXY: '0' }).trustProxy).toBe(0);
    expect(configFromEnv({ MEETLESS_TRUST_PROXY: '' }).trustProxy).toBe(0);
    for (const bad of ['yes', 'true', '-1', '1.5', ' 1', '1e3', '99999999999999999999']) {
      expect(() => configFromEnv({ MEETLESS_TRUST_PROXY: bad }), bad).toThrow(/MEETLESS_TRUST_PROXY/);
    }
  });
});

describe('dev auth off', () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await withServer({ devAuth: false });
  });
  afterAll(() => s?.stop());

  it('dev tokens are refused unless devAuth is on; /health and /v1/me report it', async () => {
    const dev = await http(s.base, TOKENS.lin, 'GET', '/v1/me');
    expect(dev.status).toBe(401);
    expect(dev.json.error.code).toBe('UNAUTHENTICATED');
    expect((await http(s.base, TOKENS.alex, 'POST', '/v1/commands', make.project('p-x'))).json.error.code).toBe('UNAUTHENTICATED');
    expect(await wsStatus(s.base, TOKENS.lin)).toBe(401);
    expect((await http(s.base, null, 'GET', '/health')).json.devAuth).toBe(false);

    // A real account still works, and /v1/me says dev auth is off.
    await s.svc.appendSystem('system:accounts', { id: 'register:u-kai', type: 'user.registered', payload: { userId: 'u-kai', displayName: 'Kai', locale: 'en' } });
    const { token } = await insertToken(s, 'personal', 'u-kai', 'app');
    const me = await http(s.base, token, 'GET', '/v1/me');
    expect(me.status).toBe(200);
    expect(me.json).toEqual({ user: { id: 'u-kai', displayName: 'Kai', locale: 'en' }, devAuth: false });
  });

  it('with devAuth off no dev user is registered', async () => {
    expect(s.cfg.devAuth).toBe(false);
    expect(s.svc.current.users['u-lin']).toBeUndefined();
    for (const u of DEFAULT_DEV_USERS) expect(s.svc.current.users[u.id], u.id).toBeUndefined();
  });
});

describe('dev auth on', () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await withServer({ now: () => new Date(NOW) });
  });
  afterAll(() => s?.stop());

  it('/health reports devAuth on', async () => {
    expect((await http(s.base, null, 'GET', '/health')).json.devAuth).toBe(true);
    expect((await http(s.base, TOKENS.lin, 'GET', '/v1/me')).json).toEqual({ user: { id: IDS.lin, displayName: 'Lin An', locale: 'zh-CN' }, devAuth: true });
  });

  it('an agent token is refused on commands, events, blobs, ws and user API routes', async () => {
    const { token: agent } = await insertToken(s, 'agent', IDS.lin, 'codex');
    const c = await http(s.base, agent, 'POST', '/v1/commands', make.project('p-agent'));
    expect(c.status).toBe(403);
    expect(c.json.error.code).toBe('NOT_AUTHORISED');
    expect(s.svc.current.projects['p-agent']).toBeUndefined();
    expect((await http(s.base, agent, 'GET', '/v1/events?after=0')).status).toBe(403);
    const put = await fetch(`${s.base}/v1/blobs/sha256:${'0'.repeat(64)}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${agent}`, 'content-type': 'application/octet-stream' },
      body: new Uint8Array([1]),
    });
    expect(put.status).toBe(403);
    expect(((await put.json()) as { error: { code: string } }).error.code).toBe('NOT_AUTHORISED');
    expect((await http(s.base, agent, 'GET', `/v1/blobs/sha256:${'0'.repeat(64)}`)).status).toBe(403);
    expect(await wsStatus(s.base, agent)).toBe(401);
    expect((await http(s.base, agent, 'GET', '/v1/me')).json.error.code).toBe('NOT_AUTHORISED');
    expect((await http(s.base, agent, 'GET', '/v1/tokens')).json.error.code).toBe('NOT_AUTHORISED');
    // ...but it is accepted on an agent route (projects.list, Task 4): Lin has no project here.
    const list = await http(s.base, agent, 'GET', '/v1/projects');
    expect(list.status).toBe(200);
    expect(list.json.projects).toEqual([]);
  });

  it('a personal token works on commands, events, /v1/me and the websocket, and records when it was last used', async () => {
    const { token, id } = await insertToken(s, 'personal', IDS.zhou, 'app');
    const c = await http(s.base, token, 'POST', '/v1/commands', make.project('p-zhou'));
    expect(c.status).toBe(201);
    expect(c.json.event.actorId).toBe(IDS.zhou);
    const ev = await http(s.base, token, 'GET', '/v1/events?after=0');
    expect(ev.json.events.some((e: { type: string; payload: { projectId?: string } }) => e.type === 'project.created' && e.payload.projectId === 'p-zhou')).toBe(true);
    expect((await http(s.base, token, 'GET', '/v1/me')).json.user.id).toBe(IDS.zhou);
    const ws = await wsOpen(s.base, token);
    expect(ws.status).toBe(101);
    expect(await ws.hello).toMatchObject({ type: 'hello', userId: IDS.zhou });
    ws.ws!.close();
    const row = await s.accounts.tokenByHash(hashSecret(token));
    expect(row).toMatchObject({ id, lastUsedAt: NOW });
  });

  it('a revoked token answers TOKEN_REVOKED, an unknown one UNAUTHENTICATED', async () => {
    const { token, id } = await insertToken(s, 'personal', IDS.ben, 'app');
    const { token: agent, id: agentId } = await insertToken(s, 'agent', IDS.ben, 'claude-code');
    expect((await http(s.base, token, 'GET', '/v1/me')).status).toBe(200);
    expect(await s.accounts.revokeToken(id, IDS.ben, NOW)).toBe(true);
    expect(await s.accounts.revokeToken(agentId, IDS.ben, NOW)).toBe(true);
    for (const [t, path] of [
      [token, '/v1/me'],
      [token, '/v1/events?after=0'],
      [agent, '/v1/projects'],
    ] as const) {
      const r = await http(s.base, t, 'GET', path);
      expect(r.status, path).toBe(401);
      expect(r.json, path).toEqual({ error: { code: 'TOKEN_REVOKED' } });
    }
    expect(await wsStatus(s.base, token)).toBe(401);

    for (const t of [newToken('personal'), newToken('agent'), 'dev-nobody', 'mlp_']) {
      const r = await http(s.base, t, 'GET', '/v1/me');
      expect(r.status, t).toBe(401);
      expect(r.json, t).toEqual({ error: { code: 'UNAUTHENTICATED' } });
    }
    const none = await http(s.base, null, 'GET', '/v1/me');
    expect(none.json).toEqual({ error: { code: 'UNAUTHENTICATED' } });
    const basic = await fetch(`${s.base}/v1/me`, { headers: { authorization: `Basic ${TOKENS.lin}` } });
    expect(basic.status).toBe(401);
    expect(await wsStatus(s.base, null)).toBe(401);
  });

  it('onRevoked closes only the websockets opened with that token, with code 4401', async () => {
    const a = await insertToken(s, 'personal', IDS.mia, 'app');
    const b = await insertToken(s, 'personal', IDS.mia, 'app');
    const [wa, wb, wd] = await Promise.all([wsOpen(s.base, a.token), wsOpen(s.base, b.token), wsOpen(s.base, TOKENS.mia)]);
    for (const w of [wa, wb, wd]) await w.hello;
    const closed = closeCode(wa.ws!);
    s.auth.revoked(a.id);
    expect(await closed).toBe(4401);
    // The others still receive pushes.
    const subscribed = new Promise<any>((r) => wb.ws!.on('message', (m) => JSON.parse(String(m)).type === 'synced' && r(true)));
    wb.ws!.send(JSON.stringify({ type: 'subscribe', after: 0 }));
    expect(await subscribed).toBe(true);
    expect(wb.ws!.readyState).toBe(WebSocket.OPEN);
    expect(wd.ws!.readyState).toBe(WebSocket.OPEN);
    wb.ws!.close();
    wd.ws!.close();
  });

  it('onRevoked returns an unsubscribe function', () => {
    const seen: string[] = [];
    const off = s.auth.onRevoked((id) => seen.push(id));
    s.auth.revoked('t-1');
    off();
    s.auth.revoked('t-2');
    expect(seen).toEqual(['t-1']);
  });

  it('a dev command still goes through for a dev user', async () => {
    const r = await http(s.base, TOKENS.alex, 'POST', '/v1/commands', cmd('project.created', { projectId: 'p-dev', name: 'Dev project' }));
    expect(r.status).toBe(201);
  });
});

/** An account store whose next `touchToken` waits until released: holds an authentication between its token lookup and its return. */
class GatedAccounts extends MemoryAccountStore {
  private gate: { reached: () => void; wait: Promise<void> } | null = null;

  /** Resolves once the next authentication has looked its token up and is held; call the returned release to let it finish. */
  holdNext(): { reached: Promise<void>; release: () => void } {
    let release!: () => void;
    let reached!: () => void;
    const wait = new Promise<void>((r) => (release = r));
    const hit = new Promise<void>((r) => (reached = r));
    this.gate = { reached, wait };
    return { reached: hit, release };
  }

  override async touchToken(id: string, at: string): Promise<void> {
    const g = this.gate;
    if (g) {
      this.gate = null;
      g.reached();
      await g.wait;
    }
    return super.touchToken(id, at);
  }
}

describe('websocket upgrade edge cases', () => {
  it('a token revoked while its upgrade is being authenticated still closes the socket with 4401', async () => {
    const dir = tempDir('ws-race');
    const cfg = serverConfig({ dataDir: dir.path, databaseUrl: null });
    const service = await SyncService.open({ store: new MemoryEventStore(), blobMeta: new MemoryBlobMetaStore(), blobFiles: new BlobFiles(dir.path) });
    const accounts = new GatedAccounts();
    const auth = new Authenticator(accounts, null, cfg.now);
    const app = await buildApp({ service, accounts, auth, cfg });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    try {
      const token = newToken('personal');
      await accounts.createToken({ id: 't-race', kind: 'personal', userId: IDS.lin, label: 'app', tokenHash: hashSecret(token), createdAt: NOW, lastUsedAt: null, revokedAt: null });
      const held = accounts.holdNext();
      const opening = wsOpen(base, token);
      // The upgrade has found the token unrevoked and is between that check and registering its socket.
      await held.reached;
      expect(await accounts.revokeToken('t-race', IDS.lin, NOW)).toBe(true);
      auth.revoked('t-race');
      held.release();
      const r = await opening;
      expect(r.status).toBe(101);
      const code = await Promise.race([closeCode(r.ws!), new Promise<string>((ok) => setTimeout(() => ok('still open'), 3000))]);
      expect(code).toBe(4401);
    } finally {
      await app.close();
      dir.rm();
    }
  });

  it('the upgrade client address is the one trustProxy hops from the right, exactly as Fastify reports request.ip', async () => {
    const headers = [
      undefined,
      '203.0.113.7',
      '203.0.113.7, 10.0.0.1',
      '  198.51.100.2 ,10.0.0.1, 10.0.0.2',
      ', 192.0.2.9,10.0.0.1',
      '6.6.6.6, 7.7.7.7, 198.51.100.4, 10.0.0.1',
      '',
      ' , ',
    ];
    for (const hops of [0, 1, 2, 3]) {
      const app = Fastify({ trustProxy: fastifyTrustProxy(hops) });
      app.get('/ip', async (req) => ({ ip: req.ip }));
      for (const xff of headers) {
        const h = xff === undefined ? {} : { 'x-forwarded-for': xff };
        const viaFastify = (await app.inject({ method: 'GET', url: '/ip', headers: h, remoteAddress: '127.0.0.5' })).json().ip;
        const raw = { headers: h, socket: { remoteAddress: '127.0.0.5' } } as unknown as IncomingMessage;
        expect(clientIp(raw, hops), `${hops} ${JSON.stringify(xff)}`).toBe(viaFastify);
      }
      await app.close();
    }
    const raw = (xff?: string) => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: '::1' } }) as unknown as IncomingMessage;
    // One proxy: the entry it appended (the rightmost), never the client-supplied leftmost one.
    expect(clientIp(raw('6.6.6.6, 203.0.113.7'), 1)).toBe('203.0.113.7');
    expect(clientIp(raw('6.6.6.6, 203.0.113.7, 10.0.0.1'), 2)).toBe('203.0.113.7');
    expect(clientIp(raw('203.0.113.7, 10.0.0.1'), 0)).toBe('::1');
    expect(clientIp(raw(), 1)).toBe('::1');
    // Fastify itself, given the plain number, trusts nothing (and its types no longer take one): the reason for fastifyTrustProxy.
    const plain = Fastify({ trustProxy: 1 as unknown as boolean });
    plain.get('/ip', async (req) => ({ ip: req.ip }));
    expect((await plain.inject({ method: 'GET', url: '/ip', headers: { 'x-forwarded-for': '203.0.113.7' }, remoteAddress: '127.0.0.5' })).json().ip).toBe('127.0.0.5');
    await plain.close();
  });
});
