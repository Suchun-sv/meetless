import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isDomainError, noDots, type Id } from '@meetless/core';
import {
  API_ROUTES,
  CLIENT_HEADER,
  MCP_TOOL_ROUTE,
  type ApiErrorBody,
  type ApiName,
  type ApiRequest,
  type ApiResponse,
  type McpToolName,
  type RouteDef,
} from '@meetless/api';
import { bearerToken, isAuthFailure, type Authenticator, type Principal } from '../auth';
import type { OfficeViewer } from '../office/onlyoffice';
import type { RateLimiter } from './ratelimit';
import type { ServerConfig } from '../server';
import type { SyncService } from '../service';
import type { AccountStore } from '../store/types';
import { reqString } from './fields';

/** A failure a handler reports to the caller: `{ error: { code, details? } }` with the status from `API_STATUS`. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

/** HTTP status per error code. Any other `ApiError` or `DomainError` code maps to 422. */
export const API_STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  TOKEN_REVOKED: 401,
  NOT_AUTHORISED: 403,
  NOT_A_MEMBER: 403,
  NOT_FOUND: 404,
  INVITE_INVALID: 404,
  INVITE_USED: 409,
  ALREADY_EXISTS: 409,
  TOO_LARGE: 413,
  EXTRACT_FAILED: 422,
  RATE_LIMITED: 429,
  NOT_IMPLEMENTED: 501,
  NOT_AVAILABLE: 503,
};

/**
 * Status, body and headers for anything a route throws: `ApiError` and `DomainError` by code
 * (unlisted codes 422; details passed through), Fastify's own client errors (bad JSON,
 * wrong content type, body too large) as BAD_REQUEST or TOO_LARGE, and anything else as
 * 500 INTERNAL with no message, so internals never reach the caller. `RATE_LIMITED`
 * (contract §12.8) also carries a `Retry-After` header alongside `details.retryAfter`.
 */
export function errorResponse(err: unknown): { status: number; body: ApiErrorBody; headers?: Record<string, string> } {
  if (err instanceof ApiError || isDomainError(err)) {
    const { code, details } = err;
    const body: ApiErrorBody = { error: details === undefined ? { code } : { code, details } };
    const headers =
      code === 'RATE_LIMITED' && typeof (details as { retryAfter?: unknown } | undefined)?.retryAfter === 'number'
        ? { 'Retry-After': String((details as { retryAfter: number }).retryAfter) }
        : undefined;
    return { status: API_STATUS[code] ?? 422, body, headers };
  }
  const status = (err as { statusCode?: unknown } | null)?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const code = status === 413 ? 'TOO_LARGE' : 'BAD_REQUEST';
    return { status: API_STATUS[code]!, body: { error: { code } } };
  }
  return { status: 500, body: { error: { code: 'INTERNAL' } } };
}

/**
 * The one place a request's bearer token is checked and an authentication failure is
 * produced. Every authenticated surface calls it: `defineRoute`, the /v1 routes and the
 * websocket upgrade in http.ts, and `/mcp`. Throws `ApiError` UNAUTHENTICATED or
 * TOKEN_REVOKED, or RATE_LIMITED (contract §12.8) once `limiter` is over the limit for
 * `req.ip` (Fastify's `request.ip`, proxy-aware by the `trustProxy` hop count). A valid token always
 * passes, uncounted. A request with no token at all does not count either (nothing to
 * guess), and fails plainly even past the limit; `limiter` is omitted on surfaces (none
 * today) that do not rate-limit sign-in.
 */
export async function authenticateRequest(
  auth: Authenticator,
  req: { headers: IncomingHttpHeaders; ip: string },
  limiter?: RateLimiter,
): Promise<Principal> {
  const r = await auth.authenticate(req.headers.authorization);
  if (!isAuthFailure(r)) return r;
  if (limiter && bearerToken(req.headers.authorization) !== null) {
    const hit = limiter.hit(req.ip);
    if (!hit.ok) throw new ApiError('RATE_LIMITED', { retryAfter: hit.retryAfterSec });
  }
  throw new ApiError(r.error);
}

/** Personal and dev tokens act as the user; an agent token is refused (NOT_AUTHORISED) outside `auth: 'agent'` routes and `/mcp`. */
export function requireUserPrincipal(p: Principal): Principal {
  if (p.kind === 'agent') throw new ApiError('NOT_AUTHORISED');
  return p;
}

export interface ApiDeps {
  service: SyncService;
  accounts: AccountStore;
  auth: Authenticator;
  cfg: ServerConfig;
  /** Failed-attempt limiters (contract §12.8), shared across every request: `http.ts` builds them once from `cfg.rateLimits`. */
  rateLimits: { signIn: RateLimiter; redeem: RateLimiter };
  /**
   * `office.config`'s view builder (Task 8), shared across every request: `buildApp` builds
   * one per server, sharing its `OfficeTickets` with the files socket so a ticket issued
   * through this viewer is one the socket can verify. Optional only so a hand-built `ApiDeps`
   * (a unit test of the frame itself) need not supply one.
   */
  officeViewer?: OfficeViewer;
  /**
   * The skill markdown (`skills/meetless/SKILL.md`, or `MEETLESS_SKILL_PATH`), read once at
   * startup by `buildApp` (contract §12.1, §12.10): `agent.guide` builds its answer from it,
   * and `registerMcp` passes its body (front matter stripped) as the MCP server's
   * `instructions`. Required (fix round 1, review): every real `ApiDeps` is built by
   * `buildApp`, which always wires it (a missing or empty-bodied skill file fails `buildApp`
   * outright, before any route is even registered), so a hand-built `ApiDeps` must supply one
   * too, rather than letting `agent.guide`/`/mcp` silently fall back to an empty guide.
   */
  skillMarkdown: string;
}

