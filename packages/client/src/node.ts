import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { DomainEvent, Id, Seq } from '@meetless/core';
import { APP_ROUTE_NAMES, type AppApiName, type ApiRequest, type ApiResponse } from '@meetless/api';
import { GitError, GitRepos } from './git';
import type {
  BridgeEvent,
  CommitInfo,
  DiffFile,
  RepoInfo,
  ClientSnapshot,
  CommandInput,
  MeetlessBridge,
  Result,
  UpdateState,
  Session,
  SubmitResult,
  SyncStatus,
} from './bridge';
import { callApi } from './api-call';
import { CaptureService } from './capture';
import { LocalCache } from './cache';
import { fetchAllEvents, subscribeMessage, type ServerMessage } from './sync-protocol';
// --- U3 capture
import { applyEvent, emptyState, isDomainError, orderBySeq, type IsoTime } from '@meetless/core';
import { CaptureError } from './capture';

/**
 * DEV-ONLY session record. The dev bearer token is stored in plain JSON in the
 * client data directory. A production build must keep credentials in the OS
 * keychain (Electron safeStorage) and use the team identity provider.
 */
interface StoredSession extends Session {
  token: string;
}

export interface ClientNodeOptions {
  dataDir: string;
  systemLocales?: string[];
  /** Never `web`: the web host is the web bridge, not a ClientNode. */
  host?: Exclude<ClientSnapshot['host'], 'web'>;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** Asks the user for a repository folder (Electron dialog). `hint` is only honoured by dev hosts. */
  pickDirectory?: (hint?: string) => Promise<string | null>;
  /** Diagnostics sink (main-process log file). Never receives tokens. */
  log?: (msg: string) => void;
  /** Opens the folder with the log files (Electron); dev hosts return false. */
  openLogs?: () => Promise<boolean>;
  signInTimeoutMs?: number;
  /** The app's own updater (Electron main); without it the update calls answer NOT_AVAILABLE. */
  updates?: { check(): Promise<UpdateState>; install(): Promise<Result<object>> };
}

type PostResult = SubmitResult | { kind: 'network'; message: string };

const sha256 = (b: Uint8Array) => `sha256:${createHash('sha256').update(b).digest('hex')}`;
const BLOB = /^sha256:[0-9a-f]{64}$/;
/** Routes reachable from the app with authentication (contract §3); everything else is `NOT_AVAILABLE` to the client. */
const APP_ROUTE_SET: ReadonlySet<string> = new Set(APP_ROUTE_NAMES);

/** Written 0600: the session file holds the bearer token. */
function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * The client sync engine: one instance per client installation (Electron main
 * process, or a dev bridge host process). Owns the WebSocket connection,
 * resume-from-cursor, the outbox, the SQLite cache and the blob cache.
 * Implements the renderer bridge contract directly.
 */
export class ClientNode implements MeetlessBridge {
  private session: StoredSession | null = null;
  private cache: LocalCache | null = null;
  private ws: WebSocket | null = null;
  private status: SyncStatus = { state: 'signed_out', lastSyncedAt: null, cursor: 0, lastError: null };
  private listeners = new Set<(e: BridgeEvent) => void>();
  private flushing: Promise<void> | null = null;
  private resyncing = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoff: number;
  private closed = false;
  private readonly sessionFile: string;
  private readonly prefsFile: string;
  private readonly repos: GitRepos;
  // --- U3 capture
  private readonly capture: CaptureService;

  private constructor(private readonly opts: ClientNodeOptions) {
    // 0700: the folder holds the session token, the local cache and downloaded files.
    mkdirSync(opts.dataDir, { recursive: true, mode: 0o700 });
    this.sessionFile = join(opts.dataDir, 'session.json');
    // A session.json written by 0.1.0 or earlier may be 0644.
    if (existsSync(this.sessionFile)) chmodSync(this.sessionFile, 0o600);
    this.prefsFile = join(opts.dataDir, 'prefs.json');
    this.repos = new GitRepos(opts.dataDir);
    this.backoff = opts.minBackoffMs ?? 250;
    // --- U3 capture
    this.capture = new CaptureService({ dataDir: opts.dataDir, submit: (cmd) => this.submit(cmd), repos: this.repos, host: this.opts.host ?? 'electron', log: opts.log });
  }

