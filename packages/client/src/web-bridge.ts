/**
 * The web bridge (design 2026-11-25 §2, §3, §6): `MeetlessBridge` over same-origin `fetch` and
 * `WebSocket`, for the renderer served by the Meetless server itself. Online only: the visible
 * log is held in memory and refetched on every page load; nothing is queued. The session is the
 * HttpOnly `ml_session` cookie, which script never sees: this bridge reads only `ml_csrf` (to echo
 * it in `x-meetless-csrf` on writes) and never stores a token anywhere.
 *
 * Renderer-safe: no Node imports.
 */
import type { DomainEvent, Id, Seq } from '@meetless/core';
import { APP_ROUTE_NAMES, WEB_CSRF_COOKIE, WEB_CSRF_HEADER, WEB_SESSION_PATH, type ApiRequest, type ApiResponse, type AppApiName } from '@meetless/api';
import type { BridgeEvent, ClientSnapshot, CommandInput, MeetlessBridge, Result, Session, SubmitResult, SyncStatus } from './bridge';
import { callApi } from './api-call';
import { fetchAllEvents, MemorySyncStore, subscribeMessage, type EventsPage, type ServerMessage } from './sync-protocol';

/** The part of the DOM `WebSocket` this bridge uses (the browser's, or a test adapter over `ws`). */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

/** The part of the DOM `Storage` this bridge uses (`localStorage` in a browser). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface WebBridgeOptions {
  /** The page's origin (`location.origin`); every request goes there. */
  origin: string;
  fetchImpl?: typeof fetch;
  WebSocketImpl?: new (url: string) => WebSocketLike;
  storage?: StorageLike;
  systemLocales?: string[];
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** The `ml_csrf` cookie value; default parses `document.cookie` (node tests have no document). */
  readCsrf?: () => string | null;
  signInTimeoutMs?: number;
}

/** The locale key in `storage` (not a secret). */
export const WEB_LOCALE_KEY = 'meetless.locale';
/** Closes a websocket whose session was revoked (`WS_TOKEN_REVOKED` on the server). */
const WS_SESSION_REVOKED = 4401;
const OPEN = 1;
const BLOB = /^sha256:[0-9a-f]{64}$/;
const APP_ROUTE_SET: ReadonlySet<string> = new Set(APP_ROUTE_NAMES);
const DESKTOP_ONLY = { ok: false as const, code: 'DESKTOP_ONLY' };

function cookieValue(cookie: string, name: string): string | null {
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

function defaultReadCsrf(): string | null {
  const doc = (globalThis as { document?: { cookie?: string } }).document;
  return doc?.cookie ? cookieValue(doc.cookie, WEB_CSRF_COOKIE) : null;
}

function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

function defaultStorage(): StorageLike {
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls) return ls;
  } catch {
    // Storage disabled (private mode with strict settings): fall back to memory.
  }
  return memoryStorage();
}

