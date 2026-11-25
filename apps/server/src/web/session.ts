import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { WEB_SESSION_COOKIE, WEB_SESSION_PATH, type UserInfo, type WebSessionRes } from '@meetless/api';
import { InviteService } from '../accounts/invites';
import { hashSecret, newToken, tokenKind } from '../accounts/secrets';
import { isAuthFailure } from '../auth';
import { ApiError, errorResponse, signInFailure, type ApiDeps } from '../api/frame';
import { checkCsrf, clearedCookies, csrfCookie, newCsrfValue, originAllowed, parseCookies, sessionCookie } from './cookies';

/** The label of the personal token a token sign-in mints for the web session. */
export const WEB_TOKEN_LABEL = 'web';

/** The answer of a sign-out (`DELETE`), whether or not there was a session to end. */
export interface WebSignOutRes {
  signedOut: true;
}

function bodyOf(http: FastifyRequest): Record<string, unknown> {
  const b = http.body;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new ApiError('BAD_REQUEST');
  return b as Record<string, unknown>;
}

/**
 * `{ token }` sign-in: the pasted token must be a valid personal token, or a dev token while
 * dev auth is on (`Authenticator` knows no dev token otherwise). A bad or revoked one counts
 * on the sign-in limiter exactly as a bad bearer token does; an agent token is refused
 * NOT_AUTHORISED, uncounted (it is valid, just not a user's). The session gets a token of its
 * own (`WEB_TOKEN_LABEL`), so signing out of the web never revokes the pasted one.
 */
async function signInWithToken(deps: ApiDeps, pasted: string, ip: string): Promise<{ token: string; user: UserInfo }> {
  const r = await deps.auth.authenticateToken(pasted);
  if (isAuthFailure(r)) throw signInFailure(deps.rateLimits.signIn, ip, r.error);
  if (r.kind === 'agent') throw new ApiError('NOT_AUTHORISED');
  const users = deps.service.current.users;
  const u = Object.prototype.hasOwnProperty.call(users, r.userId) ? users[r.userId]! : null;
  // A token whose user was never registered cannot act as anyone (as `me` answers).
  if (!u) throw new ApiError('UNAUTHENTICATED');
  const token = newToken('personal');
  await deps.accounts.createToken({
    id: `t-${randomUUID()}`,
    kind: 'personal',
    userId: u.id,
    label: WEB_TOKEN_LABEL,
    tokenHash: hashSecret(token),
    createdAt: deps.cfg.now().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  });
  return { token, user: { id: u.id, displayName: u.displayName, locale: u.locale } };
}

const noStore = (reply: FastifyReply): FastifyReply => reply.header('cache-control', 'no-store');

/**
 * The web session routes (design 2026-11-25 §3), plain Fastify routes outside `API_ROUTES`
 * (no API contract or MCP tool changes):
 *
 * - `POST /v1/web/session` signs in, by `{ token }` (`signInWithToken`) or by an invite
 *   `{ code, displayName, locale }` (`InviteService.redeem`: the same rules and redeem rate
 *   limit as `invites.redeem`; the session is the personal token the redemption creates). It
 *   sets `ml_session` (the token, HttpOnly) and `ml_csrf` (a fresh random value) and answers
 *   `{ user }`: the token is never in a body.
 * - `DELETE /v1/web/session` signs out: when the `ml_session` cookie still holds a valid
 *   session, the write passes `checkCsrf` (otherwise 403 CSRF_FAILED and the session stays),
 *   then the token row is revoked and its websockets close with 4401. Either way, valid,
 *   revoked, unknown or no cookie at all, it clears both cookies and answers 200
 *   `{ signedOut: true }`. It is not rate-limited: its answer is the same for every cookie, so
 *   it tells a guesser nothing.
 *
 * Both answers are `Cache-Control: no-store`.
 */
export function registerWebSession(app: FastifyInstance, deps: ApiDeps): void {
  const errorHandler = async (err: unknown, http: FastifyRequest, reply: FastifyReply) => {
    const out = errorResponse(err);
    if (out.status >= 500) http.log.error(err);
    for (const [k, v] of Object.entries(out.headers ?? {})) reply.header(k, v);
    return noStore(reply).code(out.status).send(out.body);
  };

  app.route({
    method: 'POST',
    url: WEB_SESSION_PATH,
    errorHandler,
    handler: async (http, reply) => {
      // Login CSRF: there is no session (and so no CSRF cookie) yet, so only Origin is checked.
      // A present Origin must be allowed. An absent one is allowed on this route only: browsers
      // always send Origin on a POST, so a request without one is a non-browser client (a
      // script, a test, the desktop app) with no ambient credential a forged page could abuse,
      // and whatever it signs in sets a cookie in nobody's browser but its own.
      if (http.headers.origin !== undefined && !originAllowed(deps.cfg, http)) throw new ApiError('CSRF_FAILED');
      const body = bodyOf(http);
      let signedIn: { token: string; user: UserInfo };
      if ('code' in body) {
        const r = await new InviteService(deps).redeem(body as { code: string; displayName: string; locale: string }, http.ip);
        signedIn = { token: r.token, user: r.user };
      } else if (typeof body.token === 'string' && body.token !== '') {
        signedIn = await signInWithToken(deps, body.token, http.ip);
      } else {
        throw new ApiError('BAD_REQUEST');
      }
      const res: WebSessionRes = { user: { id: signedIn.user.id, displayName: signedIn.user.displayName, locale: signedIn.user.locale } };
      return noStore(reply)
        .header('set-cookie', [sessionCookie(signedIn.token), csrfCookie(newCsrfValue())])
        .code(200)
        .send(res);
    },
  });

  app.route({
    method: 'DELETE',
    url: WEB_SESSION_PATH,
    errorHandler,
    handler: async (http, reply) => {
      const token = parseCookies(http.headers.cookie)[WEB_SESSION_COOKIE];
      if (token !== undefined && tokenKind(token) === 'personal') {
        const r = await deps.auth.authenticateToken(token);
        if (!isAuthFailure(r) && r.tokenId) {
          checkCsrf(http, deps.cfg);
          if (await deps.accounts.revokeToken(r.tokenId, r.userId, deps.cfg.now().toISOString())) deps.auth.revoked(r.tokenId);
        }
      }
      const res: WebSignOutRes = { signedOut: true };
      return noStore(reply).header('set-cookie', clearedCookies()).code(200).send(res);
    },
  });
}
