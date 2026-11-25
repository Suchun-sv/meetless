import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '@meetless/core';
import { API_ROUTES, CLIENT_HEADER, MCP_TOOL_ROUTE, type ApiName } from '@meetless/api';
import { hashSecret, newToken } from '../src/accounts/secrets';
import { API_STATUS, ApiError, clientOf, defineRoute, type ApiDeps } from '../src/api/frame';
import { HANDLERS } from '../src/api/index';
import { RateLimiter } from '../src/api/ratelimit';
import { Authenticator, DevAuth, type Principal } from '../src/auth';
import { BlobFiles } from '../src/blobs';
import { buildApp } from '../src/http';
import { SyncService } from '../src/service';
import { MemoryAccountStore, MemoryBlobMetaStore, MemoryEventStore } from '../src/store/memory';
import { http, IDS, serverConfig, tempDir, TOKENS, withServer, type TestServer } from './helpers';
import { PRIVATE_WORD, seedTeam } from './seed';

const NOW = '2026-11-24T11:00:00.000Z';
const samplePath = (path: string) => path.replace(/:([A-Za-z_]+)/g, (_m, p: string) => `${p}-1`);

/** A bare Fastify app with in-memory deps: the frame alone, no other routes. */
async function bare(): Promise<{ app: FastifyInstance; deps: ApiDeps; accounts: MemoryAccountStore; done(): Promise<void> }> {
  const dir = tempDir('frame');
  const cfg = serverConfig({ dataDir: dir.path, databaseUrl: null, now: () => new Date(NOW) });
  const service = await SyncService.open({ store: new MemoryEventStore(), blobMeta: new MemoryBlobMetaStore(), blobFiles: new BlobFiles(dir.path), devUsers: cfg.devUsers });
  const accounts = new MemoryAccountStore();
  const auth = new Authenticator(accounts, new DevAuth(cfg.devUsers), cfg.now);
  const app = Fastify();
  const rateLimits = { signIn: new RateLimiter(cfg.rateLimits.signIn, () => cfg.now().getTime()), redeem: new RateLimiter(cfg.rateLimits.redeem, () => cfg.now().getTime()) };
  return {
    app,
    deps: { service, accounts, auth, cfg, rateLimits, skillMarkdown: 'test skill markdown for the bare frame' },
    accounts,
    async done() {
      await app.close();
      dir.rm();
    },
  };
}

async function token(accounts: MemoryAccountStore, kind: 'personal' | 'agent', userId: string, label: string) {
  const t = newToken(kind);
  const id = `t-${randomUUID()}`;
  await accounts.createToken({ id, kind, userId, label, tokenHash: hashSecret(t), createdAt: NOW, lastUsedAt: null, revokedAt: null });
  return { token: t, id };
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe('registered API routes (real server)', () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await withServer();
  });
  afterAll(() => s?.stop());

  it('every API_ROUTES entry is served at its method and path and answers UNAUTHENTICATED without a token unless its auth is none', async () => {
    for (const [name, r] of Object.entries(API_ROUTES)) {
      const res = await http(s.base, null, r.method, samplePath(r.path), r.method === 'POST' ? {} : undefined);
      if (r.auth === 'none') {
        expect(res.status, name).not.toBe(404);
        expect(res.json.error?.code, name).not.toBe('UNAUTHENTICATED');
      } else {
        expect(res.status, name).toBe(401);
        expect(res.json.error.code, name).toBe('UNAUTHENTICATED');
      }
    }
  });

  it('every route without a handler answers NOT_IMPLEMENTED (501) to an authenticated caller; me is served', async () => {
    for (const [name, r] of Object.entries(API_ROUTES) as [ApiName, (typeof API_ROUTES)[ApiName]][]) {
      const res = await http(s.base, TOKENS.lin, r.method, samplePath(r.path), r.method === 'POST' ? {} : undefined);
      if (HANDLERS[name]) {
        expect(res.json.error?.code, name).not.toBe('NOT_IMPLEMENTED');
      } else {
        expect(res.status, name).toBe(501);
        expect(res.json, name).toEqual({ error: { code: 'NOT_IMPLEMENTED' } });
      }
    }
    expect(HANDLERS.me).toBeDefined();
    expect((await http(s.base, TOKENS.lin, 'GET', '/v1/me')).json).toEqual({ user: { id: IDS.lin, displayName: 'Lin An', locale: 'zh-CN' }, devAuth: true });
  });

  it('an unknown path answers 404 NOT_FOUND in the API error shape', async () => {
    const r = await http(s.base, TOKENS.lin, 'GET', '/v1/nothing-here');
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: { code: 'NOT_FOUND' } });
  });

  // Task 10: agent.guide was the last route without a handler; every API_ROUTES entry now has one.
  it('no route answers NOT_IMPLEMENTED any more', async () => {
    for (const [name, r] of Object.entries(API_ROUTES) as [ApiName, (typeof API_ROUTES)[ApiName]][]) {
      expect(HANDLERS[name], name).toBeDefined();
      const res = await http(s.base, TOKENS.lin, r.method, samplePath(r.path), r.method === 'POST' ? {} : undefined);
      expect(res.json?.error?.code, name).not.toBe('NOT_IMPLEMENTED');
    }
  });
});

