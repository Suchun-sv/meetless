import type { Id } from '@meetless/core';

/**
 * The web session (design 2026-11-25 §3). Renderer-safe: constants and types only.
 *
 * `ml_session` holds the session's personal token (HttpOnly, never readable by script);
 * `ml_csrf` holds a random value script reads and echoes in `x-meetless-csrf` on every
 * cookie-authenticated POST, PUT, PATCH or DELETE (double submit).
 */
export const WEB_SESSION_COOKIE = 'ml_session';
export const WEB_CSRF_COOKIE = 'ml_csrf';
export const WEB_CSRF_HEADER = 'x-meetless-csrf';
/** `POST` signs in (sets both cookies), `DELETE` signs out (revokes the session's token, clears both). */
export const WEB_SESSION_PATH = '/v1/web/session';
/** `<meta name="meetless-host" content="web">`: added only by the Meetless server's `/`, it selects the web bridge. */
export const WEB_HOST_META = 'meetless-host';

/** Sign in with a personal (or, while dev auth is on, dev) token, or by redeeming an invite. */
export type WebSessionReq = { token: string } | { code: string; displayName: string; locale: string };

/** The sign-in answer: the user only. The session token travels in the HttpOnly cookie, never in a body. */
export interface WebSessionRes {
  user: { id: Id; displayName: string; locale: string };
}
