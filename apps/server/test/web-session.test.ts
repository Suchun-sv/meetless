import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { WEB_CSRF_COOKIE, WEB_CSRF_HEADER, WEB_SESSION_COOKIE, WEB_SESSION_PATH } from '@meetless/api';
import { hashSecret, newToken } from '../src/accounts/secrets';
import { sha256 } from '../src/index';
import { allowedOrigins, checkCsrf, parseCookies, rawRequestTarget } from '../src/web/cookies';
import { http, IDS, make, TOKENS, withServer, type TestServer } from './helpers';

const EVIL = 'https://evil.example';
const AGENT_URL = 'https://meetless.example/some/base/';
const AGENT_ORIGIN = 'https://meetless.example';
const MAX_AGE = '2592000';

interface Res {
  status: number;
  json: any;
  text: string;
  headers: Headers;
  setCookies: string[];
}

/** One HTTP call with full control over the cookie, Origin, CSRF and bearer headers. */
async function call(
  base: string,
  method: string,
  path: string,
  o: { cookie?: string; origin?: string; csrf?: string; bearer?: string; body?: unknown; raw?: Uint8Array; headers?: Record<string, string> } = {},
): Promise<Res> {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.cookie !== undefined) headers.cookie = o.cookie;
  if (o.origin !== undefined) headers.origin = o.origin;
  if (o.csrf !== undefined) headers[WEB_CSRF_HEADER] = o.csrf;
  if (o.bearer !== undefined) headers.authorization = `Bearer ${o.bearer}`;
  let body: Uint8Array | string | undefined;
  if (o.raw !== undefined) {
    headers['content-type'] = 'application/octet-stream';
    body = o.raw;
  } else if (o.body !== undefined) {
    headers['content-type'] ??= 'application/json';
    body = JSON.stringify(o.body);
  }
  const res = await fetch(`${base}${path}`, { method, headers, body });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, text, headers: res.headers, setCookies: res.headers.getSetCookie() };
}

interface SetCookie {
  name: string;
  value: string;
  /** Every attribute: `name -> value`, or `true` for a flag. */
  attrs: Record<string, string | true>;
}

function parseSetCookie(line: string): SetCookie {
  const [pair, ...rest] = line.split(';').map((p) => p.trim());
  const eq = pair!.indexOf('=');
  const attrs: Record<string, string | true> = {};
  for (const a of rest) {
    if (a === '') continue;
    const i = a.indexOf('=');
    attrs[i === -1 ? a : a.slice(0, i)] = i === -1 ? true : a.slice(i + 1);
  }
  return { name: pair!.slice(0, eq), value: pair!.slice(eq + 1), attrs };
}

function cookiesOf(r: Res): Record<string, SetCookie> {
  const out: Record<string, SetCookie> = {};
  for (const line of r.setCookies) {
    const c = parseSetCookie(line);
    out[c.name] = c;
  }
  return out;
}

const SESSION_ATTRS = { 'Max-Age': MAX_AGE, Path: '/', HttpOnly: true, Secure: true, SameSite: 'Lax' };
const CSRF_ATTRS = { 'Max-Age': MAX_AGE, Path: '/', Secure: true, SameSite: 'Lax' };

/** What a browser would hold after a sign-in: the cookie header to send and the CSRF value script can read. */
interface Jar {
  session: string;
  csrf: string;
  cookie: string;
}

function jarOf(r: Res): Jar {
  const c = cookiesOf(r);
  const session = c[WEB_SESSION_COOKIE]!.value;
  const csrf = c[WEB_CSRF_COOKIE]!.value;
  return { session, csrf, cookie: `${WEB_SESSION_COOKIE}=${session}; ${WEB_CSRF_COOKIE}=${csrf}` };
}

async function signIn(base: string, body: unknown, origin: string | undefined = base): Promise<{ res: Res; jar: Jar }> {
  const res = await call(base, 'POST', WEB_SESSION_PATH, { origin, body });
  if (res.status !== 200) throw new Error(`sign-in answered ${res.status} ${res.text}`);
  return { res, jar: jarOf(res) };
}

async function personalToken(s: TestServer, userId: string): Promise<string> {
  const t = newToken('personal');
  await s.accounts.createToken({
    id: `t-${randomUUID()}`,
    kind: 'personal',
    userId,
    label: 'app',
    tokenHash: hashSecret(t),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  });
  return t;
}