describe('defineRoute', () => {
  let b: Awaited<ReturnType<typeof bare>>;
  afterEach(async () => {
    await b?.done();
  });

  it('path params are decoded and limit and round arrive as numbers', async () => {
    b = await bare();
    const seen: unknown[] = [];
    defineRoute(b.app, b.deps, 'needs.list', async ({ req }) => {
      seen.push(req);
      return { needs: [] };
    });
    defineRoute(b.app, b.deps, 'search', async ({ req }) => {
      seen.push(req);
      return { hits: [] };
    });
    const r = await b.app.inject({ method: 'GET', url: '/v1/projects/p%201/needs?round=2&kind=hyp', headers: bearer(TOKENS.lin) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ needs: [] });
    expect(seen[0]).toEqual({ projectId: 'p 1', round: 2, kind: 'hyp' });
    await b.app.inject({ method: 'GET', url: '/v1/projects/p1/needs?round=current', headers: bearer(TOKENS.lin) });
    expect(seen[1]).toEqual({ projectId: 'p1', round: 'current' });
    await b.app.inject({ method: 'GET', url: '/v1/search?q=export&limit=10', headers: bearer(TOKENS.lin) });
    expect(seen[2]).toEqual({ q: 'export', limit: 10 });
    // Only plain digits convert; anything else stays a string for the handler to refuse.
    await b.app.inject({ method: 'GET', url: '/v1/search?q=7&limit=1e3', headers: bearer(TOKENS.lin) });
    expect(seen[3]).toEqual({ q: '7', limit: '1e3' });
    // A query key cannot override a path param.
    await b.app.inject({ method: 'GET', url: '/v1/projects/p1/needs?projectId=p2', headers: bearer(TOKENS.lin) });
    expect(seen[4]).toEqual({ projectId: 'p1' });
    // A repeated query key is a bad request, not an array the handler did not expect.
    const rep = await b.app.inject({ method: 'GET', url: '/v1/search?q=a&q=b', headers: bearer(TOKENS.lin) });
    expect(rep.statusCode).toBe(400);
    expect(rep.json()).toEqual({ error: { code: 'BAD_REQUEST' } });
    expect(seen).toHaveLength(5);
  });

  it('a POST request is the JSON body plus the path params, and the path wins', async () => {
    b = await bare();
    const seen: unknown[] = [];
    defineRoute(b.app, b.deps, 'work.record', async ({ req }) => {
      seen.push(req);
      return { workId: 'w1', seq: 1 };
    });
    const ok = await b.app.inject({ method: 'POST', url: '/v1/projects/p1/work', headers: bearer(TOKENS.lin), payload: { projectId: 'p2', code: 'N1', text: 'done' } });
    expect(ok.statusCode).toBe(200);
    expect(seen[0]).toEqual({ projectId: 'p1', code: 'N1', text: 'done' });
    const empty = await b.app.inject({ method: 'POST', url: '/v1/projects/p1/work', headers: bearer(TOKENS.lin) });
    expect(empty.statusCode).toBe(200);
    expect(seen[1]).toEqual({ projectId: 'p1' });
    const arr = await b.app.inject({ method: 'POST', url: '/v1/projects/p1/work', headers: { ...bearer(TOKENS.lin), 'content-type': 'application/json' }, payload: '[1,2]' });
    expect(arr.statusCode).toBe(400);
    expect(arr.json()).toEqual({ error: { code: 'BAD_REQUEST' } });
    expect(seen).toHaveLength(2);
  });

  it("auth 'user' takes personal and dev tokens and refuses agent tokens; 'agent' takes all three; 'none' needs no token", async () => {
    b = await bare();
    const seen: (Principal | null)[] = [];
    defineRoute(b.app, b.deps, 'tokens.list', async ({ p }) => {
      seen.push(p);
      return { tokens: [] };
    });
    defineRoute(b.app, b.deps, 'projects.list', async ({ p }) => {
      seen.push(p);
      return { projects: [] };
    });
    defineRoute(b.app, b.deps, 'invites.redeem', async ({ p, req }) => {
      seen.push(p);
      return { token: 'x', user: { id: 'u-x', displayName: req.displayName, locale: 'en' }, projectId: null };
    });
    const personal = await token(b.accounts, 'personal', IDS.lin, 'app');
    const agent = await token(b.accounts, 'agent', IDS.lin, 'codex');
    const get = (url: string, t: string) => b.app.inject({ method: 'GET', url, headers: bearer(t) });

    expect((await get('/v1/tokens', personal.token)).statusCode).toBe(200);
    expect((await get('/v1/tokens', TOKENS.lin)).statusCode).toBe(200);
    const refused = await get('/v1/tokens', agent.token);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({ error: { code: 'NOT_AUTHORISED' } });
    for (const t of [personal.token, TOKENS.lin, agent.token]) expect((await get('/v1/projects', t)).statusCode).toBe(200);
    expect(seen).toEqual([
      { userId: IDS.lin, kind: 'personal', tokenId: personal.id, label: 'app', via: 'bearer' },
      { userId: IDS.lin, kind: 'dev', tokenId: null, label: null, via: 'bearer' },
      { userId: IDS.lin, kind: 'personal', tokenId: personal.id, label: 'app', via: 'bearer' },
      { userId: IDS.lin, kind: 'dev', tokenId: null, label: null, via: 'bearer' },
      { userId: IDS.lin, kind: 'agent', tokenId: agent.id, label: 'codex', via: 'bearer' },
    ]);
    const redeem = await b.app.inject({ method: 'POST', url: '/v1/invites/redeem', payload: { code: 'x', displayName: 'Kai', locale: 'en' } });
    expect(redeem.statusCode).toBe(200);
    expect(redeem.json().user.displayName).toBe('Kai');
    expect(seen[5]).toBeNull();
  });

  it('agent-token calls on MCP routes are recorded with tool, project, need code, client, ok and error code; personal-token calls are not', async () => {
    b = await bare();
    defineRoute(b.app, b.deps, 'context.get', async ({ req }) => {
      if (req.code !== 'N1') throw new ApiError('NOT_FOUND');
      return { markdown: '# N1' } as never;
    });
    defineRoute(b.app, b.deps, 'search', async () => ({ hits: [] }));
    defineRoute(b.app, b.deps, 'projects.list', async () => ({ projects: [] }));
    const agent = await token(b.accounts, 'agent', IDS.lin, 'claude-code');
    const personal = await token(b.accounts, 'personal', IDS.lin, 'app');

    const miss = await b.app.inject({ method: 'GET', url: '/v1/projects/p1/needs/N9/context', headers: { ...bearer(agent.token), [CLIENT_HEADER]: 'codex' } });
    expect(miss.statusCode).toBe(404);
    expect(miss.json()).toEqual({ error: { code: 'NOT_FOUND' } });
    const hit = await b.app.inject({ method: 'GET', url: '/v1/projects/p1/needs/N1/context', headers: bearer(agent.token) });
    expect(hit.statusCode).toBe(200);
    await b.app.inject({ method: 'GET', url: '/v1/search?q=export', headers: { ...bearer(agent.token), [CLIENT_HEADER]: 'codex' } });
    // Not recorded: a personal or dev token on an MCP route, and an agent token on a route no tool targets.
    await b.app.inject({ method: 'GET', url: '/v1/projects/p1/needs/N1/context', headers: bearer(personal.token) });
    await b.app.inject({ method: 'GET', url: '/v1/projects/p1/needs/N1/context', headers: bearer(TOKENS.lin) });
    await b.app.inject({ method: 'GET', url: '/v1/projects', headers: bearer(agent.token) });

    const calls = (await b.accounts.listCalls(IDS.lin, 10)).reverse();
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ tool: 'get_need_context', projectId: 'p1', needCode: 'N9', client: 'codex', ok: false, code: 'NOT_FOUND', tokenId: agent.id, userId: IDS.lin, at: NOW });
    expect(calls[1]).toMatchObject({ tool: 'get_need_context', projectId: 'p1', needCode: 'N1', client: 'claude-code', ok: true, code: null });
    expect(calls[2]).toMatchObject({ tool: 'search', projectId: null, needCode: null, client: 'codex', ok: true, code: null });
    expect(new Set(calls.map((c) => c.id)).size).toBe(3);
    // Every tool names a route; the frame reverses that map.
    expect(Object.values(MCP_TOOL_ROUTE).every((n) => n in API_ROUTES)).toBe(true);
  });

  it('clientOf uses the client header, then the token label, then unknown', async () => {
    b = await bare();
    const seen: string[] = [];
    defineRoute(b.app, b.deps, 'projects.list', async ({ p, http: req }) => {
      seen.push(clientOf(p, req));
      return { projects: [] };
    });
    const agent = await token(b.accounts, 'agent', IDS.lin, 'claude-code');
    await b.app.inject({ method: 'GET', url: '/v1/projects', headers: { ...bearer(agent.token), [CLIENT_HEADER]: 'codex' } });
    await b.app.inject({ method: 'GET', url: '/v1/projects', headers: bearer(agent.token) });
    await b.app.inject({ method: 'GET', url: '/v1/projects', headers: bearer(TOKENS.lin) });
    await b.app.inject({ method: 'GET', url: '/v1/projects', headers: { ...bearer(TOKENS.lin), [CLIENT_HEADER]: 'desktop' } });
    expect(seen).toEqual(['codex', 'claude-code', 'unknown', 'desktop']);
  });

  it('API_STATUS maps API codes to HTTP statuses, and any other DomainError to 422', async () => {
    expect(API_STATUS).toEqual({
      BAD_REQUEST: 400,
      UNAUTHENTICATED: 401,
      TOKEN_REVOKED: 401,
      NOT_AUTHORISED: 403,
      NOT_A_MEMBER: 403,
      CSRF_FAILED: 403,
      NOT_FOUND: 404,
      INVITE_INVALID: 404,
      INVITE_USED: 409,
      ALREADY_EXISTS: 409,
      TOO_LARGE: 413,
      EXTRACT_FAILED: 422,
      RATE_LIMITED: 429,
      NOT_IMPLEMENTED: 501,
      NOT_AVAILABLE: 503,
    });
    b = await bare();
    let next: unknown = null;
    defineRoute(b.app, b.deps, 'projects.list', async () => {
      throw next;
    });
    const cases: [unknown, number, object][] = [
      [new ApiError('INVITE_USED'), 409, { code: 'INVITE_USED' }],
      [new DomainError('ALREADY_EXISTS', 'taken', { what: 'input', id: 'in-1' }), 409, { code: 'ALREADY_EXISTS', details: { what: 'input', id: 'in-1' } }],
      [new ApiError('NOT_AVAILABLE', { reason: 'unavailable' }), 503, { code: 'NOT_AVAILABLE', details: { reason: 'unavailable' } }],
      [new ApiError('RATE_LIMITED', { retryAfter: 42 }), 429, { code: 'RATE_LIMITED', details: { retryAfter: 42 } }],
      [new DomainError('NOT_A_MEMBER', 'u-lin is not a member of p1'), 403, { code: 'NOT_A_MEMBER', details: {} }],
      [new DomainError('NOT_FOUND', 'need', { what: 'need', id: 'n1' }), 404, { code: 'NOT_FOUND', details: { what: 'need', id: 'n1' } }],
      [new DomainError('INVALID_EVENT', 'bad'), 422, { code: 'INVALID_EVENT', details: {} }],
      [new DomainError('PRIVATE_ITEM', 'share first'), 422, { code: 'PRIVATE_ITEM', details: {} }],
      [new Error('boom with a secret in it'), 500, { code: 'INTERNAL' }],
    ];
    for (const [err, status, error] of cases) {
      next = err;
      const r = await b.app.inject({ method: 'GET', url: '/v1/projects', headers: bearer(TOKENS.lin) });
      expect(r.statusCode, String(err)).toBe(status);
      expect(r.json(), String(err)).toEqual({ error });
      if (err instanceof ApiError && err.code === 'RATE_LIMITED') expect(r.headers['retry-after'], String(err)).toBe('42');
    }
  });

  it('every non-2xx body has the shape { error: { code } }', async () => {
    b = await bare();
    defineRoute(b.app, b.deps, 'work.record', async () => {
      throw new DomainError('INVALID_EVENT', 'text required');
    });
    defineRoute(b.app, b.deps, 'projects.list', async () => {
      throw new TypeError('x is undefined');
    });
    const personal = await token(b.accounts, 'personal', IDS.lin, 'app');
    await b.accounts.revokeToken(personal.id, IDS.lin, NOW);
    const agent = await token(b.accounts, 'agent', IDS.lin, 'codex');
    const json = { 'content-type': 'application/json' };
    const responses = await Promise.all([
      b.app.inject({ method: 'GET', url: '/v1/projects' }),
      b.app.inject({ method: 'GET', url: '/v1/projects', headers: bearer(personal.token) }),
      b.app.inject({ method: 'GET', url: '/v1/projects', headers: bearer(TOKENS.lin) }),
      b.app.inject({ method: 'POST', url: '/v1/projects/p1/work', headers: { ...bearer(TOKENS.lin), ...json }, payload: '{not json' }),
      b.app.inject({ method: 'POST', url: '/v1/projects/p1/work', headers: { ...bearer(TOKENS.lin), ...json }, payload: JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024) }) }),
      b.app.inject({ method: 'POST', url: '/v1/projects/p1/work', headers: { ...bearer(agent.token), ...json }, payload: '{}' }),
    ]);
    expect(responses.map((r) => [r.statusCode, r.json().error?.code])).toEqual([
      [401, 'UNAUTHENTICATED'],
      [401, 'TOKEN_REVOKED'],
      [500, 'INTERNAL'],
      [400, 'BAD_REQUEST'],
      [413, 'TOO_LARGE'],
      [422, 'INVALID_EVENT'],
    ]);
    for (const r of responses) {
      const body = r.json();
      expect(Object.keys(body)).toEqual(['error']);
      expect(typeof body.error.code).toBe('string');
      expect(r.body).not.toContain('x is undefined');
    }
    // The failed agent call on an MCP route is still recorded.
    expect(await b.accounts.listCalls(IDS.lin, 10)).toMatchObject([{ tool: 'record_work', ok: false, code: 'INVALID_EVENT', projectId: 'p1' }]);
  });
});

