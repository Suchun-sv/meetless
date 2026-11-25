import { createHmac, timingSafeEqual } from 'node:crypto';

const HEADER_PART = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

/** HMAC-SHA256 over `base64url(header).base64url(payload)`, as DocumentServer expects for its `token` field. */
function signingInput(payloadPart: string): string {
  return `${HEADER_PART}.${payloadPart}`;
}

/** A standard compact HS256 JWT: `base64url(header).base64url(payload).base64url(signature)`. */
export function signHs256(payload: object, secret: string): string {
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(signingInput(payloadPart)).digest('base64url');
  return `${signingInput(payloadPart)}.${sig}`;
}

/**
 * Verifies a compact HS256 JWT against `secret` with `timingSafeEqual`, and returns the
 * decoded payload; `null` on any structural problem, a length mismatch or a bad signature
 * (never throws). A test helper (matches what `OfficeTickets.issue`'s caller, `OfficeViewer`,
 * signs with `signHs256`), not used by the files socket itself (that one uses `OfficeTickets`).
 */
export function verifyHs256(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, sigPart] = parts as [string, string, string];
  // Compare the encoded signature strings (after a length check), not the decoded bytes:
  // `Buffer.from(_, 'base64url')` decodes leniently, so a byte-level compare could accept a
  // sigPart that is not identical to the one actually signed. See `OfficeTickets.verify` for
  // the same reasoning.
  const expectedSigPart = createHmac('sha256', secret).update(`${headerPart}.${payloadPart}`).digest('base64url');
  const got = Buffer.from(sigPart, 'utf8');
  const expected = Buffer.from(expectedSigPart, 'utf8');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}
