import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import { isDomainError, type Id, type Seq } from '@meetless/core';
import { WEB_SESSION_COOKIE } from '@meetless/api';
import { ApiError, authenticateRequest, errorResponse, registerApiRoutes, requireUserPrincipal, type ApiDeps } from './api/index';
import { RateLimiter } from './api/ratelimit';
import { printUsage, ProjectAi } from './agents/deepseek';
import { loadSkillMarkdown, skillPathFromEnv } from './accounts/guide';
import { registerMcp } from './mcp/server';
import { bearerToken, isAuthFailure, type Principal } from './auth';
import { OfficeViewer } from './office/onlyoffice';
import { OfficeTickets } from './office/tickets';
import type { Command, SyncService } from './service';
import { originAllowed, parseCookies, rawRequestTarget } from './web/cookies';
import { registerWebSession } from './web/session';
import { registerWebStatic } from './web/static';
import { registerClientErrors } from './web/client-error';
import { isOfficePath, proxyOfficeUpgrade, registerOfficeProxy } from './web/office-proxy';

/** Messages on /v1/ws. Client -> server: subscribe. Server -> client: hello / events / synced / reset / error. */
export type ClientMessage = { type: 'subscribe'; after: Seq; epoch?: Id | null };
export type ServerMessage =
  | { type: 'hello'; head: Seq; epoch: Id | null; userId: Id }
  | { type: 'events'; events: unknown[]; cursor: Seq; head: Seq; epoch: Id | null }
  /** Sent once after a subscribe has been served up to the current head. */
  | { type: 'synced'; cursor: Seq; head: Seq; epoch: Id | null }
  | { type: 'reset'; reason: 'cursor_mismatch' | 'access_changed' }
  | { type: 'error'; code: string }
  /** The renderer build the server serves (a hash of the web dir's index.html): the web offers a refresh when it changes. */
  | { type: 'build'; hash: string };

const READ_DENIED = new Set(['NOT_A_MEMBER', 'NOT_AUTHORISED']);

/** A request (headers and body) that has not fully arrived after this long is dropped (Fastify's default is never). */
export const REQUEST_TIMEOUT_MS = 5 * 60_000;

/** Closes a websocket whose token was revoked. */
export const WS_TOKEN_REVOKED = 4401;

/**
 * The client address of a raw Node request (the websocket upgrade has no Fastify request):
 * the address `hops` steps from the right of [...X-Forwarded-For entries, socket address]
 * (empty entries skipped, spaces trimmed), or the leftmost one if the chain is shorter. With
 * `hops = 0` that is the socket address. Each trusted proxy appends the address it saw, so only
 * the rightmost `hops` entries are trustworthy; anything to their left is client-supplied. This
 * is proxy-addr's hop-count rule, the same one `fastifyTrustProxy(hops)` gives `request.ip`.
 */
export function clientIp(req: Pick<IncomingMessage, 'headers' | 'socket'>, hops: number): string {
  const socketAddr = req.socket.remoteAddress ?? '';
  if (hops <= 0) return socketAddr;
  const xff = req.headers['x-forwarded-for'];
  const entries = (Array.isArray(xff) ? xff.join(',') : (xff ?? ''))
    .split(',')
    .map((a) => a.replace(/^ +| +$/g, ''))
    .filter((a) => a !== '');
  const chain = [socketAddr, ...entries.reverse()];
  return chain[Math.min(hops, chain.length - 1)]!;
}

/**
 * Fastify's `trustProxy` for a hop count. Fastify 5 treats a plain number as "trust nothing"
 * (it fails closed), so the hop count is passed as proxy-addr's own trust function instead:
 * trust the first `hops` addresses counted from the socket. `request.ip`, `request.protocol`
 * (X-Forwarded-Proto) and `request.host` (X-Forwarded-Host) then all follow the same rule.
 */
export function fastifyTrustProxy(hops: number): false | ((addr: string, i: number) => boolean) {
  return hops > 0 ? (_addr, i) => i < hops : false;
}

/**
 * `rateLimits` defaults to a pair of `RateLimiter`s built from `cfg.rateLimits`; callers that
 * build their own `ApiDeps` need not supply it. `officeTickets` defaults to a fresh
 * `OfficeTickets` (its own random secret); `startServer` passes the one it also gives
 * `startFilesSocket`, so a ticket `office.config` issues is one the socket can verify.
 */