describe('buildApp', () => {
  it('trustProxy (a hop count) makes request.ip the address the proxy appended, never a spoofed leftmost entry', async () => {
    for (const trustProxy of [1, 0]) {
      const dir = tempDir('proxy');
      const cfg = serverConfig({ dataDir: dir.path, databaseUrl: null, trustProxy });
      const service = await SyncService.open({ store: new MemoryEventStore(), blobMeta: new MemoryBlobMetaStore(), blobFiles: new BlobFiles(dir.path) });
      const accounts = new MemoryAccountStore();
      const app = await buildApp({ service, accounts, auth: new Authenticator(accounts, null, cfg.now), cfg });
      app.get('/test-ip', async (req) => ({ ip: req.ip }));
      const r = await app.inject({ method: 'GET', url: '/test-ip', headers: { 'x-forwarded-for': '203.0.113.7' }, remoteAddress: '127.0.0.1' });
      expect(r.json().ip, String(trustProxy)).toBe(trustProxy ? '203.0.113.7' : '127.0.0.1');
      const spoofed = await app.inject({ method: 'GET', url: '/test-ip', headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }, remoteAddress: '127.0.0.1' });
      expect(spoofed.json().ip, String(trustProxy)).toBe(trustProxy ? '203.0.113.7' : '127.0.0.1');
      await app.close();
      dir.rm();
    }
  });
});

