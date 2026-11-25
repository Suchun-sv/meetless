import { createHash, randomBytes } from 'node:crypto';
import type { Id } from '@meetless/core';

/** Crockford base32: digits and letters, with I/L/O/U dropped to avoid 1/1/0/0 confusion. */
export const INVITE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const GROUP_LENGTH = 4;
const CODE_LENGTH = GROUP_LENGTH * 3; // 12 characters, 60 bits at 5 bits/char

/** A fresh invite code: `XXXX-XXXX-XXXX`, 60 random bits over `INVITE_ALPHABET`. */
export function newInviteCode(): string {
  const raw = randomBytes(8); // 64 random bits; only the low 60 are used
  let bits = 0n;
  for (const b of raw) bits = (bits << 8n) | BigInt(b);
  bits &= (1n << BigInt(CODE_LENGTH * 5)) - 1n;
  let chars = '';
  for (let i = CODE_LENGTH - 1; i >= 0; i--) {
    chars += INVITE_ALPHABET[Number((bits >> BigInt(i * 5)) & 0x1fn)];
  }
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

const NORMALIZE_MAP: Record<string, string> = { O: '0', I: '1', L: '1' };

/**
 * Upper-cases, maps the common look-alikes (`O`->`0`, `I`/`L`->`1`), and drops
 * everything outside `INVITE_ALPHABET` (spaces, dashes, anything else). Returns
 * `''` unless exactly 12 valid characters remain, so a mistyped code never
 * silently matches a shorter prefix.
 */
export function normalizeInviteCode(s: string): string {
  let out = '';
  for (const ch of s.toUpperCase()) {
    const mapped = NORMALIZE_MAP[ch] ?? ch;
    if (INVITE_ALPHABET.includes(mapped)) out += mapped;
  }
  return out.length === CODE_LENGTH ? out : '';
}

const TOKEN_PREFIX = { personal: 'mlp_', agent: 'mla_' } as const;
export type TokenKind = keyof typeof TOKEN_PREFIX;

/** A fresh bearer token: its kind prefix + base64url of 32 random bytes (43 characters). */
export function newToken(kind: TokenKind): string {
  return TOKEN_PREFIX[kind] + randomBytes(32).toString('base64url');
}

/** The kind implied by a token's prefix, or null for anything else (including dev tokens). */
export function tokenKind(t: string): TokenKind | null {
  for (const kind of Object.keys(TOKEN_PREFIX) as TokenKind[]) {
    if (t.startsWith(TOKEN_PREFIX[kind])) return kind;
  }
  return null;
}

/** A stable, one-way digest for storing secrets (invite codes, tokens) without the plaintext. */
export function hashSecret(s: string): string {
  return `sha256:${createHash('sha256').update(s).digest('hex')}`;
}

const USER_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const USER_ID_LENGTH = 10;
// Largest multiple of the alphabet length that fits in a byte: bytes at or above this
// are rejected and redrawn, so every kept byte maps to a uniform index over the
// alphabet (plain `byte % 26` would favour the first 256 % 26 = 22 letters).
const USER_ID_REJECT_AT = 256 - (256 % USER_ID_ALPHABET.length);

/** A fresh user id: `u-` + 10 random lower-case letters, unbiased via rejection sampling. */
export function newUserId(): Id {
  let out = '';
  while (out.length < USER_ID_LENGTH) {
    for (const b of randomBytes(USER_ID_LENGTH - out.length)) {
      if (b >= USER_ID_REJECT_AT) continue;
      out += USER_ID_ALPHABET[b % USER_ID_ALPHABET.length];
      if (out.length === USER_ID_LENGTH) break;
    }
  }
  return `u-${out}`;
}
