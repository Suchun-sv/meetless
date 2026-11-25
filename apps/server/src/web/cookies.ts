import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { TLSSocket } from 'node:tls';
import { WEB_CSRF_COOKIE, WEB_CSRF_HEADER, WEB_SESSION_COOKIE } from '@meetless/api';
import { ApiError } from '../api/frame';
import type { ServerConfig } from '../server';

/** 30 days, for both cookies (design 2026-11-25 §3). */
export const WEB_SESSION_MAX_AGE = 30 * 24 * 60 * 60;

/** Attributes every web cookie carries. `Secure` always, even on a plain-http dev server: the cookie is meant for https. */
const COMMON = 'Path=/; Secure; SameSite=Lax';

/** `ml_session`: the session's personal token, never readable by script. */
export function sessionCookie(token: string): string {
  return `${WEB_SESSION_COOKIE}=${token}; Max-Age=${WEB_SESSION_MAX_AGE}; ${COMMON}; HttpOnly`;
}

/** `ml_csrf`: the double-submit value, readable by script (no HttpOnly). */
export function csrfCookie(value: string): string {
  return `${WEB_CSRF_COOKIE}=${value}; Max-Age=${WEB_SESSION_MAX_AGE}; ${COMMON}`;
}

/** The two `Set-Cookie` lines that drop both cookies (same attributes, empty value, `Max-Age=0`). */
export function clearedCookies(): string[] {
  return [`${WEB_SESSION_COOKIE}=; Max-Age=0; ${COMMON}; HttpOnly`, `${WEB_CSRF_COOKIE}=; Max-Age=0; ${COMMON}`];
}

/** A fresh CSRF value: 32 random bytes, base64url (43 characters). */
export function newCsrfValue(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * A `Cookie` request header as `name -> value`. Pairs without `=` or with an empty name are
 * skipped; the first occurrence of a name wins (the most specific path comes first, RFC 6265
 * §5.4); values are taken as sent (the web cookies only ever hold base64url-safe characters).
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out[name] = value;
  }
  return out;
}

/** The serialized origin of a URL (scheme, lower-cased host, default port dropped), or null when it does not parse. */
function originOf(url: string): string | null {
  try {
    const o = new URL(url).origin;
    return o === 'null' ? null : o;
  } catch {
    return null;
  }
}

/**
 * The origins a browser page may call a cookie-authenticated route from: the request's own
 * `protocol://host` (proxy aware: Fastify's `request.protocol` and `request.host` follow
 * `MEETLESS_TRUST_PROXY`, and `rawRequestTarget` gives the websocket upgrade the same rule),
 * plus the origin of `MEETLESS_AGENT_URL` when set (the public URL, when a proxy rewrites Host).
 */
export function allowedOrigins(cfg: Pick<ServerConfig, 'agentUrl'>, req: { protocol: string; host: string }): Set<string> {
  const out = new Set<string>();
  if (req.protocol && req.host) {
    const own = originOf(`${req.protocol}://${req.host}`);
    if (own) out.add(own);
  }
  if (cfg.agentUrl) {
    const agent = originOf(cfg.agentUrl);
    if (agent) out.add(agent);
  }
  return out;
}

function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Whether the request's `Origin` is one of `allowedOrigins`. A missing Origin is false here; callers decide what absence means. */
export function originAllowed(cfg: Pick<ServerConfig, 'agentUrl'>, req: { headers: IncomingHttpHeaders; protocol: string; host: string }): boolean {
  const raw = firstHeader(req.headers.origin);
  if (raw === undefined) return false;
  const origin = originOf(raw);
  return origin !== null && allowedOrigins(cfg, req).has(origin);
}

/** GET, HEAD and OPTIONS change nothing; every other method (an absent one included) is checked. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The CSRF rule for a cookie-authenticated request (design 2026-11-25 §3). A write (anything
 * but GET, HEAD, OPTIONS) must carry `x-meetless-csrf` equal to the `ml_csrf` cookie (double
 * submit, compared in constant time; both non-empty) and, when an `Origin` header is present,
 * an allowed one. Throws `ApiError('CSRF_FAILED')` (403). Bearer requests never come here.
 */
export function checkCsrf(req: { method: string; headers: IncomingHttpHeaders; protocol: string; host: string }, cfg: Pick<ServerConfig, 'agentUrl'>): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return;
  const cookie = parseCookies(req.headers.cookie)[WEB_CSRF_COOKIE] ?? '';
  const header = firstHeader(req.headers[WEB_CSRF_HEADER]) ?? '';
  if (!cookie || !header || !sameSecret(cookie, header)) throw new ApiError('CSRF_FAILED');
  if (req.headers.origin !== undefined && !originAllowed(cfg, req)) throw new ApiError('CSRF_FAILED');
}

/** The last entry of a comma-separated header value, as Fastify reads X-Forwarded-Proto and X-Forwarded-Host. */
function lastEntry(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v.join(',') : v;
  if (!s) return undefined;
  const i = s.lastIndexOf(',');
  return (i === -1 ? s : s.slice(i + 1)).trim();
}

/**
 * `protocol` and `host` of a raw Node request (the websocket upgrade has no Fastify request),
 * by the rule Fastify applies with `fastifyTrustProxy(hops)`: X-Forwarded-Proto and
 * X-Forwarded-Host (their last entry) only when `hops > 0`, else the socket's own TLS state and
 * the Host header. The same hop rule `clientIp` follows for the address.
 */
export function rawRequestTarget(req: Pick<IncomingMessage, 'headers' | 'socket'>, hops: number): { protocol: string; host: string } {
  const fwdProto = hops > 0 ? lastEntry(req.headers['x-forwarded-proto']) : undefined;
  const fwdHost = hops > 0 ? lastEntry(req.headers['x-forwarded-host']) : undefined;
  const protocol = fwdProto || ((req.socket as TLSSocket).encrypted ? 'https' : 'http');
  const host = fwdHost || req.headers.host || '';
  return { protocol, host };
}