/** A /v1/ws upgrade: 101 with the first message, or the HTTP status of the refusal. */
function wsTry(
  base: string,
  o: { cookie?: string; origin?: string; bearer?: string; headers?: Record<string, string> },
): Promise<{ status: number; ws?: WebSocket; first?: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.cookie) headers.cookie = o.cookie;
    if (o.bearer) headers.authorization = `Bearer ${o.bearer}`;
    const ws = new WebSocket(`${base.replace('http', 'ws')}/v1/ws`, { headers, ...(o.origin ? { origin: o.origin } : {}) });
    ws.once('unexpected-response', (_req, res) => {
      resolve({ status: res.statusCode ?? 0 });
      ws.terminate();
    });
    ws.once('message', (raw) => resolve({ status: 101, ws, first: JSON.parse(String(raw)) }));
    ws.once('error', (e) => reject(e));
  });
}

describe('web sessions (cookie auth, CSRF, Origin, sign-in and sign-out)', () => {
  let s: TestServer;

  beforeAll(async () => {
    s = await withServer({ agentUrl: AGENT_URL });
    const r = await http(s.base, TOKENS.alex, 'POST', '/v1/commands', make.project('p1', 'Web project'));
    expect(r.status).toBe(201);
  });
  afterAll(() => s?.stop());

  it('invite sign-in sets both cookies with the exact flags and returns only the user', async () => {
    const inv = await http(s.base, TOKENS.alex, 'POST', '/v1/projects/p1/invites', { roleId: null });
    expect(inv.status).toBe(200);
    const res = await call(s.base, 'POST', WEB_SESSION_PATH, { origin: s.base, body: { code: inv.json.code, displayName: 'Ana', locale: 'en' } });
    expect(res.status).toBe(200);

    expect(res.setCookies).toHaveLength(2);
    const c = cookiesOf(res);
    expect(c[WEB_SESSION_COOKIE]!.value).toMatch(/^mlp_[A-Za-z0-9_-]{43}$/);
    expect(c[WEB_SESSION_COOKIE]!.attrs).toEqual(SESSION_ATTRS);
    expect(c[WEB_CSRF_COOKIE]!.value).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(c[WEB_CSRF_COOKIE]!.attrs).toEqual(CSRF_ATTRS);

    expect(res.json).toEqual({ user: { id: expect.stringMatching(/^u-[a-z]{10}$/), displayName: 'Ana', locale: 'en' } });
    expect(Object.keys(res.json)).toEqual(['user']);
    expect(Object.keys(res.json.user).sort()).toEqual(['displayName', 'id', 'locale']);
    expect(res.text).not.toContain('mlp_');
    expect(res.text).not.toContain(c[WEB_CSRF_COOKIE]!.value);
    expect(res.headers.get('cache-control')).toBe('no-store');

    // The cookie alone is the session.
    const me = await call(s.base, 'GET', '/v1/me', { cookie: jarOf(res).cookie });
    expect(me.status).toBe(200);
    expect(me.json.user).toEqual(res.json.user);
  });

  it('token sign-in mints a separate web token and leaves the pasted token working', async () => {
    const pasted = await personalToken(s, IDS.alex);
    const { res, jar } = await signIn(s.base, { token: pasted });
    expect(res.json).toEqual({ user: { id: IDS.alex, displayName: 'Alex', locale: 'zh-CN' } });
    expect(res.text).not.toContain('mlp_');
    expect(jar.session).toMatch(/^mlp_/);
    expect(jar.session).not.toBe(pasted);
    const row = await s.accounts.tokenByHash(hashSecret(jar.session));
    expect(row).toMatchObject({ kind: 'personal', userId: IDS.alex, label: 'web', revokedAt: null });

    expect((await call(s.base, 'GET', '/v1/me', { cookie: jar.cookie })).json.user.id).toBe(IDS.alex);

    const out = await call(s.base, 'DELETE', WEB_SESSION_PATH, { cookie: jar.cookie, csrf: jar.csrf, origin: s.base });
    expect(out.status).toBe(200);

    const stillPasted = await call(s.base, 'GET', '/v1/me', { bearer: pasted });
    expect(stillPasted.status).toBe(200);
    expect(stillPasted.json.user.id).toBe(IDS.alex);
    const gone = await call(s.base, 'GET', '/v1/me', { cookie: jar.cookie });
    expect(gone.status).toBe(401);
    expect(gone.json).toEqual({ error: { code: 'TOKEN_REVOKED' } });
  });

  it('agent tokens cannot sign in to the web', async () => {
    const created = await http(s.base, TOKENS.alex, 'POST', '/v1/tokens', { label: 'web-refused' });
    expect(created.json.token).toMatch(/^mla_/);
    const res = await call(s.base, 'POST', WEB_SESSION_PATH, { origin: s.base, body: { token: created.json.token } });
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: { code: 'NOT_AUTHORISED' } });
    expect(res.setCookies).toEqual([]);

    // An agent token put into the cookie by hand is not a session either.
    const forged = await call(s.base, 'GET', '/v1/me', { cookie: `${WEB_SESSION_COOKIE}=${created.json.token}` });
    expect(forged.status).toBe(401);
    expect(forged.json).toEqual({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('dev tokens sign in only while dev auth is on', async () => {
    const { jar } = await signIn(s.base, { token: TOKENS.ben });
    expect(jar.session).toMatch(/^mlp_/);
    expect(jar.session).not.toBe(TOKENS.ben);
    expect((await call(s.base, 'GET', '/v1/me', { cookie: jar.cookie })).json.user.id).toBe(IDS.ben);
    // A dev token in the cookie itself is never a session.
    const raw = await call(s.base, 'GET', '/v1/me', { cookie: `${WEB_SESSION_COOKIE}=${TOKENS.ben}` });
    expect(raw.status).toBe(401);

    const off = await withServer({ devAuth: false });
    try {
      const res = await call(off.base, 'POST', WEB_SESSION_PATH, { origin: off.base, body: { token: TOKENS.ben } });
      expect(res.status).toBe(401);
      expect(res.json).toEqual({ error: { code: 'UNAUTHENTICATED' } });
      expect(res.setCookies).toEqual([]);
    } finally {
      await off.stop();
    }
  });

  it('a malformed sign-in body is BAD_REQUEST', async () => {
    for (const body of [{}, { token: 7 }, { token: '' }, { code: 'X' }]) {
      const res = await call(s.base, 'POST', WEB_SESSION_PATH, { origin: s.base, body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.json.error.code).toBe('BAD_REQUEST');
      expect(res.setCookies).toEqual([]);
    }
  });

  it('the cookie authenticates /v1/me, /v1/events, blobs and app routes, never /mcp or MCP-only routes', async () => {
    const { jar } = await signIn(s.base, { token: TOKENS.alex });
    const cookie = jar.cookie;

    expect((await call(s.base, 'GET', '/v1/me', { cookie })).status).toBe(200);
    const events = await call(s.base, 'GET', '/v1/events?after=0', { cookie });
    expect(events.status).toBe(200);
    expect(Array.isArray(events.json.events)).toBe(true);
    expect((await call(s.base, 'GET', '/v1/tokens', { cookie })).status).toBe(200);

    const bytes = new TextEncoder().encode(`web blob ${randomUUID()}`);
    const hash = sha256(bytes);
    const put = await call(s.base, 'PUT', `/v1/blobs/${hash}`, { cookie, csrf: jar.csrf, origin: s.base, raw: bytes });
    expect(put.status).toBe(200);
    expect(put.json).toEqual({ hash, size: bytes.byteLength });
    const get = await call(s.base, 'GET', `/v1/blobs/${hash}`, { cookie });
    expect(get.status).toBe(200);
    expect(get.text).toBe(new TextDecoder().decode(bytes));

    const mcpOnly = await call(s.base, 'GET', '/v1/projects', { cookie });
    expect(mcpOnly.status).toBe(401);
    expect(mcpOnly.json).toEqual({ error: { code: 'UNAUTHENTICATED' } });
    const mcp = await call(s.base, 'POST', '/mcp', {
      cookie,
      csrf: jar.csrf,
      origin: s.base,
      headers: { accept: 'application/json, text/event-stream' },
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(mcp.status).toBe(401);
    expect(mcp.json).toEqual({ error: { code: 'UNAUTHENTICATED' } });

    // A bearer header always wins over the cookie.
    const both = await call(s.base, 'GET', '/v1/me', { cookie, bearer: TOKENS.lin });
    expect(both.json.user.id).toBe(IDS.lin);
  });

  it('cookie writes need the CSRF header', async () => {
    const { jar } = await signIn(s.base, { token: TOKENS.alex });
    const post = (o: { csrf?: string; origin?: string }) =>
      call(s.base, 'POST', '/v1/commands', { cookie: jar.cookie, body: make.project(`p-csrf-${randomUUID()}`), ...o });

    const none = await post({ origin: s.base });
    expect(none.status).toBe(403);
    expect(none.json).toEqual({ error: { code: 'CSRF_FAILED' } });
    const wrong = await post({ csrf: `${jar.csrf.slice(0, -1)}${jar.csrf.endsWith('A') ? 'B' : 'A'}`, origin: s.base });
    expect(wrong.status).toBe(403);
    expect(wrong.json.error.code).toBe('CSRF_FAILED');
    const short = await post({ csrf: 'x', origin: s.base });
    expect(short.status).toBe(403);

    expect((await post({ csrf: jar.csrf, origin: s.base })).status).toBe(201);
    expect((await post({ csrf: jar.csrf, origin: AGENT_ORIGIN })).status).toBe(201);
    const evil = await post({ csrf: jar.csrf, origin: EVIL });
    expect(evil.status).toBe(403);
    expect(evil.json.error.code).toBe('CSRF_FAILED');
    expect((await post({ csrf: jar.csrf, origin: 'null' })).status).toBe(403);

    // The header without a matching cookie is not enough (double submit).
    const noCsrfCookie = await call(s.base, 'POST', '/v1/commands', {
      cookie: `${WEB_SESSION_COOKIE}=${jar.session}`,
      csrf: jar.csrf,
      origin: s.base,
      body: make.project(`p-csrf-${randomUUID()}`),
    });
    expect(noCsrfCookie.status).toBe(403);

    // Typed frame routes take the same check.
    const frame = await call(s.base, 'POST', '/v1/tokens', { cookie: jar.cookie, origin: s.base, body: { label: 'via-cookie' } });
    expect(frame.status).toBe(403);
    expect(frame.json).toEqual({ error: { code: 'CSRF_FAILED' } });
    const frameOk = await call(s.base, 'POST', '/v1/tokens', { cookie: jar.cookie, csrf: jar.csrf, origin: s.base, body: { label: 'via-cookie' } });
    expect(frameOk.status).toBe(200);

    // Reads need no header.
    expect((await call(s.base, 'GET', '/v1/me', { cookie: jar.cookie, origin: EVIL })).status).toBe(200);

    // Bearer requests carry no ambient credential and are exempt.
    const bearer = await call(s.base, 'POST', '/v1/commands', { bearer: TOKENS.alex, body: make.project(`p-csrf-${randomUUID()}`) });
    expect(bearer.status).toBe(201);
  });

  it('login CSRF: a cross-origin sign-in is refused', async () => {
    const evil = await call(s.base, 'POST', WEB_SESSION_PATH, { origin: EVIL, body: { token: TOKENS.alex } });
    expect(evil.status).toBe(403);
    expect(evil.json).toEqual({ error: { code: 'CSRF_FAILED' } });
    expect(evil.setCookies).toEqual([]);

    const agentOrigin = await call(s.base, 'POST', WEB_SESSION_PATH, { origin: AGENT_ORIGIN, body: { token: TOKENS.alex } });
    expect(agentOrigin.status).toBe(200);
    expect(agentOrigin.setCookies).toHaveLength(2);

    // No Origin at all (a non-browser client) is allowed on sign-in.
    const noOrigin = await call(s.base, 'POST', WEB_SESSION_PATH, { body: { token: TOKENS.alex } });
    expect(noOrigin.status).toBe(200);

    // A cross-origin sign-out is refused too, and the session stays.
    const { jar } = await signIn(s.base, { token: TOKENS.alex });
    const out = await call(s.base, 'DELETE', WEB_SESSION_PATH, { cookie: jar.cookie, csrf: jar.csrf, origin: EVIL });
    expect(out.status).toBe(403);
    expect(out.json.error.code).toBe('CSRF_FAILED');
    expect((await call(s.base, 'GET', '/v1/me', { cookie: jar.cookie })).status).toBe(200);
  });

  it('failed cookie sign-ins count on the sign-in limiter', async () => {
    const lim = await withServer({ rateLimits: { signIn: { limit: 10, windowMs: 60_000 }, redeem: { limit: 10, windowMs: 60_000 } } });
    try {
      const bad = `${WEB_SESSION_COOKIE}=${newToken('personal')}`;
      for (let i = 0; i < 10; i++) {
        const r = await call(lim.base, 'GET', '/v1/me', { cookie: bad });
        expect(r.status, `attempt ${i + 1}`).toBe(401);
      }
      const over = await call(lim.base, 'GET', '/v1/me', { cookie: bad });
      expect(over.status).toBe(429);
      expect(over.json.error.code).toBe('RATE_LIMITED');
      expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
      // Token sign-in shares the same limiter.
      const tokenSignIn = await call(lim.base, 'POST', WEB_SESSION_PATH, { origin: lim.base, body: { token: newToken('personal') } });
      expect(tokenSignIn.status).toBe(429);

      for (let i = 0; i < 10; i++) {
        const r = await call(lim.base, 'POST', WEB_SESSION_PATH, { origin: lim.base, body: { code: 'ZZZZ-ZZZZ-ZZZZ', displayName: 'X', locale: 'en' } });
        expect(r.status, `redeem ${i + 1}`).toBe(404);
        expect(r.json.error.code).toBe('INVITE_INVALID');
      }
      const redeemOver = await call(lim.base, 'POST', WEB_SESSION_PATH, { origin: lim.base, body: { code: 'ZZZZ-ZZZZ-ZZZZ', displayName: 'X', locale: 'en' } });
      expect(redeemOver.status).toBe(429);
      expect(redeemOver.json.error.code).toBe('RATE_LIMITED');
      expect(Number(redeemOver.headers.get('retry-after'))).toBeGreaterThan(0);
    } finally {
      await lim.stop();
    }
  });

  it('the websocket takes the cookie only from an allowed Origin', async () => {
    const { jar } = await signIn(s.base, { token: TOKENS.lin });

    const ok = await wsTry(s.base, { cookie: jar.cookie, origin: s.base });
    expect(ok.status).toBe(101);
    expect(ok.first).toMatchObject({ type: 'hello', userId: IDS.lin });
    ok.ws!.terminate();

    expect((await wsTry(s.base, { cookie: jar.cookie, origin: EVIL })).status).toBe(403);
    expect((await wsTry(s.base, { cookie: jar.cookie })).status).toBe(403);
    expect((await wsTry(s.base, { cookie: `${WEB_SESSION_COOKIE}=${newToken('personal')}`, origin: s.base })).status).toBe(401);

    // Bearer sockets are unchanged: no Origin needed.
    const bearer = await wsTry(s.base, { bearer: TOKENS.lin });
    expect(bearer.status).toBe(101);
    bearer.ws!.terminate();
  });

  it('sign-out revokes the token, closes its sockets with 4401 and clears both cookies', async () => {
    const { jar } = await signIn(s.base, { token: TOKENS.zhou });
    const open = await wsTry(s.base, { cookie: jar.cookie, origin: s.base });
    expect(open.status).toBe(101);
    const closed = new Promise<number>((r) => open.ws!.once('close', (code) => r(code)));

    // A valid session needs the CSRF header to sign out.
    const noHeader = await call(s.base, 'DELETE', WEB_SESSION_PATH, { cookie: jar.cookie, origin: s.base });
    expect(noHeader.status).toBe(403);
    expect(noHeader.json.error.code).toBe('CSRF_FAILED');

    const out = await call(s.base, 'DELETE', WEB_SESSION_PATH, { cookie: jar.cookie, csrf: jar.csrf, origin: s.base });
    expect(out.status).toBe(200);
    expect(out.json).toEqual({ signedOut: true });
    expect(await closed).toBe(4401);

    const cleared = (r: Res) => {
      expect(r.setCookies).toHaveLength(2);
      const c = cookiesOf(r);
      expect(c[WEB_SESSION_COOKIE]).toEqual({ name: WEB_SESSION_COOKIE, value: '', attrs: { ...SESSION_ATTRS, 'Max-Age': '0' } });
      expect(c[WEB_CSRF_COOKIE]).toEqual({ name: WEB_CSRF_COOKIE, value: '', attrs: { ...CSRF_ATTRS, 'Max-Age': '0' } });
    };
    cleared(out);

    const me = await call(s.base, 'GET', '/v1/me', { cookie: jar.cookie });
    expect(me.status).toBe(401);
    expect(me.json.error.code).toBe('TOKEN_REVOKED');

    const again = await call(s.base, 'DELETE', WEB_SESSION_PATH, { cookie: jar.cookie, csrf: jar.csrf, origin: s.base });
    expect(again.status).toBe(200);
    cleared(again);

    // With no cookie at all it only clears.
    const bare = await call(s.base, 'DELETE', WEB_SESSION_PATH, {});
    expect(bare.status).toBe(200);
    cleared(bare);
  });
});

describe('web cookie helpers (unit)', () => {
  it('parseCookies reads name=value pairs, first one wins, and skips junk', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
    expect({ ...parseCookies('a=1; b = 2 ;junk; =x; a=3; c="q"; d=') }).toEqual({ a: '1', b: '2', c: 'q', d: '' });
    expect(parseCookies('__proto__=x').__proto__).toBe('x');
  });

  it('allowedOrigins is the request origin (normalized) plus the agent URL origin', () => {
    expect([...allowedOrigins({ agentUrl: null }, { protocol: 'http', host: '127.0.0.1:4986' })]).toEqual(['http://127.0.0.1:4986']);
    expect([...allowedOrigins({ agentUrl: 'https://Host.Example:443/x/' }, { protocol: 'https', host: 'WEB.example:443' })]).toEqual([
      'https://web.example',
      'https://host.example',
    ]);
    expect([...allowedOrigins({ agentUrl: 'not a url' }, { protocol: 'http', host: '' })]).toEqual([]);
  });

  it('checkCsrf lets reads through and needs the double submit and an allowed Origin on writes', () => {
    const req = (method: string, headers: Record<string, string>) => ({ method, headers, protocol: 'http', host: 'h:1' });
    const cfg = { agentUrl: null };
    const failed = (f: () => void) => expect(f).toThrowError(expect.objectContaining({ code: 'CSRF_FAILED' }));
    expect(() => checkCsrf(req('GET', {}), cfg)).not.toThrow();
    expect(() => checkCsrf(req('POST', { cookie: 'ml_csrf=abc', 'x-meetless-csrf': 'abc' }), cfg)).not.toThrow();
    expect(() => checkCsrf(req('delete', { cookie: 'ml_csrf=abc', 'x-meetless-csrf': 'abc', origin: 'http://h:1' }), cfg)).not.toThrow();
    failed(() => checkCsrf(req('POST', { cookie: 'ml_csrf=abc', 'x-meetless-csrf': 'abc', origin: 'http://other:1' }), cfg));
    failed(() => checkCsrf(req('PUT', { cookie: 'ml_csrf=abc', 'x-meetless-csrf': 'abd' }), cfg));
    failed(() => checkCsrf(req('PATCH', { cookie: 'ml_csrf=', 'x-meetless-csrf': '' }), cfg));
    failed(() => checkCsrf(req('', { 'x-meetless-csrf': 'abc' }), cfg));
  });

  it('rawRequestTarget follows X-Forwarded-Proto and X-Forwarded-Host only behind a trusted proxy', () => {
    const raw = { headers: { host: 'inner:4876', 'x-forwarded-proto': 'http, https', 'x-forwarded-host': 'a.example, web.example' }, socket: {} as never };
    expect(rawRequestTarget(raw, 0)).toEqual({ protocol: 'http', host: 'inner:4876' });
    expect(rawRequestTarget(raw, 1)).toEqual({ protocol: 'https', host: 'web.example' });
    expect(rawRequestTarget({ headers: { host: 'inner:4876' }, socket: { encrypted: true } as never }, 1)).toEqual({ protocol: 'https', host: 'inner:4876' });
  });
});

describe('web sessions behind a reverse proxy', () => {
  it('the own origin follows X-Forwarded-Proto and X-Forwarded-Host only with MEETLESS_TRUST_PROXY', async () => {
    const fwd = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'web.example' };
    const proxied = await withServer({ trustProxy: 1 });
    const direct = await withServer({ trustProxy: 0 });
    try {
      const ok = await call(proxied.base, 'POST', WEB_SESSION_PATH, { origin: 'https://web.example', headers: fwd, body: { token: TOKENS.alex } });
      expect(ok.status).toBe(200);
      const jar = jarOf(ok);
      expect((await wsTry(proxied.base, { cookie: jar.cookie, origin: 'https://web.example', headers: fwd })).status).toBe(101);
      // A foreign Origin is still refused.
      expect((await wsTry(proxied.base, { cookie: jar.cookie, origin: 'https://evil.example', headers: fwd })).status).toBe(403);

      const refused = await call(direct.base, 'POST', WEB_SESSION_PATH, { origin: 'https://web.example', headers: fwd, body: { token: TOKENS.alex } });
      expect(refused.status).toBe(403);
      expect(refused.json.error.code).toBe('CSRF_FAILED');
      const jar2 = jarOf(await call(direct.base, 'POST', WEB_SESSION_PATH, { origin: direct.base, body: { token: TOKENS.alex } }));
      expect((await wsTry(direct.base, { cookie: jar2.cookie, origin: 'https://web.example', headers: fwd })).status).toBe(403);
    } finally {
      await proxied.stop();
      await direct.stop();
    }
  });
});
