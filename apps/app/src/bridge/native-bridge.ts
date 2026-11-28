/**
 * The native bridge: `MeetlessBridge` over `fetch` and `WebSocket` with the user's personal token as a
 * bearer header (HTTP and the WS handshake), the token kept in the keychain. Same rules as the web
 * bridge (@meetless/client/web): online only, the visible log held in memory and refetched on every
 * start, nothing queued; it reuses the client's sync protocol and API caller.
 */
import { digest, CryptoDigestAlgorithm } from 'expo-crypto';
import type { DomainEvent, Id, Seq } from '@meetless/core';
import { APP_ROUTE_NAMES, type ApiRequest, type ApiResponse, type AppApiName } from '@meetless/api';
import type { BridgeEvent, ClientSnapshot, CommandInput, MeetlessBridge, Result, Session, SubmitResult, SyncStatus } from '@meetless/client/bridge';
import { callApi } from '../../../../packages/client/src/api-call';
import { fetchAllEvents, MemorySyncStore, subscribeMessage, type EventsPage, type ServerMessage } from '../../../../packages/client/src/sync-protocol';
import { clearSession, loadSession, saveSession, type StoredSession } from './token-store';

const WS_SESSION_REVOKED = 4401;
const OPEN = 1;
const BLOB = /^sha256:[0-9a-f]{64}$/;
const APP_ROUTE_SET: ReadonlySet<string> = new Set(APP_ROUTE_NAMES);
const DESKTOP_ONLY = { ok: false as const, code: 'DESKTOP_ONLY' };
const SIGN_IN_TIMEOUT_MS = 10_000;

/** React Native's WebSocket takes headers as a third argument (the DOM one does not). */
type NativeWebSocket = WebSocket;
const NativeWS = WebSocket as unknown as new (url: string, protocols: string[] | null, opts: { headers: Record<string, string> }) => NativeWebSocket;