type AuthOf<K extends ApiName> = (typeof API_ROUTES)[K]['auth'];

export interface RouteCtx<K extends ApiName> {
  /** The caller. Null on `auth: 'none'` routes, which never read a token. */
  p: AuthOf<K> extends 'none' ? null : Principal;
  /** Path params (decoded) plus the query (GET, DELETE) or the JSON body (POST); a path param always wins. */
  req: ApiRequest<K>;
  http: FastifyRequest;
  deps: ApiDeps;
}

export type Handler<K extends ApiName> = (ctx: RouteCtx<K>) => Promise<ApiResponse<K>>;

/** Query keys that arrive as numbers when they are plain digits. */
export const NUMERIC_QUERY: ReadonlySet<string> = new Set(['limit', 'round']);

const MAX_CLIENT_LENGTH = 64;

/** The calling client's self-reported name (`CLIENT_HEADER`), cleaned of dot symbols and clipped; null when absent. */
export function clientHeader(http: FastifyRequest): string | null {
  const raw = http.headers[CLIENT_HEADER];
  const v = noDots(Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')).trim().slice(0, MAX_CLIENT_LENGTH);
  return v || null;
}

/** The client name to show for a call: the client header, else the token label, else `unknown`. */
export function clientOf(p: Principal, http: FastifyRequest): string {
  return clientHeader(http) ?? p.label ?? 'unknown';
}

/** The MCP tool whose calls go to each route (the reverse of `MCP_TOOL_ROUTE`). */
const ROUTE_TOOL: ReadonlyMap<ApiName, McpToolName> = new Map(
  (Object.entries(MCP_TOOL_ROUTE) as [McpToolName, ApiName][]).map(([tool, route]) => [route, tool]),
);

function requestOf(route: RouteDef, http: FastifyRequest): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  if (route.method === 'POST') {
    const body = http.body;
    if (body !== undefined && body !== null) {
      if (typeof body !== 'object' || Array.isArray(body)) throw new ApiError('BAD_REQUEST');
      Object.assign(rest, body);
    }
  } else {
    for (const [k, v] of Object.entries((http.query ?? {}) as Record<string, unknown>)) {
      // A repeated key arrives as an array; no route takes one.
      if (typeof v !== 'string' || k === '__proto__') throw new ApiError('BAD_REQUEST');
      const n = NUMERIC_QUERY.has(k) && /^\d+$/.test(v) ? Number(v) : NaN;
      rest[k] = Number.isSafeInteger(n) ? n : v;
    }
  }
  // Fastify has already decoded the path params; each one the route names must be there as a string.
  const params = (http.params ?? {}) as Record<string, unknown>;
  for (const name of pathParams(route.path)) reqString(params[name], name);
  return { ...rest, ...params };
}

/** The `:name` params of a route path, in order. */
function pathParams(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]!);
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

interface CallState {
  p: Principal | null;
  req: Record<string, unknown> | null;
}

/**
 * Serves `API_ROUTES[name]` with `handler`:
 * - auth: `none` reads no token; `user` takes personal and dev tokens (agent: NOT_AUTHORISED);
 *   `agent` takes any principal. Authentication runs first, before the body is parsed.
 * - `req` is the path params plus the query or JSON body (see `RouteCtx.req`, `NUMERIC_QUERY`).
 * - Success answers 200 with the handler's result; every failure answers `{ error: { code } }`
 *   (`errorResponse`).
 * - A call with an agent token on a route an MCP tool targets is logged (`recordCall`) on
 *   success and on failure, with the tool, client, project, need code, ok and error code.
 */
export function defineRoute<K extends ApiName>(app: FastifyInstance, deps: ApiDeps, name: K, handler: Handler<K>): void {
  const route: RouteDef = API_ROUTES[name];
  const tool = ROUTE_TOOL.get(name) ?? null;
  const calls = new WeakMap<FastifyRequest, CallState>();

  const record = async (http: FastifyRequest, st: CallState | undefined, code: string | null): Promise<void> => {
    const p = st?.p;
    if (!tool || !p || p.kind !== 'agent' || !p.tokenId) return;
    const req = st.req ?? ((http.params ?? {}) as Record<string, unknown>);
    try {
      await deps.accounts.recordCall({
        id: randomUUID() as Id,
        at: deps.cfg.now().toISOString(),
        userId: p.userId,
        tokenId: p.tokenId,
        client: clientHeader(http) ?? p.label,
        tool,
        projectId: str(req.projectId),
        needCode: str(req.code),
        ok: code === null,
        code,
      });
    } catch (e) {
      // The call itself has been answered; a failed log write must not change that answer.
      http.log.error(e);
    }
  };

  app.route({
    method: route.method,
    url: route.path,
    onRequest: async (http) => {
      const st: CallState = { p: null, req: null };
      calls.set(http, st);
      if (route.auth === 'none') return;
      st.p = await authenticateRequest(deps.auth, http, deps.rateLimits.signIn);
      if (route.auth === 'user') requireUserPrincipal(st.p);
    },
    handler: async (http) => {
      const st = calls.get(http)!;
      st.req = requestOf(route, http);
      const res = await handler({ p: st.p, req: st.req, http, deps } as RouteCtx<K>);
      await record(http, st, null);
      return res;
    },
    errorHandler: async (err, http, reply) => {
      const out = errorResponse(err);
      if (out.status >= 500) http.log.error(err);
      await record(http, calls.get(http), out.body.error.code);
      for (const [k, v] of Object.entries(out.headers ?? {})) reply.header(k, v);
      return reply.code(out.status).send(out.body);
    },
  });
}
