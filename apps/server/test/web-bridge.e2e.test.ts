/**
 * The web bridge (`@meetless/client/web`) against a real server: sign-in by token through the
 * cookie session, the visible log over the websocket, submit, a reload with the same cookie jar,
 * sign-out, and the desktop-only methods. `fetchImpl` and `WebSocketImpl` share a small cookie
 * jar and send the server's own origin, as a browser on the page would.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket as WS } from 'ws';
import type { BridgeEvent, MeetlessBridge } from '@meetless/client/bridge';
import { createWebBridge, type WebSocketLike } from '@meetless/client/web';
import { make, TOKENS, until, withServer, type TestServer } from './helpers';
import { PRIVATE_WORD, seedTeam } from './seed';

class CookieJar {
  private cookies = new Map<string, string>();
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  get(name: string): string | null {
    return this.cookies.get(name) ?? null;
  }
  store(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      if (attrs.some((a) => a.trim().toLowerCase() === 'max-age=0') || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

function browserLike(base: string, jar: CookieJar) {
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const c = jar.header();
    if (c) headers.set('cookie', c);
    headers.set('origin', base);
    const res = await fetch(input, { ...init, headers });
    jar.store(res);
    return res;
  };
  class JarSocket extends WS {
    constructor(url: string) {
      super(url, { headers: { cookie: jar.header(), origin: base } });
    }
  }
  return {
    origin: base,
    fetchImpl,
    WebSocketImpl: JarSocket as unknown as new (url: string) => WebSocketLike,
    readCsrf: () => jar.get('ml_csrf'),
    storage: memoryStorage(),
    minBackoffMs: 50,
    maxBackoffMs: 200,
  };
}

/** The bridge's live view: what a renderer would hold after applying every event it was sent. */
function track(bridge: MeetlessBridge) {
  const view = { events: new Map<number, unknown>(), state: '', session: undefined as unknown };
  bridge.subscribe((e: BridgeEvent) => {
    if (e.type === 'reset') {
      view.events.clear();
      for (const ev of e.events) view.events.set(ev.seq, ev);
    } else if (e.type === 'events') for (const ev of e.events) view.events.set(ev.seq, ev);
    else if (e.type === 'status') view.state = e.status.state;
    else if (e.type === 'session') view.session = e.session;
  });
  return view;
}

describe('web bridge against a real server', () => {
  let server: TestServer | undefined;
  const bridges: { close(): void }[] = [];
  afterEach(async () => {
    for (const b of bridges.splice(0)) b.close();
    await server?.stop();
    server = undefined;
  });

  it('signs in by token, syncs, submits, survives a reload, signs out; desktop-only methods answer DESKTOP_ONLY', async () => {
    server = await withServer();
    const team = await seedTeam(server.base);
    const jar = new CookieJar();

    const b1 = createWebBridge(browserLike(server.base, jar));
    bridges.push(b1);
    const v1 = track(b1);
    const first = await b1.snapshot();
    expect(first).toMatchObject({ session: null, host: 'web', cacheKind: 'memory', outbox: [] });
    expect(first.status.state).toBe('signed_out');

    const signedIn = await b1.signIn('ignored', TOKENS.lin);
    expect(signedIn.ok).toBe(true);
    expect(jar.get('ml_session')).toMatch(/^mlp_/);
    await until(() => v1.state === 'online' && v1.events.size > 0, 8000, 'b1 online with events');
    // Only what the server sends: Lin never sees Alex's private items.
    expect(JSON.stringify([...v1.events.values()])).not.toContain(PRIVATE_WORD);

    const before = v1.events.size;
    const sub = await b1.submit(make.need('need-web-1', team.projectId, 'Typed on a phone'));
    expect(sub.kind).toBe('accepted');
    await until(() => v1.events.size === before + 1, 8000, 'the submitted need arrives live');

    // A reload: a fresh bridge with the same cookie jar is signed in and refetches every event.
    const b2 = createWebBridge(browserLike(server.base, jar));
    bridges.push(b2);
    const v2 = track(b2);
    const reloaded = await b2.snapshot();
    expect(reloaded.session).toMatchObject({ userId: 'u-lin', serverUrl: server.base });
    await until(() => v2.state === 'online' && v2.events.size === v1.events.size, 8000, 'b2 has every event');

    for (const r of [await b2.pickRepo(), await b2.captureRun({} as never), await b2.overleafSync('a'), await b2.notionConnect(), await b2.openLogs(), await b2.updatesCheck()]) {
      expect(r).toEqual({ ok: false, code: 'DESKTOP_ONLY' });
    }
    expect(await b2.listRepos()).toEqual([]);

    await b2.signOut();
    const out = await b2.snapshot();
    expect(out.session).toBeNull();
    expect(out.events).toEqual([]);
    expect(out.status.state).toBe('signed_out');
    expect(jar.get('ml_session')).toBeNull();
    // The other tab's socket is closed with 4401: it goes signed out instead of reconnecting.
    await until(() => v1.state === 'signed_out' && v1.session === null, 8000, 'b1 signed out');
    const after = await b1.snapshot();
    expect(after.session).toBeNull();
  }, 30_000);
});