async function sha256(bytes: Uint8Array): Promise<string> {
  const buf = new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes)));
  return `sha256:${Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function cleanUrl(raw: string): { ok: true; url: string } | { ok: false; code: string; details: { url: string } } {
  const url = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) return { ok: false, code: 'URL_NO_SCHEME', details: { url: raw } };
  return { ok: true, url };
}

function failOf(e: unknown, url: string): { ok: false; code: string; details: Record<string, unknown> } {
  const err = e as Error;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { ok: false, code: 'TIMEOUT', details: { url, seconds: SIGN_IN_TIMEOUT_MS / 1000 } };
  return { ok: false, code: 'NETWORK', details: { url, message: err?.message ?? String(e) } };
}

class NativeBridge implements MeetlessBridge {
  private stored: StoredSession | null = null;
  private store = new MemorySyncStore();
  private status: SyncStatus = { state: 'signed_out', lastSyncedAt: null, cursor: 0, lastError: null };
  private listeners = new Set<(e: BridgeEvent) => void>();
  private ws: NativeWebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 250;
  private resyncing = false;
  private loaded: Promise<void> | null = null;
  private locale: string | null = null;

  constructor(private readonly opts: { systemLocales: string[] }) {}

  // ---------------------------------------------------------------- http

  private auth(): Record<string, string> {
    return this.stored ? { authorization: `Bearer ${this.stored.token}` } : {};
  }

  private request(path: string, init: RequestInit = {}): Promise<Response> {
    const s = this.stored!;
    return fetch(`${s.serverUrl}${path}`, { ...init, headers: { ...this.auth(), ...((init.headers as Record<string, string>) ?? {}) } });
  }

  // ---------------------------------------------------------------- session

  private ensureLoaded(): Promise<void> {
    this.loaded ??= (async () => {
      const s = await loadSession();
      if (s && !this.stored) this.activate(s);
    })();
    return this.loaded;
  }

  private session(): Session | null {
    return this.stored ? { serverUrl: this.stored.serverUrl, userId: this.stored.userId, displayName: this.stored.displayName } : null;
  }

  private activate(s: StoredSession): void {
    this.deactivate();
    this.stored = s;
    this.store = new MemorySyncStore();
    this.status = { state: 'connecting', lastSyncedAt: null, cursor: 0, lastError: null };
    this.emit({ type: 'session', session: this.session(), locale: this.locale });
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
    this.stored = null;
  }

  private endSession(lastError: string | null = null): void {
    this.deactivate();
    void clearSession();
    this.store = new MemorySyncStore();
    this.status = { state: 'signed_out', lastSyncedAt: null, cursor: 0, lastError };
    this.emit({ type: 'session', session: null, locale: this.locale });
    this.emit({ type: 'reset', events: [] });
    this.emitStatus();
  }

  /** Checks the token with `GET /v1/me`, then stores it and connects. */
  private async startWithToken(url: string, token: string): Promise<Result<{ session: Session }>> {
    let res: Response;
    try {
      res = await fetch(`${url}/v1/me`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(SIGN_IN_TIMEOUT_MS) });
    } catch (e) {
      return failOf(e, url);
    }
    if (res.status === 401) return { ok: false, code: 'UNAUTHENTICATED', details: { url } };
    if (!res.ok) return { ok: false, code: `HTTP_${res.status}`, details: { url, status: res.status } };
    const body = (await res.json().catch(() => null)) as { user?: { id?: string; displayName?: string; locale?: string } } | null;
    if (!body?.user?.id) return { ok: false, code: 'BAD_RESPONSE', details: { url } };
    if (body.user.locale && !this.locale) this.locale = body.user.locale;
    const s: StoredSession = { serverUrl: url, token, userId: body.user.id, displayName: body.user.displayName ?? body.user.id };
    try {
      await saveSession(s);
    } catch {
      // Keychain unavailable: signed in for this run only.
    }
    this.loaded = Promise.resolve();
    this.activate(s);
    return { ok: true, session: this.session()! };
  }

  async signIn(serverUrl: string, token: string): Promise<Result<{ session: Session }>> {
    const t = String(token ?? '').trim();
    const u = cleanUrl(serverUrl);
    if (!u.ok) return u;
    if (!t) return { ok: false, code: 'TOKEN_MISSING', details: { url: u.url } };
    return this.startWithToken(u.url, t);
  }

  /** `invites.redeem` (callable with no session) returns a personal token; then sign in with it. */
  async redeemInvite(serverUrl: string, code: string, displayName: string): Promise<Result<{ session: Session }>> {
    const u = cleanUrl(serverUrl);
    if (!u.ok) return u;
    const r = await callApi(
      u.url,
      null,
      'invites.redeem',
      // Codes are read out and pasted: drop every whitespace character, also inside ("ABCD 1234").
      { code: String(code ?? '').replace(/\s+/g, '').toUpperCase(), displayName: String(displayName ?? '').trim(), locale: this.locale ?? 'en' },
      { signal: AbortSignal.timeout(SIGN_IN_TIMEOUT_MS) },
    );
    if (!r.ok) {
      const details = (r.details && typeof r.details === 'object' ? r.details : {}) as Record<string, unknown>;
      return { ok: false, code: r.code, details: { ...details, url: u.url, cause: r.details } };
    }
    const token = (r.data as { token?: unknown } | null)?.token;
    if (typeof token !== 'string' || !token) return { ok: false, code: 'BAD_RESPONSE', details: { url: u.url } };
    return this.startWithToken(u.url, token);
  }

  async signOut(): Promise<void> {
    this.loaded = Promise.resolve();
    this.endSession();
  }

  async setLocale(locale: string): Promise<void> {
    this.locale = locale;
    this.emit({ type: 'session', session: this.session(), locale });
    // Best effort: also record the personal preference in the team log when online. Never queued.
    if (this.stored && this.status.state === 'online') {
      void this.post({ id: crypto.randomUUID(), type: 'user.locale_changed', payload: { userId: this.stored.userId, locale } });
    }
  }

  // ---------------------------------------------------------------- sync

  private connect(): void {
    const s = this.stored;
    if (!s) return;
    let ws: NativeWebSocket;
    try {
      ws = new NativeWS(`${s.serverUrl.replace(/^http/, 'ws')}/v1/ws`, null, { headers: { authorization: `Bearer ${s.token}` } });
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
    if (this.reconnectTimer || !this.stored) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 5000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private sendSubscribe(ws: NativeWebSocket): void {
    if (ws.readyState === OPEN) ws.send(subscribeMessage(this.store));
  }

  private async onMessage(ws: NativeWebSocket, m: ServerMessage): Promise<void> {
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
        this.backoff = 250;
        this.markSynced(m.cursor, 'online');
        return;
      case 'reset':
        await this.resync(ws);
        return;
      case 'error':
        this.setStatus({ lastError: m.code });
        return;
      case 'build':
        return;
    }
  }

  private markSynced(cursor: Seq, state?: 'online'): void {
    this.setStatus({ cursor, lastSyncedAt: new Date().toISOString(), lastError: null, ...(state ? { state } : {}) });
  }

  private async resync(ws: NativeWebSocket): Promise<void> {
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
      res = await this.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
    } catch {
      return { kind: 'rejected', code: 'OFFLINE' };
    }
    if (res.status >= 500) return { kind: 'rejected', code: 'OFFLINE' };
    const body = (await res.json().catch(() => ({}))) as { status?: string; event?: DomainEvent; error?: { code: string; details?: unknown } };
    if (res.ok && body.event) return { kind: body.status === 'duplicate' ? 'duplicate' : 'accepted', seq: body.event.seq };
    if (res.status === 401) this.endSession('UNAUTHENTICATED');
    return { kind: 'rejected', code: body.error?.code ?? `HTTP_${res.status}`, details: body.error?.details };
  }

  async submit(cmd: CommandInput): Promise<SubmitResult> {
    if (!this.stored) return { kind: 'rejected', code: 'NOT_SIGNED_IN' };
    return this.post({ id: cmd.id, type: cmd.type, payload: cmd.payload, ...(cmd.occurredAt ? { occurredAt: cmd.occurredAt } : {}) });
  }

  async dismissOutbox(_id: Id): Promise<void> {
    // No outbox: online only.
  }

  // ---------------------------------------------------------------- blobs

  async uploadBlob(bytes: Uint8Array, mediaType: string): Promise<Result<{ hash: string; size: number }>> {
    if (!this.stored) return { ok: false, code: 'NOT_SIGNED_IN' };
    const data = new Uint8Array(bytes);
    const hash = await sha256(data);
    let res: Response;
    try {
      res = await this.request(`/v1/blobs/${hash}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream', 'x-meetless-media-type': mediaType || 'application/octet-stream' },
        body: data,
      });
    } catch (e) {
      return { ok: false, code: 'NETWORK', details: (e as Error).message };
    }
    if (!res.ok) {
      const err = ((await res.json().catch(() => null)) as { error?: { code?: string } } | null)?.error;
      return { ok: false, code: err?.code ?? `HTTP_${res.status}` };
    }
    return { ok: true, hash, size: data.byteLength };
  }

  async readBlob(hash: string): Promise<Result<{ bytes: Uint8Array }>> {
    if (!this.stored) return { ok: false, code: 'NOT_SIGNED_IN' };
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

  async api<K extends AppApiName>(name: K, input: ApiRequest<K>): Promise<Result<{ data: ApiResponse<K> }>> {
    if (!APP_ROUTE_SET.has(name)) return { ok: false, code: 'NOT_AVAILABLE' };
    const s = this.stored;
    if (!s) return { ok: false, code: 'NOT_SIGNED_IN' };
    return (await callApi(s.serverUrl, s.token, name, input)) as Result<{ data: ApiResponse<K> }>;
  }

  // ---------------------------------------------------------------- desktop only

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
    await this.ensureLoaded();
    return {
      session: this.session(),
      events: this.store.events(),
      status: { ...this.status },
      outbox: [],
      locale: this.locale,
      systemLocales: this.opts.systemLocales,
      cacheKind: 'memory',
      // The bridge contract has no native host yet; "web" selects the same online-only behaviour.
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
}

export function createNativeBridge(opts: { systemLocales: string[] }): MeetlessBridge {
  return new NativeBridge(opts);
}
