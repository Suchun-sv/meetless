/**
 * U3-owned. T3: reads a Notion page through the Notion MCP server with the
 * user's own OAuth (design §8.8). `connect` runs the MCP SDK's OAuth flow
 * (dynamic client registration, PKCE) with a one-shot loopback callback on
 * 127.0.0.1; tokens, client info and the PKCE verifier live only in
 * `<dataDir>/capture/notion-oauth.json` (mode 0600, written atomically by the
 * capture store's writer). Nothing secret reaches the log, a result or an
 * error message. Without tokens nothing is read and nothing is invented:
 * `notion_not_connected`.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth, UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { noDots, toParagraphs } from '@meetless/core';
import { CaptureError } from '../capture';
import { readJson, writeJsonAtomic } from './store';
import { NOTION_PAGE_URL } from './types';

export const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';
export const NOTION_FETCH_TOOL = 'notion-fetch';
export const NOTION_AUTH_TIMEOUT_MS = 300_000;
const CALLBACK_PATH = '/oauth/callback';
/** Dev-bridge only: a page id served by a loopback fake. */
const LOOPBACK_PAGE_URL = /^http:\/\/127\.0\.0\.1:\d+\/\S+$/;

type Host = 'electron' | 'dev-bridge';

/** `MEETLESS_NOTION_MCP_URL` on the dev-bridge host only (R10); the real Notion MCP everywhere else. */
export function notionServerUrl(host: Host, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.MEETLESS_NOTION_MCP_URL?.trim();
  return host === 'dev-bridge' && override ? override : NOTION_MCP_URL;
}

/** Whether `url` is a page link this host may read: a Notion page, or (dev-bridge only) a loopback page id. */
export function notionUrlAllowed(url: string, host: Host): boolean {
  return NOTION_PAGE_URL.test(url) || (host === 'dev-bridge' && LOOPBACK_PAGE_URL.test(url));
}

interface OAuthFile {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  /** The PKCE verifier of a pending authorization; dropped once the code is exchanged. */
  verifier?: string;
}

