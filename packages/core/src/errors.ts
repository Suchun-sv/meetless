/**
 * Domain errors.
 *
 * Policy (docs/ARCHITECTURE.md, "Invariant enforcement"):
 * - A command that would break an invariant is REJECTED: `applyEvent` throws a
 *   `DomainError` and returns no new state. The sync service applies every
 *   command to its projection before appending, so an accepted log never
 *   contains an invalid event and replaying an accepted log never throws.
 * - Legitimate changes that make earlier work out of date are MARKED, never
 *   deleted: a handoff whose context was fetched at an older version is
 *   "stale"; a refuted hypothesis stays visible as "don't retry".
 *
 * Codes are stable; user-facing text lives in @meetless/i18n as `error.<code>`.
 */

export const DOMAIN_ERROR_CODES = [
  'UNKNOWN_EVENT_TYPE',
  'SEQ_NOT_MONOTONIC',
  'INVALID_EVENT',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'NOT_A_MEMBER',
  'NOT_AUTHORISED',
  'INVALID_STATE_TRANSITION',
  'INVALID_STATUS',
  'ALREADY_DECIDED',
  'PRIVATE_ITEM',
  'PRIVATE_SOURCE',
  'CONFLICT_OPEN',
  'REASON_REQUIRED',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: DomainErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(`${code}: ${message}`);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function isDomainError(e: unknown, code?: DomainErrorCode): e is DomainError {
  return e instanceof DomainError && (code === undefined || e.code === code);
}