  static async open(opts: ClientNodeOptions): Promise<ClientNode> {
    const node = new ClientNode(opts);
    const s = readJson<StoredSession>(node.sessionFile);
    if (s?.serverUrl && s.token && s.userId) node.activate(s);
    return node;
  }

  // ---------------------------------------------------------------- session

  private accountDir(s: Session): string {
    const key = createHash('sha256').update(`${s.serverUrl}\n${s.userId}`).digest('hex').slice(0, 16);
    return join(this.opts.dataDir, 'accounts', key);
  }

  private activate(s: StoredSession): void {
    this.session = s;
    this.cache = new LocalCache(join(this.accountDir(s), 'cache.sqlite'));
    this.status = { state: 'connecting', lastSyncedAt: this.cache.getSetting('lastSyncedAt'), cursor: this.cache.cursor, lastError: null };
    this.closed = false;
    this.connect();
  }

  private deactivate(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.terminate();
    this.ws = null;
    this.cache?.close();
    this.cache = null;
    this.session = null;
  }

  private publicSession(): Session | null {
    if (!this.session) return null;
    const { serverUrl, userId, displayName } = this.session;
    return { serverUrl, userId, displayName };
  }

  /**
   * Never fails silently: every outcome is a result with a code and the URL that was tried
   * (`details.url`), and is written to the diagnostics log (without the token).
   */
  async signIn(serverUrl: string, token: string): Promise<Result<{ session: Session }>> {
    const r = await this.trySignIn(serverUrl, token);
    this.opts.log?.(`signIn url=${JSON.stringify(String(serverUrl ?? '').trim())} result=${r.ok ? 'ok' : r.code}${!r.ok && r.details && typeof r.details === 'object' && 'message' in r.details ? ` (${String((r.details as { message: unknown }).message)})` : ''}`);
    return r;
  }

  /**
   * Trims, strips a trailing slash and validates the scheme of a server URL the user typed.
   * Shared by `trySignIn` and `redeemInvite`. `details.url` always carries the untrimmed-of-
   * slash, trimmed input, win or lose.
   */
  private checkUrl(serverUrl: string): { ok: true; url: string; raw: string } | { ok: false; code: string; details: { url: string } } {
    const raw = String(serverUrl ?? '').trim();
    const url = raw.replace(/\/+$/, '');
    const fail = (code: string) => ({ ok: false as const, code, details: { url: raw } });
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return fail('URL_NO_SCHEME');
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return fail('URL_INVALID');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fail('URL_INVALID');
    return { ok: true, url, raw };
  }

