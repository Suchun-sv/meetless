import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type OutgoingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Duplex } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ServerConfig } from '../server';
import { rawRequestTarget } from './cookies';

/** The path DocumentServer is reverse-proxied under (design 2026-11-25 §5). */
export const OFFICE_PROXY_PREFIX = '/office';

/** Whether a request path (no query) belongs to the proxy. */
export function isOfficePath(pathname: string): boolean {
  return pathname === OFFICE_PROXY_PREFIX || pathname.startsWith(`${OFFICE_PROXY_PREFIX}/`);
}

/** Hop-by-hop headers (RFC 9110 §7.6.1) plus the ones the proxy sets itself or must never forward. */
const DROP_REQUEST = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  // The browser's Meetless credentials never reach DocumentServer.
  'cookie',
  'authorization',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-for',
  'x-forwarded-prefix',
  'forwarded',
]);
const DROP_RESPONSE = new Set(['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'set-cookie']);

function filtered(headers: IncomingHttpHeaders, drop: Set<string>): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(headers)) if (v !== undefined && !drop.has(k.toLowerCase())) out[k] = v;
  return out;
}

/** The upstream target for a proxied path: `/office/x?y` -> `<onlyoffice.url path>/x?y`, or null when the path is not ours. */
function upstreamOf(base: string, rawUrl: string): { url: URL; path: string } | null {
  const q = rawUrl.indexOf('?');
  const pathname = q === -1 ? rawUrl : rawUrl.slice(0, q);
  if (!isOfficePath(pathname)) return null;
  const rest = pathname.slice(OFFICE_PROXY_PREFIX.length) || '/';
  const url = new URL(base);
  const basePath = url.pathname.replace(/\/+$/, '');
  return { url, path: `${basePath}${rest}${q === -1 ? '' : rawUrl.slice(q)}` };
}

function forwardHeaders(headers: IncomingHttpHeaders, target: { protocol: string; host: string }, ip: string): OutgoingHttpHeaders {
  return {
    ...filtered(headers, DROP_REQUEST),
    // DocumentServer's documented way to run under a virtual path: X-Forwarded-Host carries it.
    'x-forwarded-host': `${target.host}${OFFICE_PROXY_PREFIX}`,
    'x-forwarded-proto': target.protocol,
    ...(ip ? { 'x-forwarded-for': ip } : {}),
  };
}

function send502(reply: { headersSent?: boolean; writeHead: (s: number, h: OutgoingHttpHeaders) => unknown; end: (b?: string) => unknown }): void {
  if (reply.headersSent) {
    reply.end();
    return;
  }
  reply.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  reply.end(JSON.stringify({ error: { code: 'BAD_GATEWAY' } }));
}

function proxyHttp(cfg: Pick<ServerConfig, 'onlyoffice'>, req: FastifyRequest, reply: FastifyReply): void {
  const base = cfg.onlyoffice.url!;
  const up = upstreamOf(base, req.raw.url ?? '/')!;
  const res = reply.raw;
  const send = up.url.protocol === 'https:' ? httpsRequest : httpRequest;
  const out = send(
    {
      protocol: up.url.protocol,
      hostname: up.url.hostname,
      port: up.url.port || undefined,
      method: req.method,
      path: up.path,
      headers: { ...forwardHeaders(req.headers, { protocol: req.protocol, host: req.host }, req.ip), host: up.url.host },
    },
    (upRes: IncomingMessage) => {
      // Raw headers straight through (no Fastify reply, so none of the app's CSP or cookies), minus set-cookie.
      res.writeHead(upRes.statusCode ?? 502, upRes.statusMessage, filtered(upRes.headers, DROP_RESPONSE));
      upRes.pipe(res);
      upRes.on('error', () => res.destroy());
    },
  );
  out.on('error', () => send502(res));
  res.on('close', () => {
    if (!res.writableFinished) out.destroy();
  });
  req.raw.pipe(out);
}

