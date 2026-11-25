import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { cmd, http, TOKENS, withServer, type TestServer } from './helpers';
import { configFromEnv, RateLimiter } from '../src/index';

/** A generous limit that no test in this file should ever trip by accident. */
const GENEROUS = { limit: 1000, windowMs: 60 * 60_000 };

/** A mutable clock: `now` is a stable function reference `cfg.now` can hold on to; `advance` moves it forward. */
function clock(startIso: string): { now: () => Date; advance: (ms: number) => void } {
  let t = Date.parse(startIso);
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

/** The HTTP status (and, on a rejection, headers) of a /v1/ws upgrade attempt. */
function wsUpgrade(base: string, token: string | null, extra: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/v1/ws`, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra } });
    ws.once('unexpected-response', (_req, res) => {
      resolve({ status: res.statusCode ?? 0, headers: res.headers as Record<string, string> });
      ws.terminate();
    });
    ws.once('upgrade', () => {
      resolve({ status: 101, headers: {} });
      ws.terminate();
    });
    ws.once('error', (e) => reject(e));
  });
}

describe('RateLimiter (unit)', () => {
  it('the limiter refuses the attempt after the limit inside the window and allows again after it, with retryAfterSec', () => {
    let t = 1_000_000;
    const rl = new RateLimiter({ limit: 2, windowMs: 1000 }, () => t);

    expect(rl.hit('a')).toEqual({ ok: true });
    expect(rl.hit('a')).toEqual({ ok: true });
    // The 3rd attempt inside the window is refused.
    expect(rl.hit('a')).toEqual({ ok: false, retryAfterSec: 1 });

    t += 500; // still inside the original window (resetAt = 1_001_000)
    expect(rl.hit('a')).toEqual({ ok: false, retryAfterSec: 1 }); // ceil(500/1000) = 1, still refused

    t += 600; // now past resetAt (1_001_100 > 1_001_000): a fresh window starts
    expect(rl.hit('a')).toEqual({ ok: true });

    // `blocked` is the same check without counting: it does not consume the budget.
    expect(rl.blocked('a')).toEqual({ ok: true });
    expect(rl.blocked('a')).toEqual({ ok: true });
    expect(rl.hit('a')).toEqual({ ok: true }); // still only the 2nd counted attempt in this window
    expect(rl.hit('a')).toEqual({ ok: false, retryAfterSec: 1 }); // 3rd counted attempt: refused

    // A different key has its own independent window.
    expect(rl.hit('b')).toEqual({ ok: true });
  });

  it('expired keys are pruned', () => {
    let t = 0;
    const rl = new RateLimiter({ limit: 1, windowMs: 100 }, () => t);
    for (let i = 0; i < 500; i++) rl.hit(`k${i}`);
    expect(rl.size).toBe(500);

    t += 1000; // well past the 100ms window for every key
    expect(rl.size).toBe(0);
  });

  it('a full sweep runs at most once per window, not on every call (O(1) per hit/blocked)', () => {
    let t = 0;
    let sweeps = 0;
    const rl = new RateLimiter({ limit: 1, windowMs: 1000 }, () => t, { onSweep: () => sweeps++ });

    // The very first call always sweeps once, trivially (the map is empty).
    rl.hit('a');
    expect(sweeps).toBe(1);

    // Many more calls, each a distinct key, all still inside the same window: no further sweep,
    // however many keys accumulate (each hit/blocked only ever touches its own key).
    for (let i = 0; i < 300; i++) {
      t += 1; // advances, but stays well inside the 1000ms window
      rl.hit(`k${i}`);
    }
    rl.blocked('a');
    expect(sweeps).toBe(1);
    expect(rl.size).toBe(301);

    // Crossing the window boundary triggers exactly one more sweep, however many calls follow.
    t += 1000;
    rl.hit('b');
    expect(sweeps).toBe(2);
    for (let i = 0; i < 50; i++) {
      t += 1;
      rl.hit(`m${i}`);
    }
    expect(sweeps).toBe(2);
  });
});

describe('MEETLESS_RATE_SIGNIN / MEETLESS_RATE_REDEEM', () => {
  it('parse <limit>/<seconds> and reject garbage', () => {
    const cfg = configFromEnv({ MEETLESS_RATE_SIGNIN: '5/120', MEETLESS_RATE_REDEEM: '3/45' });
    expect(cfg.rateLimits).toEqual({ signIn: { limit: 5, windowMs: 120_000 }, redeem: { limit: 3, windowMs: 45_000 } });

    const defaults = configFromEnv({});
    expect(defaults.rateLimits).toEqual({ signIn: { limit: 10, windowMs: 5 * 60_000 }, redeem: { limit: 10, windowMs: 10 * 60_000 } });

    expect(() => configFromEnv({ MEETLESS_RATE_SIGNIN: 'nope' })).toThrow(/MEETLESS_RATE_SIGNIN/);
    expect(() => configFromEnv({ MEETLESS_RATE_SIGNIN: '5/0' })).toThrow(/MEETLESS_RATE_SIGNIN/);
    expect(() => configFromEnv({ MEETLESS_RATE_SIGNIN: '0/60' })).toThrow(/MEETLESS_RATE_SIGNIN/);
    expect(() => configFromEnv({ MEETLESS_RATE_REDEEM: '3/-1' })).toThrow(/MEETLESS_RATE_REDEEM/);
  });
});

describe('rate limits on sign-in and invite redemption (contract §12.8)', () => {
  let s: TestServer | null = null;

  afterEach(async () => {
    if (s) await s.stop();
    s = null;
  });

  it('after N failed tokens from one IP the next bad token answers 429 RATE_LIMITED with details.retryAfter and Retry-After; a valid token from that IP still works', async () => {
    const clk = clock('2026-11-24T10:00:00.000Z');
    s = await withServer({ now: clk.now, rateLimits: { signIn: { limit: 3, windowMs: 60_000 }, redeem: GENEROUS } });

    // Requests with no token at all never count toward the limit, however many of them there are.
    for (let i = 0; i < 10; i++) {
      const r = await http(s.base, null, 'GET', '/v1/me');
      expect(r.status).toBe(401);
      expect(r.json.error.code).toBe('UNAUTHENTICATED');
    }

    // The first 3 failures with an actual (unknown) bearer token are plain UNAUTHENTICATED.
    for (let i = 0; i < 3; i++) {
      const r = await http(s.base, 'bogus-token', 'GET', '/v1/me');
      expect(r.status).toBe(401);
      expect(r.json.error.code).toBe('UNAUTHENTICATED');
    }

    // The 4th failure from the same IP is refused outright.
    const blocked = await http(s.base, 'bogus-token', 'GET', '/v1/me');
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe('RATE_LIMITED');
    expect(blocked.json.error.details.retryAfter).toBe(60);
    expect(blocked.headers.get('retry-after')).toBe('60');

    // A valid token from the same (now over-limit) IP is still served normally.
    const ok = await http(s.base, TOKENS.lin, 'GET', '/v1/me');
    expect(ok.status).toBe(200);
    expect(ok.json.user.id).toBe('u-lin');

    // Another bad token from the same IP is still refused: the valid request above did not reset anything.
    const stillBlocked = await http(s.base, 'another-bad-token', 'GET', '/v1/me');
    expect(stillBlocked.status).toBe(429);
  });

  it('behind one proxy (MEETLESS_TRUST_PROXY=1) a spoofed leftmost X-Forwarded-For does not dodge the limit: the key is the entry the proxy appended', async () => {
    s = await withServer({ trustProxy: 1, rateLimits: { signIn: { limit: 2, windowMs: 60_000 }, redeem: GENEROUS } });
    // What a client behind a proxy that appends its own view of the client address sends upstream:
    // a fresh made-up leftmost entry every time, then the real client address the proxy saw.
    const viaProxy = (spoof: string, real = '203.0.113.50') => ({ 'x-forwarded-for': `${spoof}, ${real}` });
    const badMe = async (headers: Record<string, string>) => {
      const res = await fetch(`${s!.base}/v1/me`, { headers: { authorization: 'Bearer bogus-token', ...headers } });
      return { status: res.status, json: (await res.json()) as any };
    };

    expect((await badMe(viaProxy('10.66.0.1'))).status).toBe(401);
    expect((await badMe(viaProxy('10.66.0.2'))).status).toBe(401);
    const third = await badMe(viaProxy('10.66.0.3'));
    expect(third.status).toBe(429);
    expect(third.json.error.code).toBe('RATE_LIMITED');

    // The websocket upgrade keys the same way, so it is limited too.
    expect((await wsUpgrade(s.base, 'bogus-token', viaProxy('10.66.0.4'))).status).toBe(429);

    // Another real client behind the same proxy has its own budget.
    expect((await badMe(viaProxy('10.66.0.1', '198.51.100.9'))).status).toBe(401);
  });

  it('an MCP tool call whose inner route fails authentication counts against the caller’s address, not 127.0.0.1 (T9)', async () => {
    s = await withServer({ trustProxy: 1, rateLimits: { signIn: { limit: 1, windowMs: 60_000 }, redeem: GENEROUS } });
    const caller = { 'x-forwarded-for': '203.0.113.77' };
    // The outer /mcp check passes; the token is gone by the time the tool's own route checks it.
    const realAuth = s.auth.authenticate.bind(s.auth);
    let n = 0;
    const spy = vi.spyOn(s.auth, 'authenticate').mockImplementation(async (h) => (++n === 2 ? { error: 'TOKEN_REVOKED' } : realAuth(h)));
    const res = await fetch(`${s.base}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKENS.lin}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...caller },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search', arguments: { q: 'csv' } } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('TOKEN_REVOKED');
    expect(n).toBe(2);
    spy.mockRestore();

    // That failure used up the caller's one-failure budget: their next bad token is refused...
    const again = await fetch(`${s.base}/v1/me`, { headers: { authorization: 'Bearer bogus', ...caller } });
    expect(again.status).toBe(429);
    // ...while the server's own loopback address was never charged.
    const loopback = await fetch(`${s.base}/v1/me`, { headers: { authorization: 'Bearer bogus' } });
    expect(loopback.status).toBe(401);
  });

  it('the window passing lets sign-in through again', async () => {
    const clk = clock('2026-11-24T10:00:00.000Z');
    s = await withServer({ now: clk.now, rateLimits: { signIn: { limit: 1, windowMs: 10_000 }, redeem: GENEROUS } });

    const first = await http(s.base, 'bogus', 'GET', '/v1/me');
    expect(first.status).toBe(401);
    const blocked = await http(s.base, 'bogus', 'GET', '/v1/me');
    expect(blocked.status).toBe(429);

    clk.advance(10_001);
    const after = await http(s.base, 'bogus', 'GET', '/v1/me');
    expect(after.status).toBe(401);
    expect(after.json.error.code).toBe('UNAUTHENTICATED');
  });

  it('while an IP is already over the sign-in limit, a request with no token still gets plain UNAUTHENTICATED (not 429)', async () => {
    const clk = clock('2026-11-24T10:00:00.000Z');
    s = await withServer({ now: clk.now, rateLimits: { signIn: { limit: 1, windowMs: 60_000 }, redeem: GENEROUS } });

    const first = await http(s.base, 'bogus', 'GET', '/v1/me');
    expect(first.status).toBe(401);
    const blocked = await http(s.base, 'bogus', 'GET', '/v1/me');
    expect(blocked.status).toBe(429);

    // Still over the limit, but a request with no token at all never counts and is never limited.
    const noToken = await http(s.base, null, 'GET', '/v1/me');
    expect(noToken.status).toBe(401);
    expect(noToken.json.error.code).toBe('UNAUTHENTICATED');

    // The IP is still exactly as over-limit as before: the no-token request did not reset it.
    const stillBlocked = await http(s.base, 'bogus', 'GET', '/v1/me');
    expect(stillBlocked.status).toBe(429);
  });

  it('a failed websocket upgrade counts toward the sign-in limit and is refused with 429 once over', async () => {
    const clk = clock('2026-11-24T10:00:00.000Z');
    s = await withServer({ now: clk.now, rateLimits: { signIn: { limit: 1, windowMs: 60_000 }, redeem: GENEROUS } });

    const first = await wsUpgrade(s.base, 'bogus');
    expect(first.status).toBe(401);

    const second = await wsUpgrade(s.base, 'bogus');
    expect(second.status).toBe(429);
    expect(second.headers['retry-after']).toBe('60');

    // The upgrade and the plain HTTP path share one limiter, keyed by IP.
    const httpTry = await http(s.base, 'bogus', 'GET', '/v1/me');
    expect(httpTry.status).toBe(429);
    expect(httpTry.json.error.details.retryAfter).toBe(60);

    // A valid token still upgrades fine, even while the IP is over the limit.
    const goodWs = await wsUpgrade(s.base, TOKENS.lin);
    expect(goodWs.status).toBe(101);
  });

  it('after N failed redeems from one IP the next bad code answers 429 RATE_LIMITED with retryAfter; a valid code from that IP still redeems', async () => {
    const clk = clock('2026-11-24T10:00:00.000Z');
    s = await withServer({ now: clk.now, rateLimits: { signIn: GENEROUS, redeem: { limit: 2, windowMs: 60_000 } } });
    const projectId = 'p-rl1';
    const created = await http(s.base, TOKENS.alex, 'POST', '/v1/commands', cmd('project.created', { projectId, name: 'RL project' }));
    expect(created.status).toBe(201);

    for (let i = 0; i < 2; i++) {
      const r = await http(s.base, null, 'POST', '/v1/invites/redeem', { code: 'ZZZZ-ZZZZ-ZZZZ', displayName: 'X', locale: 'en' });
      expect(r.status).toBe(404);
      expect(r.json.error.code).toBe('INVITE_INVALID');
    }

    const blocked = await http(s.base, null, 'POST', '/v1/invites/redeem', { code: 'ZZZZ-ZZZZ-ZZZZ', displayName: 'X', locale: 'en' });
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe('RATE_LIMITED');
    expect(blocked.json.error.details.retryAfter).toBe(60);
    expect(blocked.headers.get('retry-after')).toBe('60');

    // A valid, unused invite from the same IP still redeems: only failures are limited.
    const invite = await http(s.base, TOKENS.alex, 'POST', `/v1/projects/${projectId}/invites`, { roleId: null });
    expect(invite.status).toBe(200);
    const good = await http(s.base, null, 'POST', '/v1/invites/redeem', { code: invite.json.code, displayName: 'Kai', locale: 'en' });
    expect(good.status).toBe(200);
    expect(good.json.user.displayName).toBe('Kai');
  });

  it('a redeem with no failures behind it is never limited (successes do not count)', async () => {
    s = await withServer({ rateLimits: { signIn: GENEROUS, redeem: { limit: 1, windowMs: 60_000 } } });
    const projectId = 'p-rl2';
    await http(s.base, TOKENS.alex, 'POST', '/v1/commands', cmd('project.created', { projectId, name: 'RL project 2' }));

    for (let i = 0; i < 5; i++) {
      const invite = await http(s.base, TOKENS.alex, 'POST', `/v1/projects/${projectId}/invites`, { roleId: null });
      expect(invite.status).toBe(200);
      const r = await http(s.base, null, 'POST', '/v1/invites/redeem', { code: invite.json.code, displayName: `U${i}`, locale: 'en' });
      expect(r.status, `redeem #${i}`).toBe(200);
    }
  });

  it('the window passing lets redeem through again', async () => {
    const clk = clock('2026-11-24T10:00:00.000Z');
    s = await withServer({ now: clk.now, rateLimits: { signIn: GENEROUS, redeem: { limit: 1, windowMs: 10_000 } } });
    const bad = { code: 'ZZZZ-ZZZZ-ZZZZ', displayName: 'X', locale: 'en' };

    const first = await http(s.base, null, 'POST', '/v1/invites/redeem', bad);
    expect(first.status).toBe(404);
    const blocked = await http(s.base, null, 'POST', '/v1/invites/redeem', bad);
    expect(blocked.status).toBe(429);

    clk.advance(10_001);
    const after = await http(s.base, null, 'POST', '/v1/invites/redeem', bad);
    expect(after.status).toBe(404);
    expect(after.json.error.code).toBe('INVITE_INVALID');
  });

  it('a redeem over the limit with an already-used code never calls claimInvite again and still answers 429, not INVITE_USED', async () => {
    const clk = clock('2026-11-24T10:00:00.000Z');
    s = await withServer({ now: clk.now, rateLimits: { signIn: GENEROUS, redeem: { limit: 1, windowMs: 60_000 } } });
    const projectId = 'p-rl3';
    await http(s.base, TOKENS.alex, 'POST', '/v1/commands', cmd('project.created', { projectId, name: 'RL project 3' }));
    const invite = await http(s.base, TOKENS.alex, 'POST', `/v1/projects/${projectId}/invites`, { roleId: null });

    const firstRedeem = await http(s.base, null, 'POST', '/v1/invites/redeem', { code: invite.json.code, displayName: 'First', locale: 'en' });
    expect(firstRedeem.status).toBe(200);

    // 1 failure budget: an unrelated unknown code uses it up.
    const unrelated = await http(s.base, null, 'POST', '/v1/invites/redeem', { code: 'ZZZZ-ZZZZ-ZZZZ', displayName: 'Y', locale: 'en' });
    expect(unrelated.status).toBe(404);

    // Now over the limit: redeeming the already-used code would fail with INVITE_USED, but the IP
    // is limited, so it answers 429 instead, and the invite's usedBy/usedAt do not change again.
    const already = await http(s.base, null, 'POST', '/v1/invites/redeem', { code: invite.json.code, displayName: 'Second', locale: 'en' });
    expect(already.status).toBe(429);
    expect(already.json.error.code).toBe('RATE_LIMITED');

    const list = await http(s.base, TOKENS.alex, 'GET', `/v1/projects/${projectId}/invites`);
    const row = list.json.invites.find((i: { id: string }) => i.id === invite.json.invite.id);
    expect(row.usedBy).toBe(firstRedeem.json.user.id);
  });
});