const PAGE_STYLE = 'font:16px/1.6 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#1f1d1a';
function staticPage(en: string, zh: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Meetless</title></head><body style="${PAGE_STYLE}"><p>${en}</p><p lang="zh-CN">${zh}</p></body></html>`;
}
const PAGE_OK = staticPage('Meetless: Notion connected. You can close this tab.', 'Meetless 已连接 Notion，可以关闭此页。');
const PAGE_FAILED = staticPage('Meetless: Notion was not connected. Go back to the app and try again.', 'Meetless 未能连接 Notion，请回到应用重试。');

interface Pending {
  server: Server;
  timer: NodeJS.Timeout | null;
}

export interface NotionClientOptions {
  dataDir: string;
  serverUrl?: string;
  log?: (m: string) => void;
  /** Which page links are allowed (see `notionUrlAllowed`). Defaults to the strict `electron`. */
  host?: Host;
  /** Overridable for tests; defaults to `NOTION_AUTH_TIMEOUT_MS`. */
  authTimeoutMs?: number;
}

export class NotionClient {
  readonly serverUrl: string;
  private readonly file: string;
  private readonly host: Host;
  private pending: Pending | null = null;

  constructor(private readonly opts: NotionClientOptions) {
    this.serverUrl = opts.serverUrl ?? NOTION_MCP_URL;
    this.file = join(opts.dataDir, 'capture', 'notion-oauth.json');
    this.host = opts.host ?? 'electron';
  }

  status(): 'connected' | 'disconnected' {
    return this.read().tokens?.access_token ? 'connected' : 'disconnected';
  }

  /**
   * Starts a fresh authorization: drops any stored credentials, opens the
   * loopback callback server, registers a client for its redirect URI, and
   * returns the URL the user opens in a browser. The callback exchanges the
   * code, stores the tokens and closes the server; so does the timeout.
   */
  async connect(): Promise<{ authorizeUrl: string }> {
    this.closePending();
    this.clear();

    const server = createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
      });
    } catch {
      this.log('notionConnect result=notion_failed');
      throw new CaptureError('notion_failed');
    }
    server.unref();
    const pending: Pending = { server, timer: null };
    this.pending = pending;
    // Every write of this attempt is dropped once it is superseded (disconnect, another connect).
    const live = () => this.pending === pending;

    const { port } = server.address() as { port: number };
    const redirectUrl = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
    const state = randomBytes(16).toString('hex');
    const captured: { url: string | null } = { url: null };
    const provider = this.provider(redirectUrl, { state, onRedirect: (u) => (captured.url = u.href), keepVerifier: true, live });

    try {
      const result = await auth(provider, { serverUrl: this.serverUrl });
      if (result !== 'REDIRECT' || captured.url === null || !live()) throw new Error('no authorization url');
    } catch {
      if (live()) {
        this.closePending();
        this.clear();
      }
      this.log('notionConnect result=notion_failed');
      throw new CaptureError('notion_failed');
    }

    pending.timer = setTimeout(() => {
      if (!live()) return;
      this.write({ ...this.read(), verifier: undefined });
      this.finish(pending, 'timeout');
    }, this.opts.authTimeoutMs ?? NOTION_AUTH_TIMEOUT_MS);
    pending.timer.unref();

    let exchanging = false;
    server.on('request', (req: IncomingMessage, res: ServerResponse) => {
      const u = new URL(req.url ?? '/', redirectUrl);
      if (u.pathname !== CALLBACK_PATH) {
        res.writeHead(404, { connection: 'close' }).end();
        return;
      }
      if (u.searchParams.get('state') !== state || exchanging) {
        // A stray or forged callback: refuse it, and keep waiting for the real one.
        this.answer(res, 400, PAGE_FAILED);
        return;
      }
      const code = u.searchParams.get('code');
      if (!code) {
        // The user declined (`error=access_denied`) or the server sent no code.
        this.answer(res, 400, PAGE_FAILED);
        if (live()) this.clear();
        this.finish(pending, 'denied');
        return;
      }
      exchanging = true;
      void (async () => {
        try {
          const result = await auth(provider, { serverUrl: this.serverUrl, authorizationCode: code });
          if (result !== 'AUTHORIZED' || !live()) throw new Error('not authorized');
          this.write({ ...this.read(), verifier: undefined });
          this.answer(res, 200, PAGE_OK);
          this.finish(pending, 'ok');
        } catch {
          if (live()) this.clear();
          this.answer(res, 400, PAGE_FAILED);
          this.finish(pending, 'notion_failed');
        }
      })();
    });

    this.log('notionConnect result=pending');
    return { authorizeUrl: captured.url! };
  }

  /** Forgets every stored credential and closes a pending authorization. */
  async disconnect(): Promise<void> {
    this.closePending();
    this.clear();
    this.log('notionDisconnect result=ok');
  }

  /** Closes a pending authorization's loopback server and timer (shutdown, tests). Credentials stay. */
  async close(): Promise<void> {
    this.closePending();
  }

  /**
   * Reads a page through the MCP `notion-fetch` tool, live, and returns its
   * paragraphs. `bad_url` for a link this host may not read; `notion_not_connected`
   * without tokens (no request is made), or when the credentials are really gone: the
   * server refused the refresh token or the client (the SDK invalidated them), there was
   * no refresh token to try, or a fresh token was refused too. Then the file is dropped.
   * `notion_failed` for anything else, including a refresh that failed for a transient
   * reason (5xx, network): the still-valid refresh token is kept for the next read.
   */
  async fetchPage(url: string): Promise<string[]> {
    const link = url.trim();
    if (!notionUrlAllowed(link, this.host)) throw new CaptureError('bad_url');
    const stored = this.read();
    if (!stored.tokens?.access_token || !stored.client) throw new CaptureError('notion_not_connected');

    // The redirect URI registered by `connect`; a read never sends the user anywhere.
    const redirectUrl = (stored.client as { redirect_uris?: string[] }).redirect_uris?.[0] ?? `http://127.0.0.1${CALLBACK_PATH}`;
    const flags = { needsUser: false, invalidated: false };
    const provider = this.provider(redirectUrl, {
      onRedirect: () => (flags.needsUser = true),
      keepVerifier: false,
      read: { onInvalidated: () => (flags.invalidated = true) },
    });
    const client = new Client({ name: 'meetless', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(this.serverUrl), { authProvider: provider });
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: NOTION_FETCH_TOOL, arguments: { id: link } });
      if (result.isError) throw new CaptureError('notion_failed');
      const content = Array.isArray(result.content) ? (result.content as { type: string; text?: unknown }[]) : [];
      const text = content
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text as string)
        .join('\n');
      return toParagraphs(text).map((p) => noDots(p.text));
    } catch (e) {
      if (e instanceof CaptureError) throw e;
      // A 401 after a completed refresh: even the fresh token is refused.
      const refusedAfterAuth = e instanceof StreamableHTTPError && e.code === 401;
      // The SDK asks for a new authorization both when the refresh token is refused (it
      // invalidates it first) and when the refresh merely failed (5xx, network). Only the
      // first, or having no refresh token at all, means the user has to connect again.
      const wantsUser = flags.needsUser || e instanceof UnauthorizedError;
      const refreshable = !!this.read().tokens?.refresh_token;
      if (flags.invalidated || refusedAfterAuth || (wantsUser && !refreshable)) {
        this.clear();
        throw new CaptureError('notion_not_connected');
      }
      throw new CaptureError('notion_failed');
    } finally {
      await client.close().catch(() => {});
    }
  }

  /**
   * The SDK's view of the token file. `keepVerifier` is true only while `connect`
   * waits for its callback; a read never starts a new authorization on its own
   * (`onRedirect` just notes that the user would have to sign in again). With `read`,
   * the provider cannot save client information, so a read never re-registers a client
   * (dynamic registration happens only in `connect`), and it reports every token or
   * client invalidation the SDK makes.
   */
  private provider(
    redirectUrl: string,
    o: { state?: string; onRedirect: (u: URL) => void; keepVerifier: boolean; live?: () => boolean; read?: { onInvalidated: () => void } },
  ): OAuthClientProvider {
    const live = o.live ?? (() => true);
    const metadata: OAuthClientMetadata = {
      client_name: 'Meetless',
      redirect_uris: [redirectUrl],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    };
    const p: OAuthClientProvider = {
      get redirectUrl() {
        return redirectUrl;
      },
      get clientMetadata() {
        return metadata;
      },
      clientInformation: () => this.read().client,
      saveClientInformation: (client) => {
        if (live()) this.write({ ...this.read(), client });
      },
      tokens: () => this.read().tokens,
      saveTokens: (tokens) => {
        if (live()) this.write({ ...this.read(), tokens });
      },
      redirectToAuthorization: (u) => o.onRedirect(u),
      saveCodeVerifier: (verifier) => {
        if (o.keepVerifier && live()) this.write({ ...this.read(), verifier });
      },
      codeVerifier: () => {
        const v = this.read().verifier;
        if (!v) throw new Error('no pending authorization');
        return v;
      },
      invalidateCredentials: (scope) => {
        if (!live()) return;
        if (scope === 'all' || scope === 'tokens' || scope === 'client') o.read?.onInvalidated();
        const cur = this.read();
        if (scope === 'all') this.clear();
        else if (scope === 'client') this.write({ ...cur, client: undefined });
        else if (scope === 'tokens') this.write({ ...cur, tokens: undefined });
        else if (scope === 'verifier') this.write({ ...cur, verifier: undefined });
      },
    };
    if (o.state !== undefined) {
      const state = o.state;
      p.state = () => state;
    }
    // No saveClientInformation on a read: the SDK then refuses dynamic registration.
    if (o.read) delete p.saveClientInformation;
    return p;
  }

  private answer(res: ServerResponse, status: number, body: string): void {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', connection: 'close' }).end(body);
  }

  private finish(p: Pending, result: string): void {
    if (this.pending !== p) return;
    this.pending = null;
    if (p.timer) clearTimeout(p.timer);
    p.server.close();
    p.server.closeIdleConnections();
    this.log(`notionConnect result=${result}`);
  }

  private closePending(): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    if (p.timer) clearTimeout(p.timer);
    p.server.close();
    p.server.closeAllConnections();
  }

  private read(): OAuthFile {
    return readJson<OAuthFile>(this.file, {});
  }

  /** Atomic, born 0600 (the capture store's writer). An empty record removes the file. */
  private write(data: OAuthFile): void {
    const clean: OAuthFile = {};
    if (data.client) clean.client = data.client;
    if (data.tokens) clean.tokens = data.tokens;
    if (data.verifier) clean.verifier = data.verifier;
    if (!clean.client && !clean.tokens && !clean.verifier) {
      this.clear();
      return;
    }
    mkdirSync(dirname(this.file), { recursive: true });
    writeJsonAtomic(this.file, clean, 0o600);
  }

  private clear(): void {
    rmSync(this.file, { force: true });
  }

  private log(m: string): void {
    this.opts.log?.(m);
  }
}