export interface AppOptions extends Omit<ApiDeps, 'rateLimits' | 'officeViewer' | 'skillMarkdown'> {
  maxBlobBytes?: number;
  rateLimits?: ApiDeps['rateLimits'];
  officeTickets?: OfficeTickets;
  /** Test-only: injected into the `OfficeViewer`'s health-check fetch. */
  officeFetch?: typeof fetch;
  /** Optional here even though `ApiDeps.skillMarkdown` is required: omitted, `buildApp` reads it itself. */
  skillMarkdown?: string;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { service, auth, cfg } = opts;
  // `startServer` already reads this before allocating anything (so a missing skill file
  // fails before any store or worker is created); a direct `buildApp` caller (a test) gets the
  // same read done here instead, so it need not supply one itself.
  const skillMarkdown = opts.skillMarkdown ?? loadSkillMarkdown(skillPathFromEnv(cfg.env ?? {}));
  // forceCloseConnections: on shutdown drop keep-alive and in-flight sockets; clients retry idempotently.
  // trustProxy: behind `cfg.trustProxy` reverse proxies, request.ip is the client's address (X-Forwarded-For, by hop count).
  const app = Fastify({
    logger: cfg.logger,
    bodyLimit: 1024 * 1024,
    forceCloseConnections: true,
    trustProxy: fastifyTrustProxy(cfg.trustProxy),
    requestTimeout: REQUEST_TIMEOUT_MS,
  });

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: opts.maxBlobBytes ?? 200 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  // One pair of limiters for the lifetime of this app, shared by the /v1 routes, the typed frame and the websocket upgrade.
  const rateLimits: ApiDeps['rateLimits'] = opts.rateLimits ?? {
    signIn: new RateLimiter(cfg.rateLimits.signIn, () => cfg.now().getTime()),
    redeem: new RateLimiter(cfg.rateLimits.redeem, () => cfg.now().getTime()),
  };
  const ai = opts.ai ?? new ProjectAi(cfg.ai ?? null, { now: cfg.now, log: printUsage });
  const deps: ApiDeps = { service, accounts: opts.accounts, auth, cfg, rateLimits, skillMarkdown, ai };
  // One OfficeViewer per server, so its 30s availability cache actually caches across requests.
  deps.officeViewer = new OfficeViewer(deps, opts.officeTickets ?? new OfficeTickets(), opts.officeFetch);

  /**
   * The /v1 sync and blob routes act as the user: personal and dev tokens only (an agent token
   * gets 403). They are reached from the app, so the web session cookie is honoured too (with
   * the CSRF rule on writes).
   */
  const userOf = async (req: FastifyRequest): Promise<Principal> =>
    requireUserPrincipal(await authenticateRequest(auth, req, rateLimits.signIn, { cookie: true, cfg }));

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      const out = errorResponse(err);
      for (const [k, v] of Object.entries(out.headers ?? {})) reply.header(k, v);
      return reply.code(out.status).send(out.body);
    }
    if (isDomainError(err)) {
      const read = req.method === 'GET';
      const status = read && READ_DENIED.has(err.code) ? 403 : err.code === 'NOT_FOUND' && read ? 404 : 422;
      return reply.code(status).send({ error: { code: err.code, details: err.details } });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: { code: e.code ?? 'BAD_REQUEST' } });
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'INTERNAL' } });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND' } }));

  app.get('/health', async () => ({ ok: true, store: service.store.kind, devAuth: cfg.devAuth, head: service.head }));

  // Every API_ROUTES entry (`/v1/me` included), each through the typed frame.
  registerApiRoutes(app, deps);
  // POST /mcp: the seven MCP tools over Streamable HTTP, each running its route above.
  registerMcp(app, deps);
  // POST / DELETE /v1/web/session: web sign-in and sign-out (the HttpOnly session cookie).
  registerWebSession(app, deps);

  app.post('/v1/commands', async (req, reply) => {
    const u = await userOf(req);
    const r = await service.submit(u.userId, req.body as Command);
    return reply.code(r.status === 'accepted' ? 201 : 200).send(r);
  });

  app.get('/v1/events', async (req, reply) => {
    const u = await userOf(req);
    const q = req.query as { after?: string; limit?: string; epoch?: string };
    const after = Number(q.after ?? 0);
    const limit = Math.min(Number(q.limit ?? 5000) || 5000, 5000);
    if (!Number.isInteger(after)) return reply.code(400).send({ error: { code: 'BAD_REQUEST' } });
    return service.eventsFor(u.userId, after, limit, q.epoch === undefined ? undefined : q.epoch || null);
  });

  // Authenticated in onRequest, before the body is read: an anonymous upload is refused at its
  // headers instead of after up to 200 MB have been buffered.
  const blobUploader = new WeakMap<FastifyRequest, Principal>();
  const blobPutAuth = async (req: FastifyRequest) => void blobUploader.set(req, await userOf(req));
  app.put('/v1/blobs/:hash', { onRequest: blobPutAuth }, async (req, reply) => {
    const u = blobUploader.get(req)!;
    const { hash } = req.params as { hash: string };
    if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ error: { code: 'EXPECTED_OCTET_STREAM' } });
    const mediaType = String(req.headers['x-meetless-media-type'] ?? 'application/octet-stream').slice(0, 200);
    const r = await service.putBlob(u.userId, hash, req.body, mediaType);
    // Same status and body whether the bytes were already there or not: the uploader never learns
    // that someone else already had them (content-addressed storage must not leak that).
    return reply.code(200).send({ hash, size: r.size });
  });

  app.get('/v1/blobs/:hash', async (req, reply) => {
    const u = await userOf(req);
    const { hash } = req.params as { hash: string };
    const meta = await service.blobMeta.get(hash);
    // Same answer for "missing" and "not yours", so access checks do not leak which hashes exist.
    if (!meta || !(await service.canReadBlob(u.userId, hash))) return reply.code(403).send({ error: { code: 'NOT_AUTHORISED' } });
    // The type is whatever the first uploader said: never sniffed, never rendered as a page.
    return reply
      .header('content-type', meta.mediaType)
      .header('content-length', String(meta.size))
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', 'attachment')
      .header('content-security-policy', "sandbox; default-src 'none'")
      .send(service.blobFiles.read(hash));
  });

  // GET /, /index.html and other files under cfg.webDir (design 2026-11-25 §4): the renderer
  // build, with a CSP header and the web marker meta. Never shadows /v1, /mcp, /health or
  // /office — a no-op when cfg.webDir is null.
  registerWebStatic(app, cfg);
  // POST /v1/client-error: boot and render errors from the web page, logged as one capped line (no auth, rate-limited).
  registerClientErrors(app, cfg);
  // /office/*: DocumentServer reverse-proxied for the web (design 2026-11-25 §5); its websockets go through the upgrade handler below.
  registerOfficeProxy(app, cfg);

  attachWebSocket(app, service, deps);
  return app;
}