function objectOrEmpty(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

async function errorOf(res: Response): Promise<{ code: string; details: Record<string, unknown> } | null> {
  try {
    const err = ((await res.json()) as { error?: { code?: unknown; details?: unknown } } | null)?.error;
    return typeof err?.code === 'string' && err.code ? { code: err.code, details: objectOrEmpty(err.details) } : null;
  } catch {
    return null;
  }
}

class WebBridge implements MeetlessBridge {
  private session: Session | null = null;
  private store = new MemorySyncStore();
  private status: SyncStatus = { state: 'signed_out', lastSyncedAt: null, cursor: 0, lastError: null };
  private listeners = new Set<(e: BridgeEvent) => void>();
  private ws: WebSocketLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff: number;
  private resyncing = false;
  /** The first `GET /v1/me` (is the cookie still a session?), started by the first `snapshot()`. */
  private checked: Promise<void> | null = null;
  private readonly origin: string;
  private readonly fetchImpl: typeof fetch;
  private readonly storage: StorageLike;
  private readonly readCsrf: () => string | null;

  constructor(private readonly opts: WebBridgeOptions) {
    this.origin = opts.origin.replace(/\/+$/, '');
    // Called through a closure: a browser's `fetch` throws "Illegal invocation" when called as a method of another object.
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.storage = opts.storage ?? defaultStorage();
    this.readCsrf = opts.readCsrf ?? defaultReadCsrf;
    this.backoff = opts.minBackoffMs ?? 250;
  }

  // ---------------------------------------------------------------- http

  private csrfHeaders(): Record<string, string> {
    const v = this.readCsrf();
    return v ? { [WEB_CSRF_HEADER]: v } : {};
  }

  private request(path: string, init: RequestInit = {}): Promise<Response> {
    return this.fetchImpl(`${this.origin}${path}`, { credentials: 'same-origin', ...init });
  }

  // ---------------------------------------------------------------- session

  private ensureChecked(): Promise<void> {
    this.checked ??= this.checkSession();
    return this.checked;
  }

  /** `GET /v1/me`: 200 means the cookie is a session (then connect), anything else means signed out. */
  private async checkSession(): Promise<void> {
    let res: Response;
    try {
      res = await this.request('/v1/me');
    } catch {
      this.setStatus({ lastError: 'NETWORK' });
      return;
    }
    if (!res.ok) return;
    const body = (await res.json().catch(() => null)) as { user?: { id?: Id; displayName?: string; locale?: string } } | null;
    if (!body?.user?.id || this.session) return;
    this.activate({ id: body.user.id, displayName: body.user.displayName ?? body.user.id, locale: body.user.locale });
  }

  private activate(user: { id: Id; displayName: string; locale?: string }): void {
    this.deactivate();
    if (user.locale && !this.locale()) {
      try {
        this.storage.setItem(WEB_LOCALE_KEY, user.locale);
      } catch {
        // Storage unavailable: the locale is chosen again next time.
      }
    }
    this.session = { serverUrl: this.origin, userId: user.id, displayName: user.displayName };
    this.store = new MemorySyncStore();
    this.status = { state: 'connecting', lastSyncedAt: null, cursor: 0, lastError: null };
    this.emit({ type: 'session', session: { ...this.session }, locale: this.locale() });
    this.emit({ type: 'reset', events: [] });
    this.emitStatus();
    this.connect();
  }

  private deactivate(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onmessage = ws.onerror = ws.onopen = null;
      try {
        ws.close();
      } catch {
        // already closed
      }
    }
    this.session = null;
  }

  /** Signed out here, whatever the server said: no session, no events, no reconnect. */
  private endSession(lastError: string | null = null): void {
    this.deactivate();
    this.store = new MemorySyncStore();
    this.status = { state: 'signed_out', lastSyncedAt: null, cursor: 0, lastError };
    this.emit({ type: 'session', session: null, locale: this.locale() });
    this.emit({ type: 'reset', events: [] });
    this.emitStatus();
  }

  private async startSession(body: Record<string, unknown>): Promise<Result<{ session: Session }>> {
    const url = this.origin;
    const fail = (code: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, code, details: { ...extra, url } });
    const timeoutMs = this.opts.signInTimeoutMs ?? 10_000;
    let res: Response;
    try {
      res = await this.request(WEB_SESSION_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const err = e as Error & { cause?: { code?: string; message?: string } };
      if (err.name === 'TimeoutError' || err.name === 'AbortError') return fail('TIMEOUT', { seconds: Math.round(timeoutMs / 1000) });
      return fail('NETWORK', { message: err.cause?.code ?? err.cause?.message ?? err.message });
    }
    if (!res.ok) {
      const err = await errorOf(res);
      if (err) return fail(err.code, err.details);
      return res.status === 401 ? fail('UNAUTHENTICATED') : fail(`HTTP_${res.status}`, { status: res.status });
    }
    const data = (await res.json().catch(() => null)) as { user?: { id?: unknown; displayName?: unknown; locale?: unknown } } | null;
    if (typeof data?.user?.id !== 'string') return fail('BAD_RESPONSE');
    const u = data.user;
    // A sign-in settles the first-load check too: no stale /v1/me answer may undo it.
    this.checked = Promise.resolve();
    this.activate({
      id: u.id as Id,
      displayName: typeof u.displayName === 'string' ? u.displayName : String(u.id),
      ...(typeof u.locale === 'string' ? { locale: u.locale } : {}),
    });
    return { ok: true, session: { ...this.session! } };
  }

  async signIn(_serverUrl: string, token: string): Promise<Result<{ session: Session }>> {
    const t = String(token ?? '').trim();
    if (!t) return { ok: false, code: 'TOKEN_MISSING', details: { url: this.origin } };
    return this.startSession({ token: t });
  }

  async redeemInvite(_serverUrl: string, code: string, displayName: string): Promise<Result<{ session: Session }>> {
    return this.startSession({
      // Codes are read out and pasted: drop every whitespace character, also inside ("ABCD 1234").
      code: String(code ?? '').replace(/\s+/g, '').toUpperCase(),
      displayName: String(displayName ?? '').trim(),
      locale: this.locale() ?? 'en',
    });
  }

  /** `DELETE /v1/web/session`, then signed out locally whatever it answered (a 403 or a network error included). */
  async signOut(): Promise<void> {
    try {
      await this.request(WEB_SESSION_PATH, { method: 'DELETE', headers: this.csrfHeaders() });
    } catch {
      // Offline: the local sign-out still happens.
    }
    this.checked = Promise.resolve();
    this.endSession();
  }

  // ---------------------------------------------------------------- locale

  private locale(): string | null {
    try {
      return this.storage.getItem(WEB_LOCALE_KEY);
    } catch {
      return null;
    }
  }

  async setLocale(locale: string): Promise<void> {
    try {
      this.storage.setItem(WEB_LOCALE_KEY, locale);
    } catch {
      // Storage unavailable: the choice lasts for this page only.
    }
    this.emit({ type: 'session', session: this.session ? { ...this.session } : null, locale });
    // Best effort: also record the personal preference in the team log when online. Never queued.
    if (this.session && this.status.state === 'online') {
      void this.post({ id: crypto.randomUUID(), type: 'user.locale_changed', payload: { userId: this.session.userId, locale } });
    }
  }

  // ---------------------------------------------------------------- sync

  private connect(): void {
    if (!this.session) return;
    const Impl = this.opts.WebSocketImpl ?? (globalThis as unknown as { WebSocket: new (url: string) => WebSocketLike }).WebSocket;
    let ws: WebSocketLike;
    try {
      ws = new Impl(`${this.origin.replace(/^http/, 'ws')}/v1/ws`);
    } catch (e) {
      this.setStatus({ state: 'offline', lastError: (e as Error).message });
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    let greeted = false;
    this.setStatus({ state: 'connecting' });
    ws.onmessage = (ev) => {
      let m: ServerMessage;
      try {
        m = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (m.type === 'hello') greeted = true;
      void this.onMessage(ws, m);
    };
    ws.onerror = () => this.setStatus({ lastError: 'WS_ERROR' });
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (ev.code === WS_SESSION_REVOKED) return this.endSession('TOKEN_REVOKED');
      this.setStatus({ state: 'offline' });
      // Refused before the protocol switch (the browser only sees 1006): ask whether the session still exists.
      if (!greeted) return void this.recheckThenReconnect();
      this.scheduleReconnect();
    };
  }

  private async recheckThenReconnect(): Promise<void> {
    try {
      const res = await this.request('/v1/me');
      if (res.status === 401) return this.endSession('UNAUTHENTICATED');
    } catch {
      // Network down: keep trying with backoff.
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.session) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.opts.maxBackoffMs ?? 5000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private sendSubscribe(ws: WebSocketLike): void {
    if (ws.readyState === OPEN) ws.send(subscribeMessage(this.store));
  }

  private async onMessage(ws: WebSocketLike, m: ServerMessage): Promise<void> {
    if (ws !== this.ws) return;
    switch (m.type) {
      case 'hello':
        this.sendSubscribe(ws);
        return;
      case 'events': {
        const fresh = this.store.append(m.events, m.cursor, m.epoch);
        this.markSynced(m.cursor);
        if (fresh.length > 0) this.emit({ type: 'events', events: fresh });
        return;
      }
      case 'synced':
        this.store.append([], m.cursor, m.epoch);
        this.backoff = this.opts.minBackoffMs ?? 250;
        this.markSynced(m.cursor, 'online');
        return;
      case 'reset':
        await this.resync(ws);
        return;
      case 'error':
        this.setStatus({ lastError: m.code });
        return;
    }
  }

  private markSynced(cursor: Seq, state?: 'online'): void {
    this.setStatus({ cursor, lastSyncedAt: new Date().toISOString(), lastError: null, ...(state ? { state } : {}) });
  }

  /** Full refetch from seq 0 (access changed / different log): replaces everything in memory. */
  private async resync(ws: WebSocketLike): Promise<void> {
    if (this.resyncing) return;
    this.resyncing = true;
    try {
      const all = await fetchAllEvents(async (after) => {
        const res = await this.request(`/v1/events?after=${after}&limit=5000`);
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        return (await res.json()) as EventsPage;
      });
      if (ws !== this.ws) return;
      this.store.replace(all.events, all.cursor, all.epoch);
      this.setStatus({ cursor: all.cursor });
      this.emit({ type: 'reset', events: all.events });
      this.sendSubscribe(ws);
    } catch (e) {
      this.setStatus({ lastError: (e as Error).message });
      ws.close();
    } finally {
      this.resyncing = false;
    }
  }

  // ---------------------------------------------------------------- commands

  private async post(cmd: { id: Id; type: string; payload: unknown; occurredAt?: string }): Promise<SubmitResult> {
    let res: Response;
    try {
      res = await this.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', ...this.csrfHeaders() }, body: JSON.stringify(cmd) });
    } catch {
      return { kind: 'rejected', code: 'OFFLINE' };
    }
    if (res.status >= 500) return { kind: 'rejected', code: 'OFFLINE' };
    const body = (await res.json().catch(() => ({}))) as { status?: string; event?: DomainEvent; error?: { code: string; details?: unknown } };
    if (res.ok && body.event) return { kind: body.status === 'duplicate' ? 'duplicate' : 'accepted', seq: body.event.seq };
    return { kind: 'rejected', code: body.error?.code ?? `HTTP_${res.status}`, details: body.error?.details };
  }

  /** Posts once. A network failure answers `rejected OFFLINE`: never queued, nothing claims it was saved. */
  async submit(cmd: CommandInput): Promise<SubmitResult> {
    if (!this.session) return { kind: 'rejected', code: 'NOT_SIGNED_IN' };
    return this.post({ id: cmd.id, type: cmd.type, payload: cmd.payload, ...(cmd.occurredAt ? { occurredAt: cmd.occurredAt } : {}) });
  }

  async dismissOutbox(_id: Id): Promise<void> {
    // No outbox on the web.
  }

  // ---------------------------------------------------------------- blobs

  async uploadBlob(bytes: Uint8Array, mediaType: string): Promise<Result<{ hash: string; size: number }>> {
    if (!this.session) return { ok: false, code: 'NOT_SIGNED_IN' };
    const data = new Uint8Array(bytes);
    const hash = await sha256(data);
    let res: Response;
    try {
      res = await this.request(`/v1/blobs/${hash}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream', 'x-meetless-media-type': mediaType || 'application/octet-stream', ...this.csrfHeaders() },
        body: data,
      });
    } catch (e) {
      return { ok: false, code: 'NETWORK', details: (e as Error).message };
    }
    if (!res.ok) {
      const err = await errorOf(res);
      return { ok: false, code: err?.code ?? `HTTP_${res.status}` };
    }
    return { ok: true, hash, size: data.byteLength };
  }

  /** Fetched per read (the browser's HTTP cache keeps it, the server sends `immutable`); no local copy. */
  async readBlob(hash: string): Promise<Result<{ bytes: Uint8Array }>> {
    if (!this.session) return { ok: false, code: 'NOT_SIGNED_IN' };
    if (!BLOB.test(hash)) return { ok: false, code: 'INVALID_CONTENT_HASH' };
    let res: Response;
    try {
      res = await this.request(`/v1/blobs/${hash}`);
    } catch (e) {
      return { ok: false, code: 'NETWORK', details: (e as Error).message };
    }
    if (!res.ok) return { ok: false, code: res.status === 403 ? 'NOT_AUTHORISED' : `HTTP_${res.status}` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if ((await sha256(bytes)) !== hash) return { ok: false, code: 'INVALID_CONTENT_HASH' };
    return { ok: true, bytes };
  }

  // ---------------------------------------------------------------- api

  /** Non-app routes (MCP-only) refuse with `NOT_AVAILABLE` before any request is made. */
  async api<K extends AppApiName>(name: K, input: ApiRequest<K>): Promise<Result<{ data: ApiResponse<K> }>> {
    if (!APP_ROUTE_SET.has(name)) return { ok: false, code: 'NOT_AVAILABLE' };
    if (!this.session) return { ok: false, code: 'NOT_SIGNED_IN' };
    const r = await callApi(this.origin, null, name, input, { fetchImpl: (u, init) => this.fetchImpl(u, { credentials: 'same-origin', ...init }), headers: this.csrfHeaders() });
    return r as Result<{ data: ApiResponse<K> }>;
  }

  // ---------------------------------------------------------------- desktop only (design 2026-11-25 §6)

  async openLogs() {
    return DESKTOP_ONLY;
  }
  async pickRepo() {
    return DESKTOP_ONLY;
  }
  async listRepos() {
    return [];
  }
  async repoLog() {
    return DESKTOP_ONLY;
  }
  async repoDiff() {
    return DESKTOP_ONLY;
  }
  async repoPatch() {
    return DESKTOP_ONLY;
  }
  async repoSnapshot() {
    return DESKTOP_ONLY;
  }
  async captureStatus() {
    return DESKTOP_ONLY;
  }
  async captureBindRepo() {
    return DESKTOP_ONLY;
  }
  async captureRun() {
    return DESKTOP_ONLY;
  }
  async overleafSetToken() {
    return DESKTOP_ONLY;
  }
  async overleafSync() {
    return DESKTOP_ONLY;
  }
  async notionConnect() {
    return DESKTOP_ONLY;
  }
  async notionDisconnect() {
    return DESKTOP_ONLY;
  }
  async notionPage() {
    return DESKTOP_ONLY;
  }
  async updatesCheck() {
    return DESKTOP_ONLY;
  }
  async updatesInstall() {
    return DESKTOP_ONLY;
  }

  // ---------------------------------------------------------------- snapshot / events

  async snapshot(): Promise<ClientSnapshot> {
    await this.ensureChecked();
    return {
      session: this.session ? { ...this.session } : null,
      events: this.store.events(),
      status: { ...this.status },
      outbox: [],
      locale: this.locale(),
      systemLocales: this.opts.systemLocales ?? [],
      cacheKind: 'memory',
      host: 'web',
    };
  }

  subscribe(cb: (e: BridgeEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: BridgeEvent): void {
    for (const l of this.listeners) l(e);
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emitStatus();
  }

  private emitStatus(): void {
    this.emit({ type: 'status', status: { ...this.status } });
  }

  /** Test / page-unload hook: stop syncing (the session cookie stays). */
  close(): void {
    this.deactivate();
  }
}

/** The bridge for the renderer on the Meetless server's own page (`<meta name="meetless-host" content="web">`). */
export function createWebBridge(opts: WebBridgeOptions): MeetlessBridge & { close(): void } {
  return new WebBridge(opts);
}