/**
 * Reverse-proxies `/office/*` (HTTP) to `cfg.onlyoffice.url` (design 2026-11-25 §5): the prefix
 * is stripped, the browser's `Cookie` and `Authorization` are dropped, `X-Forwarded-Host` is
 * `<host>/office` and `X-Forwarded-Proto` the request's protocol (both proxy aware). Bodies stream
 * both ways untouched (an `onRequest` hook hijacks the reply before any body parser runs). With
 * OnlyOffice off it answers 404; with DocumentServer down, 502 `BAD_GATEWAY`. Websocket upgrades
 * under `/office/` go through `proxyOfficeUpgrade`, which `http.ts` calls from its upgrade handler.
 */
export function registerOfficeProxy(app: FastifyInstance, cfg: Pick<ServerConfig, 'onlyoffice'>): void {
  // Callback style: once the reply is sent or hijacked, `done` is never called, so no body parser or handler runs.
  const onRequest = (req: FastifyRequest, reply: FastifyReply, _done: () => void): void => {
    if (!cfg.onlyoffice.url) {
      void reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      return;
    }
    reply.hijack();
    proxyHttp(cfg, req, reply);
  };
  const handler = async () => undefined;
  for (const url of [OFFICE_PROXY_PREFIX, `${OFFICE_PROXY_PREFIX}/*`]) {
    app.route({ method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], url, onRequest, handler });
  }
}

/**
 * A websocket upgrade under `/office/`, passed through to DocumentServer byte for byte after the
 * same header rewrite as `registerOfficeProxy`. Answers 404 with OnlyOffice off and 502 when
 * DocumentServer cannot be reached.
 */
export function proxyOfficeUpgrade(cfg: Pick<ServerConfig, 'onlyoffice' | 'trustProxy'>, req: IncomingMessage, socket: Duplex, head: Buffer, ip: string): void {
  socket.on('error', () => socket.destroy());
  const base = cfg.onlyoffice.url;
  const refuse = (status: string) => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };
  if (!base) return refuse('404 Not Found');
  const up = upstreamOf(base, req.url ?? '/');
  if (!up) return refuse('404 Not Found');
  const target = rawRequestTarget(req, cfg.trustProxy);
  const send = up.url.protocol === 'https:' ? httpsRequest : httpRequest;
  const out = send({
    protocol: up.url.protocol,
    hostname: up.url.hostname,
    port: up.url.port || undefined,
    method: req.method,
    path: up.path,
    headers: {
      ...forwardHeaders(req.headers, target, ip),
      host: up.url.host,
      connection: 'Upgrade',
      upgrade: String(req.headers.upgrade ?? 'websocket'),
    },
  });
  out.on('upgrade', (upRes: IncomingMessage, upSocket: Duplex, upHead: Buffer) => {
    const lines = [`HTTP/1.1 ${upRes.statusCode ?? 101} ${upRes.statusMessage ?? 'Switching Protocols'}`];
    for (let i = 0; i < upRes.rawHeaders.length; i += 2) {
      if (upRes.rawHeaders[i]!.toLowerCase() === 'set-cookie') continue;
      lines.push(`${upRes.rawHeaders[i]}: ${upRes.rawHeaders[i + 1]}`);
    }
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (upHead.length) socket.write(upHead);
    if (head.length) upSocket.write(head);
    upSocket.on('error', () => socket.destroy());
    socket.on('close', () => upSocket.destroy());
    upSocket.on('close', () => socket.destroy());
    upSocket.pipe(socket);
    socket.pipe(upSocket);
  });
  out.on('response', (upRes: IncomingMessage) => {
    // DocumentServer refused the upgrade: hand its answer back and close.
    const lines = [`HTTP/1.1 ${upRes.statusCode ?? 502} ${upRes.statusMessage ?? ''}`, 'Connection: close'];
    for (let i = 0; i < upRes.rawHeaders.length; i += 2) {
      const k = upRes.rawHeaders[i]!.toLowerCase();
      if (DROP_RESPONSE.has(k)) continue;
      lines.push(`${upRes.rawHeaders[i]}: ${upRes.rawHeaders[i + 1]}`);
    }
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    upRes.pipe(socket);
  });
  out.on('error', () => {
    if (!socket.destroyed) refuse('502 Bad Gateway');
  });
  out.end();
}