  private async trySignIn(serverUrl: string, token: string): Promise<Result<{ session: Session }>> {
    const raw = String(serverUrl ?? '').trim();
    if (!String(token ?? '').trim()) return { ok: false, code: 'TOKEN_MISSING', details: { url: raw } };
    const checked = this.checkUrl(serverUrl);
    if (!checked.ok) return checked;
    const { url } = checked;
    const fail = (code: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, code, details: { ...extra, url: checked.raw } });
    let res: Response;
    try {
      res = await fetch(`${url}/v1/me`, { headers: { authorization: `Bearer ${token.trim()}` }, signal: AbortSignal.timeout(this.opts.signInTimeoutMs ?? 10_000) });
    } catch (e) {
      const err = e as Error & { cause?: { code?: string; message?: string } };
      if (err.name === 'TimeoutError' || err.name === 'AbortError') return fail('TIMEOUT', { seconds: Math.round((this.opts.signInTimeoutMs ?? 10_000) / 1000) });
      return fail('NETWORK', { message: err.cause?.code ?? err.cause?.message ?? err.message });
    }
    if (!res.ok) {
      // The body's `{ error: { code, details } }` wins (e.g. 429 RATE_LIMITED with `retryAfter`, 12.8).
      const err = await errorBody(res);
      if (err) return fail(err.code, err.details);
      return res.status === 401 ? fail('UNAUTHENTICATED') : fail(`HTTP_${res.status}`, { status: res.status });
    }
    let body: { user?: { id?: Id; displayName?: string } };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      return fail('BAD_RESPONSE');
    }
    if (!body.user?.id) return fail('BAD_RESPONSE');
    const user = { id: body.user.id, displayName: body.user.displayName ?? body.user.id };
    return this.activateSignIn(url, token, user);
  }

  /**
   * Redeems an invite code on a server that may not have a session yet, then signs in with the
   * token it returns. Reuses `checkUrl`'s validation and `trySignIn`'s timeout. Never logs the
   * code or the token.
   */
  async redeemInvite(serverUrl: string, code: string, displayName: string): Promise<Result<{ session: Session }>> {
    const checked = this.checkUrl(serverUrl);
    if (!checked.ok) {
      this.opts.log?.(`redeemInvite url=${JSON.stringify(checked.details.url)} result=${checked.code}`);
      return checked;
    }
    const { url, raw } = checked;
    const r = await callApi(
      url,
      null,
      'invites.redeem',
      // Codes are read out and pasted: drop every whitespace character, also inside ("ABCD 1234").
      { code: String(code ?? '').replace(/\s+/g, '').toUpperCase(), displayName: String(displayName ?? '').trim(), locale: this.locale() ?? 'en' },
      { signal: AbortSignal.timeout(this.opts.signInTimeoutMs ?? 10_000) },
    );
    if (!r.ok) {
      this.opts.log?.(`redeemInvite url=${JSON.stringify(raw)} result=${r.code}`);
      // The server's details sit at the top (`details.retryAfter`, 12.8) and stay under `cause`.
      return { ok: false, code: r.code, details: { ...objectOrEmpty(r.details), url: raw, cause: r.details } };
    }
    // A 2xx with an unexpected body (empty, an HTML page, `{}`) must not crash sign-in.
    const data = r.data as { token?: unknown; user?: { id?: unknown; displayName?: unknown } } | null;
    if (typeof data?.token !== 'string' || !data.user?.id) {
      this.opts.log?.(`redeemInvite url=${JSON.stringify(raw)} result=BAD_RESPONSE`);
      return { ok: false, code: 'BAD_RESPONSE', details: { url: raw } };
    }
    const user = { id: data.user.id as Id, displayName: typeof data.user.displayName === 'string' ? data.user.displayName : String(data.user.id) };
    const activated = await this.activateSignIn(url, data.token, user);
    this.opts.log?.(`redeemInvite url=${JSON.stringify(raw)} result=${activated.ok ? 'ok' : activated.code}`);
    return activated;
  }

  private async activateSignIn(url: string, token: string, user: { id: Id; displayName: string }): Promise<Result<{ session: Session }>> {
    const body = { user };
    this.deactivate();
    const s: StoredSession = { serverUrl: url, token: token.trim(), userId: body.user.id, displayName: body.user.displayName };
    writeJsonAtomic(this.sessionFile, s);
    this.activate(s);
    this.emit({ type: 'session', session: this.publicSession(), locale: this.locale() });
    this.emit({ type: 'reset', events: this.cache!.events() });
    this.emitStatus();
    return { ok: true, session: this.publicSession()! };
  }

  /**
   * Signs out but keeps the local cache and settings on disk (A01: data is kept). Best-effort
   * revokes the server session first: never awaited into the result, and any failure or error
   * is ignored (sign-out always clears the local session).
   */
  async signOut(): Promise<void> {
    const session = this.session;
    if (session) void callApi(session.serverUrl, session.token, 'session.revoke', {}).catch(() => undefined);
    this.deactivate();
    rmSync(this.sessionFile, { force: true });
    this.status = { state: 'signed_out', lastSyncedAt: null, cursor: 0, lastError: null };
    this.emit({ type: 'session', session: null, locale: this.locale() });
    this.emit({ type: 'reset', events: [] });
    this.emitStatus();
  }

  // ---------------------------------------------------------------- locale

  private locale(): string | null {
    return this.cache?.getSetting('locale') ?? readJson<{ lastLocale?: string }>(this.prefsFile)?.lastLocale ?? null;
  }

  async setLocale(locale: string): Promise<void> {
    writeJsonAtomic(this.prefsFile, { ...(readJson<object>(this.prefsFile) ?? {}), lastLocale: locale });
    this.cache?.setSetting('locale', locale);
    this.emit({ type: 'session', session: this.publicSession(), locale });
    // Best effort: also record the personal preference in the team log when online. Never queued.
    if (this.session && this.status.state === 'online') {
      void this.post({ id: randomUUID(), type: 'user.locale_changed', payload: { userId: this.session.userId, locale } });
    }
  }

  // ---------------------------------------------------------------- sync

  private connect(): void {
    if (!this.session || this.closed) return;
    const s = this.session;
    const ws = new WebSocket(`${s.serverUrl.replace(/^http/, 'ws')}/v1/ws`, { headers: { authorization: `Bearer ${s.token}` } });
    this.ws = ws;
    this.setStatus({ state: 'connecting' });
    ws.on('message', (raw) => {
      let m: ServerMessage;
      try {
        m = JSON.parse(String(raw)) as ServerMessage;
      } catch {
        return;
      }
      void this.onMessage(ws, m);
    });
    ws.on('unexpected-response', (_req, res) => {
      this.setStatus({ lastError: res.statusCode === 401 ? 'UNAUTHENTICATED' : `HTTP_${res.statusCode}` });
      ws.terminate();
    });
    ws.on('error', (e) => {
      this.opts.log?.(`sync connection error: ${e.message}`);
      this.setStatus({ lastError: e.message });
    });
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closed) return;
      this.setStatus({ state: 'offline' });
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closed) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.opts.maxBackoffMs ?? 5000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private sendSubscribe(ws: WebSocket): void {
    if (!this.cache || ws.readyState !== ws.OPEN) return;
    ws.send(subscribeMessage(this.cache));
  }

  private async onMessage(ws: WebSocket, m: ServerMessage): Promise<void> {
    if (ws !== this.ws || !this.cache) return;
    switch (m.type) {
      case 'hello':
        this.sendSubscribe(ws);
        return;
      case 'events': {
        const fresh = this.cache.append(m.events, m.cursor, m.epoch);
        this.markSynced(m.cursor);
        if (fresh.length > 0) this.emit({ type: 'events', events: fresh });
        return;
      }
      case 'synced':
        this.cache.append([], m.cursor, m.epoch);
        this.backoff = this.opts.minBackoffMs ?? 250;
        this.markSynced(m.cursor, 'online');
        void this.flushOutbox();
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
    const now = new Date().toISOString();
    this.cache?.setSetting('lastSyncedAt', now);
    this.setStatus({ cursor, lastSyncedAt: now, lastError: null, ...(state ? { state } : {}) });
  }

  /** Full refetch from seq 0 (access changed / different log). Replaces the cache and purges unreadable blobs. */
  private async resync(ws: WebSocket): Promise<void> {
    if (this.resyncing || !this.session || !this.cache) return;
    this.resyncing = true;
    try {
      const session = this.session;
      const { events, cursor: after, epoch } = await fetchAllEvents(async (after) => {
        const res = await fetch(`${session.serverUrl}/v1/events?after=${after}&limit=5000`, {
          headers: { authorization: `Bearer ${session.token}` },
        });
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        return (await res.json()) as { events: DomainEvent[]; cursor: Seq; head: Seq; epoch: Id | null };
      });
      if (ws !== this.ws || !this.cache) return;
      this.cache.replace(events, after, epoch);
      this.purgeBlobs();
      this.setStatus({ cursor: after });
      this.emit({ type: 'reset', events });
      this.sendSubscribe(ws);
    } catch (e) {
      this.setStatus({ lastError: (e as Error).message });
      ws.terminate();
    } finally {
      this.resyncing = false;
    }
  }

  // ---------------------------------------------------------------- commands

  private async post(cmd: { id: Id; type: string; payload: unknown; occurredAt?: string }): Promise<PostResult> {
    if (!this.session) return { kind: 'rejected', code: 'NOT_SIGNED_IN' };
    let res: Response;
    try {
      res = await fetch(`${this.session.serverUrl}/v1/commands`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.session.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(cmd),
      });
    } catch (e) {
      return { kind: 'network', message: (e as Error).message };
    }
    if (res.status >= 500) return { kind: 'network', message: `HTTP_${res.status}` };
    const body = (await res.json().catch(() => ({}))) as { status?: string; event?: DomainEvent; error?: { code: string; details?: unknown } };
    if (res.ok && body.event) return { kind: body.status === 'duplicate' ? 'duplicate' : 'accepted', seq: body.event.seq };
    return { kind: 'rejected', code: body.error?.code ?? `HTTP_${res.status}`, details: body.error?.details };
  }

  async submit(cmd: CommandInput): Promise<SubmitResult> {
    if (!this.session || !this.cache) return { kind: 'rejected', code: 'NOT_SIGNED_IN' };
    // Preserve submission order: while anything is queued, new commands queue behind it.
    if (this.cache.outbox().some((i) => i.status === 'queued')) {
      this.enqueue(cmd);
      void this.flushOutbox();
      return { kind: 'queued' };
    }
    const r = await this.post(cmd);
    if (r.kind !== 'network') return r;
    this.enqueue(cmd);
    return { kind: 'queued' };
  }

  private enqueue(cmd: CommandInput): void {
    this.cache!.putOutbox({
      id: cmd.id,
      type: cmd.type,
      payload: cmd.payload,
      ...(cmd.occurredAt ? { occurredAt: cmd.occurredAt } : {}),
      queuedAt: new Date().toISOString(),
      status: 'queued',
      error: null,
    });
    this.emit({ type: 'outbox', outbox: this.cache!.outbox() });
  }

  /** Sends queued commands in order. Rejections are kept (visible, dismissable), never silently dropped. */
  flushOutbox(): Promise<void> {
    if (this.flushing) return this.flushing;
    const run = async () => {
      for (const item of this.cache?.outbox() ?? []) {
        if (item.status !== 'queued') continue;
        const r = await this.post({ id: item.id, type: item.type, payload: item.payload, ...(item.occurredAt ? { occurredAt: item.occurredAt } : {}) });
        if (!this.cache) return;
        if (r.kind === 'network') {
          this.setStatus({ lastError: r.message });
          // Still connected (e.g. a stale pooled HTTP connection): retry shortly instead of waiting for the next reconnect.
          if (this.status.state === 'online') setTimeout(() => void this.flushOutbox(), 300).unref?.();
          return;
        }
        if (r.kind === 'rejected') this.cache.putOutbox({ ...item, status: 'rejected', error: { code: r.code, details: r.details } });
        else this.cache.removeOutbox(item.id);
        this.emit({ type: 'outbox', outbox: this.cache.outbox() });
      }
    };
    // Cleared in a later microtask, so an outbox that empties synchronously does not leave a stale promise behind.
    const p: Promise<void> = run().finally(() => {
      if (this.flushing === p) this.flushing = null;
    });
    this.flushing = p;
    return p;
  }

  async dismissOutbox(id: Id): Promise<void> {
    if (!this.cache) return;
    const item = this.cache.outbox().find((i) => i.id === id);
    // Only rejected items can be dismissed; a queued command is still pending delivery.
    if (item?.status === 'rejected') this.cache.removeOutbox(id);
    this.emit({ type: 'outbox', outbox: this.cache.outbox() });
  }

  // ---------------------------------------------------------------- blobs

  private blobPath(hash: string): string {
    return join(this.accountDir(this.session!), 'blobs', hash.slice(7, 9), hash.slice(9));
  }

  private referencedHashes(): Set<string> {
    const out = new Set<string>();
    for (const e of this.cache?.events() ?? []) {
      switch (e.type) {
        case 'input.imported':
          if (e.payload.blobHash) out.add(e.payload.blobHash);
          break;
        case 'input.shared':
          if (e.payload.snapshot?.input.blobHash) out.add(e.payload.snapshot.input.blobHash);
          break;
        case 'artifact.version_added':
          if (e.payload.blobHash) out.add(e.payload.blobHash);
          break;
        case 'artifact.shared':
          for (const v of e.payload.snapshot?.artifact.versions ?? []) {
            if (v.blobHash) out.add(v.blobHash);
            for (const h of v.derived?.pageHashes ?? []) out.add(h);
          }
          break;
        case 'artifactVersion.derived':
          for (const h of e.payload.pageHashes) out.add(h);
          break;
      }
    }
    for (const k of (this.cache?.getSetting('uploaded') ?? '').split(',')) if (k) out.add(k);
    return out;
  }

  private storeBlob(hash: string, bytes: Uint8Array): void {
    const file = this.blobPath(hash);
    if (existsSync(file)) return;
    mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, file);
  }

  private purgeBlobs(): void {
    if (!this.session) return;
    const keep = this.referencedHashes();
    const root = join(this.accountDir(this.session), 'blobs');
    if (!existsSync(root)) return;
    for (const d of readdirSync(root)) {
      for (const f of readdirSync(join(root, d))) {
        if (!keep.has(`sha256:${d}${f}`)) rmSync(join(root, d, f), { force: true });
      }
    }
  }

  async uploadBlob(bytes: Uint8Array, mediaType: string): Promise<Result<{ hash: string; size: number }>> {
    if (!this.session || !this.cache) return { ok: false, code: 'NOT_SIGNED_IN' };
    const data = new Uint8Array(bytes);
    const hash = sha256(data);
    let res: Response;
    try {
      res = await fetch(`${this.session.serverUrl}/v1/blobs/${hash}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${this.session.token}`, 'content-type': 'application/octet-stream', 'x-meetless-media-type': mediaType || 'application/octet-stream' },
        body: data,
      });
    } catch (e) {
      return { ok: false, code: 'NETWORK', details: (e as Error).message };
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { code: string } };
      return { ok: false, code: body.error?.code ?? `HTTP_${res.status}` };
    }
    this.storeBlob(hash, data);
    const uploaded = new Set((this.cache.getSetting('uploaded') ?? '').split(',').filter(Boolean));
    uploaded.add(hash);
    this.cache.setSetting('uploaded', [...uploaded].join(','));
    return { ok: true, hash, size: data.byteLength };
  }

  async readBlob(hash: string): Promise<Result<{ bytes: Uint8Array }>> {
    if (!this.session || !this.cache) return { ok: false, code: 'NOT_SIGNED_IN' };
    if (!BLOB.test(hash)) return { ok: false, code: 'INVALID_CONTENT_HASH' };
    // Local copies are only served for content this user can still see in the synced (permission-filtered) log.
    if (!this.referencedHashes().has(hash)) return { ok: false, code: 'NOT_AUTHORISED' };
    const file = this.blobPath(hash);
    if (existsSync(file)) return { ok: true, bytes: new Uint8Array(readFileSync(file)) };
    let res: Response;
    try {
      res = await fetch(`${this.session.serverUrl}/v1/blobs/${hash}`, { headers: { authorization: `Bearer ${this.session.token}` } });
    } catch (e) {
      return { ok: false, code: 'NETWORK', details: (e as Error).message };
    }
    if (!res.ok) return { ok: false, code: res.status === 403 ? 'NOT_AUTHORISED' : `HTTP_${res.status}` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (sha256(bytes) !== hash) return { ok: false, code: 'INVALID_CONTENT_HASH' };
    this.storeBlob(hash, bytes);
    return { ok: true, bytes };
  }

  // ---------------------------------------------------------------- api

  /** Non-app routes (MCP-only) refuse with `NOT_AVAILABLE` before any request is made. */
  async api<K extends AppApiName>(name: K, input: ApiRequest<K>): Promise<Result<{ data: ApiResponse<K> }>> {
    if (!APP_ROUTE_SET.has(name)) return { ok: false, code: 'NOT_AVAILABLE' };
    if (!this.session) return { ok: false, code: 'NOT_SIGNED_IN' };
    const r = await callApi(this.session.serverUrl, this.session.token, name, input);
    return r as Result<{ data: ApiResponse<K> }>;
  }

  async updatesCheck(): Promise<Result<{ update: UpdateState }>> {
    return this.opts.updates ? { ok: true, update: await this.opts.updates.check() } : { ok: false, code: 'NOT_AVAILABLE' };
  }

  async updatesInstall(): Promise<Result<object>> {
    return this.opts.updates ? this.opts.updates.install() : { ok: false, code: 'NOT_AVAILABLE' };
  }

  async openLogs(): Promise<Result<{ opened: boolean }>> {
    const opened = (await this.opts.openLogs?.()) ?? false;
    return opened ? { ok: true, opened } : { ok: false, code: 'NOT_AVAILABLE' };
  }

  // ---------------------------------------------------------------- local git (main process only)

  private async gitCall<T>(fn: () => Promise<T>): Promise<Result<T>> {
    try {
      return { ok: true, ...(await fn()) } as Result<T>;
    } catch (e) {
      return { ok: false, code: e instanceof GitError ? e.code : 'GIT_FAILED' };
    }
  }

  async pickRepo(hint?: string): Promise<Result<{ repo: RepoInfo }>> {
    const dir = await this.opts.pickDirectory?.(hint);
    if (!dir) return { ok: false, code: 'CANCELLED' };
    return this.gitCall(async () => ({ repo: await this.repos.register(dir) }));
  }

  async listRepos(): Promise<RepoInfo[]> {
    return this.repos.list();
  }

  repoLog(repoId: string, ref = 'HEAD', limit = 50): Promise<Result<{ commits: CommitInfo[] }>> {
    return this.gitCall(async () => ({ commits: await this.repos.log(repoId, ref, limit) }));
  }

  repoDiff(repoId: string, base: string | null, head: string): Promise<Result<{ files: DiffFile[] }>> {
    return this.gitCall(async () => ({ files: await this.repos.diffFiles(repoId, base, head) }));
  }

  repoPatch(repoId: string, base: string | null, head: string, path: string): Promise<Result<{ patch: string; truncated: boolean }>> {
    return this.gitCall(() => this.repos.patch(repoId, base, head, path));
  }

  async repoSnapshot(repoId: string, commit: string, base?: string | null, paths: string[] = []) {
    const built = await this.gitCall(async () => ({ snap: await this.repos.snapshot(repoId, commit, base, paths) }));
    if (!built.ok) return built;
    const { snap } = built;
    const up = await this.uploadBlob(new TextEncoder().encode(JSON.stringify(snap)), 'application/vnd.meetless.code-snapshot+json');
    if (!up.ok) return up;
    return { ok: true as const, hash: up.hash, size: up.size, commit: snap.commit, branch: snap.branch, baseCommit: snap.baseCommit, repo: snap.repo, files: snap.files.length, truncated: snap.truncated };
  }

  async snapshot(): Promise<ClientSnapshot> {
    return {
      session: this.publicSession(),
      events: this.cache?.events() ?? [],
      status: { ...this.status },
      outbox: this.cache?.outbox() ?? [],
      locale: this.locale(),
      systemLocales: this.opts.systemLocales ?? [],
      cacheKind: 'sqlite',
      host: this.opts.host ?? 'dev-bridge',
    };
  }

  // --- U3 capture
  /**
   * Builds `this.capture`'s context from the current snapshot: state replays the visible events
   * and skips any that no longer apply (the same rule as the renderer's `safeReplay`), `me` is
   * the signed-in user, `today` is the local calendar date. Null when signed out.
   */
  private async captureCtx(): Promise<import('./capture').CaptureContext | null> {
    if (!this.session) return null;
    const snap = await this.snapshot();
    let state = emptyState();
    for (const e of orderBySeq(snap.events)) {
      if (e.seq <= state.lastSeq) continue;
      try {
        state = applyEvent(state, e);
      } catch (err) {
        if (!isDomainError(err)) throw err;
      }
    }
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return { state, me: this.session.userId, today };
  }

  /** Mirrors `gitCall`: a known `CaptureError` keeps its code, anything else becomes a safe, generic failure (never a rejected promise). */
  private async captureCall<T>(fn: () => Promise<T>): Promise<Result<T>> {
    try {
      return { ok: true, ...(await fn()) } as Result<T>;
    } catch (e) {
      return { ok: false, code: e instanceof CaptureError ? e.code : 'CAPTURE_FAILED' };
    }
  }

  async captureStatus(projectId: Id): Promise<Result<{ status: import('./capture/types').CaptureStatus }>> {
    const ctx = await this.captureCtx();
    if (!ctx) return { ok: false, code: 'not_signed_in' };
    return this.captureCall(async () => ({ status: await this.capture.status(ctx.state, ctx.me, projectId) }));
  }

  async captureBindRepo(artifactId: Id, repoId: string | null): Promise<Result<{ bound: boolean }>> {
    if (!this.session) return { ok: false, code: 'not_signed_in' };
    return this.captureCall(async () => {
      await this.capture.bindRepo(artifactId, repoId);
      return { bound: true };
    });
  }

  async captureRun(req: import('./capture/types').CaptureRunRequest): Promise<Result<{ runId: Id; result: import('./capture/types').CaptureRunResult }>> {
    const ctx = await this.captureCtx();
    if (!ctx) return { ok: false, code: 'not_signed_in' };
    return this.captureCall(async () => ({ runId: `run-${randomUUID()}`, result: await this.capture.run(ctx, req) }));
  }

  async overleafSetToken(token: string | null): Promise<Result<{ saved: boolean }>> {
    if (!this.session) return { ok: false, code: 'not_signed_in' };
    return this.captureCall(async () => {
      await this.capture.setOverleafToken(token);
      return { saved: true };
    });
  }

  async overleafSync(artifactId: Id): Promise<Result<{ repo: RepoInfo; syncedAt: IsoTime }>> {
    const ctx = await this.captureCtx();
    if (!ctx) return { ok: false, code: 'not_signed_in' };
    const a = ctx.state.artifacts[artifactId];
    if (!a) return { ok: false, code: 'not_found' };
    return this.captureCall(() => this.capture.syncOverleaf(a));
  }

  async notionConnect(): Promise<Result<{ authorizeUrl: string }>> {
    if (!this.session) return { ok: false, code: 'not_signed_in' };
    return this.captureCall(() => this.capture.notionConnect());
  }

  async notionDisconnect(): Promise<Result<{ disconnected: true }>> {
    if (!this.session) return { ok: false, code: 'not_signed_in' };
    return this.captureCall(async () => {
      await this.capture.notionDisconnect();
      return { disconnected: true as const };
    });
  }

  async notionPage(artifactId: Id): Promise<Result<{ paragraphs: string[]; fetchedAt: IsoTime }>> {
    const ctx = await this.captureCtx();
    if (!ctx) return { ok: false, code: 'not_signed_in' };
    const a = ctx.state.artifacts[artifactId];
    if (!a) return { ok: false, code: 'not_found' };
    return this.captureCall(() => this.capture.notionPage(a));
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

  /** Test / shutdown hook: stop syncing and close the cache (data stays on disk). */
  async close(): Promise<void> {
    this.deactivate();
  }
}

/** Plain-object details, or `{}`: what can be spread next to the URL in a sign-in result. */
function objectOrEmpty(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** The `{ error: { code, details } }` of a non-2xx answer, or null when the body carries no code. */
async function errorBody(res: Response): Promise<{ code: string; details: Record<string, unknown> } | null> {
  let body: unknown;
  try {
    body = JSON.parse(await res.text());
  } catch {
    return null;
  }
  const err = (body as { error?: { code?: unknown; details?: unknown } } | null)?.error;
  return typeof err?.code === 'string' && err.code ? { code: err.code, details: objectOrEmpty(err.details) } : null;
}