function attachWebSocket(app: FastifyInstance, service: SyncService, { auth, cfg, rateLimits }: ApiDeps): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  interface Sub {
    ws: WebSocket;
    userId: Id;
    /** The token the socket was opened with; null for a dev token. */
    tokenId: Id | null;
    cursor: Seq;
    subscribed: boolean;
    readableKey: string;
  }
  const subs = new Set<Sub>();
  const send = (ws: WebSocket, m: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  };
  // The renderer build served at /, checked every minute; every socket hears when it changes.
  const buildHash = (): string | null => {
    if (!cfg.webDir) return null;
    try {
      return createHash('sha256').update(readFileSync(join(cfg.webDir, 'index.html'))).digest('hex').slice(0, 16);
    } catch {
      return null;
    }
  };
  let build = buildHash();
  const buildTimer = setInterval(() => {
    const next = buildHash();
    if (!next || next === build) return;
    build = next;
    for (const s of subs) send(s.ws, { type: 'build', hash: next });
  }, 60_000);
  buildTimer.unref();

  const pump = (s: Sub) => {
    while (s.subscribed) {
      const page = service.eventsFor(s.userId, s.cursor, 1000);
      if (page.cursor === s.cursor) return;
      s.cursor = page.cursor;
      // Also sent when every event in the page was filtered out, so the client's resume cursor keeps up.
      send(s.ws, { type: 'events', events: page.events, cursor: page.cursor, head: page.head, epoch: page.epoch });
    }
  };

  service.onAppended(() => {
    for (const s of subs) {
      if (!s.subscribed) continue;
      const key = service.readableKey(s.userId);
      if (key !== s.readableKey) {
        // Readable projects changed (added to / removed from a project): the client must refetch from 0,
        // which also purges anything it may no longer see (PRD §7.3).
        s.subscribed = false;
        send(s.ws, { type: 'reset', reason: 'access_changed' });
        continue;
      }
      pump(s);
    }
  });

  const offRevoked = auth.onRevoked((tokenId) => {
    for (const s of subs) if (s.tokenId === tokenId) s.ws.close(WS_TOKEN_REVOKED, 'TOKEN_REVOKED');
  });

  const refuse = (socket: Duplex, status: string) => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  /**
   * The upgrade's principal and the token it authenticated with, or null after answering 401
   * (unknown, revoked or agent token), 429 or 403 (a cookie session from a missing or foreign
   * Origin: cross-site websocket hijacking, design 2026-11-25 §3).
   */
  const principalOf = async (req: IncomingMessage, socket: Duplex): Promise<{ p: Principal; token: string } | null> => {
    try {
      const target = rawRequestTarget(req, cfg.trustProxy);
      // Personal and dev tokens only, as on the /v1 sync routes; an agent token is refused like an unknown one.
      const p = requireUserPrincipal(
        await authenticateRequest(
          auth,
          { headers: req.headers, ip: clientIp(req, cfg.trustProxy), method: req.method, protocol: target.protocol, host: target.host },
          rateLimits.signIn,
          { cookie: true, cfg },
        ),
      );
      if (p.via === 'cookie') {
        // A browser always sends Origin on a websocket handshake; a cookie socket without an allowed one is refused.
        if (!originAllowed(cfg, { headers: req.headers, ...target })) {
          refuse(socket, '403 Forbidden');
          return null;
        }
        return { p, token: parseCookies(req.headers.cookie)[WEB_SESSION_COOKIE] ?? '' };
      }
      return { p, token: bearerToken(req.headers.authorization) ?? '' };
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      // A failed upgrade answers before any protocol switch (contract §12.8: 429 with Retry-After once over the limit).
      if (e.code === 'RATE_LIMITED') {
        const { retryAfter } = e.details as { retryAfter: number };
        socket.write(`HTTP/1.1 429 Too Many Requests\r\nRetry-After: ${retryAfter}\r\nConnection: close\r\n\r\n`);
        socket.destroy();
      } else {
        refuse(socket, '401 Unauthorized');
      }
      return null;
    }
  };

  app.server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (isOfficePath(url.pathname)) return proxyOfficeUpgrade(cfg, req, socket, head, clientIp(req, cfg.trustProxy));
    if (url.pathname !== '/v1/ws') return socket.destroy();
    // The socket may fail while the token is checked.
    socket.on('error', () => socket.destroy());
    principalOf(req, socket)
      .then((r) => {
        if (r) open(req, socket, head, r.p, r.token);
      })
      .catch(() => socket.destroy());
  });

  const open = (req: IncomingMessage, socket: Duplex, head: Buffer, u: Principal, token: string) => {
    if (socket.destroyed) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      const s: Sub = { ws, userId: u.userId, tokenId: u.tokenId, cursor: 0, subscribed: false, readableKey: '' };
      subs.add(s);
      if (u.tokenId) {
        // A revocation between the token check and subs.add fired before this socket could match it,
        // so check the token once more now that the socket is registered (a later revocation reaches onRevoked).
        // The same credential it authenticated with: the bearer token, or the session cookie's token
        // (an empty one, which cannot happen for a socket that has a token id, fails and closes).
        auth.authenticateToken(token).then(
          (r) => {
            if (isAuthFailure(r)) ws.close(WS_TOKEN_REVOKED, 'TOKEN_REVOKED');
          },
          () => ws.terminate(),
        );
      }
      const alive = setInterval(() => ws.readyState === ws.OPEN && ws.ping(), 15_000);
      ws.on('close', () => {
        clearInterval(alive);
        subs.delete(s);
      });
      ws.on('error', () => ws.terminate());
      ws.on('message', (raw) => {
        let m: ClientMessage;
        try {
          m = JSON.parse(String(raw)) as ClientMessage;
        } catch {
          return send(ws, { type: 'error', code: 'BAD_MESSAGE' });
        }
        if (m.type !== 'subscribe' || !Number.isInteger(m.after)) return send(ws, { type: 'error', code: 'BAD_MESSAGE' });
        const check = service.eventsFor(u.userId, m.after, 0, m.epoch === undefined ? undefined : m.epoch);
        if (check.reset) {
          s.subscribed = false;
          return send(ws, { type: 'reset', reason: 'cursor_mismatch' });
        }
        s.cursor = m.after;
        s.readableKey = service.readableKey(u.userId);
        s.subscribed = true;
        pump(s);
        send(ws, { type: 'synced', cursor: s.cursor, head: service.head, epoch: service.epoch });
      });
      send(ws, { type: 'hello', head: service.head, epoch: service.epoch, userId: u.userId });
      if (build) send(ws, { type: 'build', hash: build });
    });
  };
  // preClose: upgraded sockets would otherwise keep server.close() waiting.
  app.addHook('preClose', async () => {
    clearInterval(buildTimer);
    offRevoked();
    for (const s of subs) s.ws.terminate();
    wss.close();
  });
}
