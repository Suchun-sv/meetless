/** Every non-2xx response from the Meetless API uses this body shape. */
export interface ApiErrorBody {
  error: { code: string; details?: unknown };
}

export const API_ERROR_CODES = [
  'UNAUTHENTICATED',
  'INVITE_INVALID',
  'INVITE_USED',
  'TOKEN_REVOKED',
  'NOT_IMPLEMENTED',
  'NOT_AVAILABLE',
  'EXTRACT_FAILED',
  'TOO_LARGE',
  'RATE_LIMITED',
  /** A cookie-authenticated write without the matching `x-meetless-csrf` or from a foreign Origin (web sessions, 403). */
  'CSRF_FAILED',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Identifies the calling client; sent on MCP and dev-client calls. */
export const CLIENT_HEADER = 'x-meetless-client';
