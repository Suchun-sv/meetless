import type { Id } from '@meetless/core';
import { hashSecret, tokenKind } from './accounts/secrets';
import type { AccountStore } from './store/types';

/**
 * DEV-ONLY authentication.
 *
 * Fixed bearer tokens per user, configured by MEETLESS_DEV_USERS (JSON) or the
 * defaults below. There is no password, no expiry and no identity provider.
 * Off unless MEETLESS_DEV_AUTH=1 (and refused with NODE_ENV=production); real
 * accounts use invite codes and personal or agent tokens (`Authenticator`).
 */
export interface DevUser {
  id: Id;
  displayName: string;
  locale: string;
  token: string;
}

export const DEFAULT_DEV_USERS: DevUser[] = [
  { id: 'u-alex', displayName: 'Alex', locale: 'zh-CN', token: 'dev-alex' },
  { id: 'u-lin', displayName: 'Lin An', locale: 'zh-CN', token: 'dev-lin' },
  { id: 'u-ben', displayName: 'Ben Carter', locale: 'en', token: 'dev-ben' },
  { id: 'u-zhou', displayName: 'Zhou Yu', locale: 'zh-CN', token: 'dev-zhou' },
  /** An outsider: member of no project. */
  { id: 'u-eve', displayName: 'Eve Outsider', locale: 'en', token: 'dev-eve' },
  { id: 'u-prof', displayName: 'Prof. Zhang', locale: 'zh-CN', token: 'dev-prof' },
  { id: 'u-mia', displayName: 'Mia', locale: 'en', token: 'dev-mia' },
  { id: 'u-ruo', displayName: 'Shen Ruo', locale: 'zh-CN', token: 'dev-ruo' },
];

export function parseDevUsers(json: string | undefined): DevUser[] {
  if (!json) return DEFAULT_DEV_USERS;
  const parsed = JSON.parse(json) as DevUser[];
  if (!Array.isArray(parsed) || parsed.some((u) => !u.id || !u.token || !u.displayName)) {
    throw new Error('MEETLESS_DEV_USERS must be a JSON array of {id, displayName, locale, token}');
  }
  return parsed.map((u) => ({ ...u, locale: u.locale || 'en' }));
}

export class DevAuth {
  private byToken = new Map<string, DevUser>();
  constructor(readonly users: DevUser[]) {
    for (const u of users) this.byToken.set(u.token, u);
  }

  /** `Authorization: Bearer <token>` -> user, or null. */
  authenticate(header: string | undefined): DevUser | null {
    const t = bearerToken(header);
    return t ? this.byTokenValue(t) : null;
  }

  /** A bare dev token -> user, or null. */
  byTokenValue(token: string): DevUser | null {
    return this.byToken.get(token) ?? null;
  }
}

/** The token of an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(header: string | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return m ? m[1]! : null;
}

/** Who is calling: the user, and the token they presented. */
export interface Principal {
  userId: Id;
  /** `dev`: a fixed dev token (only while dev auth is on). */
  kind: 'personal' | 'agent' | 'dev';
  /** The token row's id; null for a dev token. */
  tokenId: Id | null;
  /** The token row's label; null for a dev token. */
  label: string | null;
  /** A project-scoped agent token (a project's Claude Code session) reaches only this project. */
  projectId?: Id | null;
  /**
   * How the token arrived: an `Authorization: Bearer` header, or the web session cookie
   * (`ml_session`, design 2026-11-25 §3). Set by `authenticateRequest`, the only place that
   * knows; `Authenticator` itself only ever checks a token and answers a `TokenPrincipal`.
   */
  via: 'bearer' | 'cookie';
}

/** What a token alone says about its caller: a `Principal` before `authenticateRequest` adds how it arrived. */
export type TokenPrincipal = Omit<Principal, 'via'>;

export type AuthFailure = { error: 'UNAUTHENTICATED' | 'TOKEN_REVOKED' };

export const isAuthFailure = <T extends object>(r: T | AuthFailure): r is AuthFailure => 'error' in r;

/**
 * Checks bearer tokens: personal (`mlp_`) and agent (`mla_`) tokens against the
 * account store by hash, dev tokens against `dev` (null = dev auth off, so every
 * dev token is unknown). Which routes accept which kind is the caller's rule
 * (the API frame and http.ts), not this class's.
 */
export class Authenticator {
  private readonly revokedListeners = new Set<(tokenId: Id) => void>();

  constructor(
    private readonly accounts: AccountStore,
    private readonly dev: DevAuth | null,
    private readonly now: () => Date,
  ) {}

  /** The `Authorization: Bearer <token>` header's token (`authenticateToken`); no header or no bearer token is UNAUTHENTICATED. */
  async authenticate(header: string | undefined): Promise<TokenPrincipal | AuthFailure> {
    const token = bearerToken(header);
    if (!token) return { error: 'UNAUTHENTICATED' };
    return this.authenticateToken(token);
  }

  /**
   * One token, however it arrived (a bearer header, or the web session cookie whose caller
   * already restricts it to personal tokens): personal and agent tokens by hash, dev tokens
   * against `dev`.
   */
  async authenticateToken(token: string): Promise<TokenPrincipal | AuthFailure> {
    if (!token) return { error: 'UNAUTHENTICATED' };
    const kind = tokenKind(token);
    if (kind) {
      const row = await this.accounts.tokenByHash(hashSecret(token));
      if (!row || row.kind !== kind) return { error: 'UNAUTHENTICATED' };
      if (row.revokedAt) return { error: 'TOKEN_REVOKED' };
      await this.accounts.touchToken(row.id, this.now().toISOString());
      return { userId: row.userId, kind: row.kind, tokenId: row.id, label: row.label, projectId: row.projectId ?? null };
    }
    const u = this.dev?.byTokenValue(token) ?? null;
    return u ? { userId: u.id, kind: 'dev', tokenId: null, label: null } : { error: 'UNAUTHENTICATED' };
  }

  /** Called with a token's id when it is revoked (open websockets close with 4401). Returns an unsubscribe. */
  onRevoked(cb: (tokenId: Id) => void): () => void {
    this.revokedListeners.add(cb);
    return () => {
      this.revokedListeners.delete(cb);
    };
  }

  /** Tells every `onRevoked` listener that `tokenId` was revoked. Call after the store has revoked it. */
  revoked(tokenId: Id): void {
    for (const cb of [...this.revokedListeners]) cb(tokenId);
  }
}