describe('seedTeam', () => {
  it('builds p1 as described, and only Alex can see the private items', async () => {
    const s = await withServer();
    try {
      const team = await seedTeam(s.base);
      const st = s.svc.current;
      expect([...st.projects.p1!.memberIds].sort()).toEqual([IDS.alex, IDS.lin, IDS.zhou].sort());
      expect(st.roles[team.roleId]).toMatchObject({ projectId: 'p1', memberIds: [IDS.lin] });
      expect(st.rounds[team.roundId]).toMatchObject({ projectId: 'p1', status: 'current' });
      expect(st.needs[team.needs.N1]).toMatchObject({ code: 'N1', kind: 'ext', privateTo: null, roundId: team.roundId });
      expect(st.needs[team.needs.H1]).toMatchObject({ code: 'H1', kind: 'hyp', privateTo: null });
      expect(st.needs[team.needs.Hp1]).toMatchObject({ code: 'Hp1', kind: 'hyp', privateTo: IDS.alex, title: 'zebrafish dosing' });
      expect(st.handoffs[team.handoffId]).toMatchObject({ projectId: 'p1', needId: team.needs.N1, fromId: IDS.alex, toId: IDS.lin });
      expect(st.artifacts[team.artifacts.deck]).toMatchObject({ kind: 'pdf', privateTo: null, needIds: [team.needs.N1], versions: [] });
      expect(st.artifacts[team.artifacts.secret]).toMatchObject({ kind: 'docx', privateTo: IDS.alex, needIds: [team.needs.Hp1], versions: [] });
      expect(s.svc.readable(IDS.eve).size).toBe(0);
      // The private word is in Alex's view and in nobody else's, nor in any id.
      expect(JSON.stringify(s.svc.view(IDS.alex))).toContain(PRIVATE_WORD);
      for (const u of [IDS.lin, IDS.zhou, IDS.eve]) expect(JSON.stringify(s.svc.view(u)), u).not.toContain(PRIVATE_WORD);
      expect(JSON.stringify(team)).not.toContain(PRIVATE_WORD);
      expect(JSON.stringify((await http(s.base, TOKENS.lin, 'GET', '/v1/events?after=0')).json)).not.toContain(PRIVATE_WORD);
    } finally {
      await s.stop();
    }
  });
});
