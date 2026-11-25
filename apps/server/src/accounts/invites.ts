import { randomUUID } from 'node:crypto';
import { chmod, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { noDots, type Id } from '@meetless/core';
import { resolveLocale } from '@meetless/i18n';
import type { InviteInfo, UserInfo } from '@meetless/api';
import { ApiError, type ApiDeps } from '../api/frame';
import { optString, reqString } from '../api/fields';
import { hashSecret, newInviteCode, newToken, newUserId, normalizeInviteCode } from './secrets';
import type { InviteRow } from '../store/types';

const ADMIN_INVITE_FILE = 'admin-invite.txt';
/** The system actor that registers new users (distinct from `'system'`, the office/derivation worker). */
const SYSTEM_ACCOUNTS: Id = 'system:accounts';
/** `displayName` is clipped to this many characters. */
const MAX_DISPLAY_NAME = 60;

function adminInviteFile(dataDir: string): string {
  return join(dataDir, ADMIN_INVITE_FILE);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The hash an invite code is stored and looked up by: always the normalized form, so a code is found
 * whatever dashes, spaces or case the caller typed it with (see `normalizeInviteCode`). */
function hashInviteCode(code: string): string {
  return hashSecret(normalizeInviteCode(code));
}

function toInviteInfo(row: InviteRow): InviteInfo {
  return {
    id: row.id,
    projectId: row.projectId,
    roleId: row.roleId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    usedBy: row.usedBy,
    usedAt: row.usedAt,
    revokedAt: row.revokedAt,
  };
}

/**
 * Invite codes: project invites (created by a member, optionally carrying a
 * role) and the one-time admin bootstrap invite (`ensureAdminInvite`, no
 * project). Redeeming either registers a user and mints a personal token.
 */
export class InviteService {
  constructor(private readonly deps: ApiDeps) {}

  private isMember(userId: Id, projectId: Id): boolean {
    const p = this.deps.service.current.projects[projectId];
    return !!p && p.memberIds.includes(userId);
  }

  async create(actor: Id, projectId: Id, roleId: Id | null): Promise<{ code: string; invite: InviteInfo }> {
    this.deps.service.requireMember(actor, projectId);
    if (roleId !== null) {
      const role = this.deps.service.current.roles[roleId];
      if (!role || role.projectId !== projectId) throw new ApiError('NOT_FOUND', { what: 'role', id: roleId });
    }
    const code = newInviteCode();
    const row: InviteRow = {
      id: `i-${randomUUID()}`,
      codeHash: hashInviteCode(code),
      projectId,
      roleId,
      admin: false,
      createdBy: actor,
      createdAt: this.deps.cfg.now().toISOString(),
      usedBy: null,
      usedAt: null,
      revokedAt: null,
    };
    await this.deps.accounts.createInvite(row);
    return { code, invite: toInviteInfo(row) };
  }

  async list(actor: Id, projectId: Id): Promise<InviteInfo[]> {
    this.deps.service.requireMember(actor, projectId);
    const rows = await this.deps.accounts.listInvites(projectId);
    return rows.map(toInviteInfo);
  }

  async revoke(actor: Id, projectId: Id, inviteId: Id): Promise<void> {
    this.deps.service.requireMember(actor, projectId);
    const row = await this.deps.accounts.invite(inviteId);
    if (!row || row.projectId !== projectId) throw new ApiError('NOT_FOUND', { what: 'invite', id: inviteId });
    if (row.usedAt) throw new ApiError('INVITE_USED');
    await this.deps.accounts.revokeInvite(inviteId, this.deps.cfg.now().toISOString());
  }

  /**
   * `ip` is the caller's client address (contract §12.8): a redeem that would fail
   * (`INVITE_INVALID`, `INVITE_USED`, `BAD_REQUEST`) counts one failure for it, and once
   * over the limit the redeem answers `RATE_LIMITED` instead of its real code, without
   * ever calling `claimInvite` for that request. A redeem that succeeds never counts.
   */
  async redeem(req: { code: string; displayName: string; locale: string }, ip: string): Promise<{ token: string; user: UserInfo; projectId: Id | null }> {
    const { accounts, service, cfg } = this.deps;
    // A wrong-typed field is a failed redeem like any other (counted, and RATE_LIMITED once over).
    let fields: { code: string; displayName: string; locale: string | null };
    try {
      fields = { code: reqString(req.code, 'code'), displayName: reqString(req.displayName, 'displayName'), locale: optString(req.locale, 'locale') };
    } catch (e) {
      if (e instanceof ApiError) throw this.rateLimitedOr(ip, 'BAD_REQUEST', e.details);
      throw e;
    }
    const displayName = noDots(fields.displayName).trim().slice(0, MAX_DISPLAY_NAME);
    const normalized = normalizeInviteCode(fields.code);
    const row = normalized ? await accounts.inviteByHash(hashSecret(normalized)) : null;

    const fail = this.redeemFailure(row, displayName);
    if (fail) throw this.rateLimitedOr(ip, fail);

    const userId = newUserId();
    const now = cfg.now().toISOString();
    const claim = await accounts.claimInvite(row!.id, userId, now);
    if (claim === 'used') throw this.rateLimitedOr(ip, 'INVITE_USED');
    if (claim === 'revoked') throw this.rateLimitedOr(ip, 'INVITE_INVALID');

    try {
      const locale = resolveLocale(fields.locale === null ? [] : [fields.locale]);

      await service.appendSystem(SYSTEM_ACCOUNTS, {
        id: `register:${userId}`,
        type: 'user.registered',
        payload: { userId, displayName, locale },
      });
      if (row!.projectId !== null) {
        await service.appendTrusted(row!.createdBy!, {
          id: `invite:${row!.id}:member`,
          type: 'project.member_added',
          payload: { projectId: row!.projectId, userId },
        });
        if (row!.roleId !== null) {
          await service.appendTrusted(row!.createdBy!, {
            id: `invite:${row!.id}:role`,
            type: 'role.member_assigned',
            payload: { roleId: row!.roleId, userId },
          });
        }
      }

      const token = newToken('personal');
      await accounts.createToken({
        id: `t-${randomUUID()}`,
        kind: 'personal',
        userId,
        label: 'app',
        tokenHash: hashSecret(token),
        createdAt: now,
        lastUsedAt: null,
        revokedAt: null,
      });

      if (row!.admin) await unlink(adminInviteFile(cfg.dataDir)).catch(() => undefined);

      return { token, user: { id: userId, displayName, locale }, projectId: row!.projectId };
    } catch (e) {
      await accounts.releaseInvite(row!.id);
      throw e;
    }
  }

  /** Every way a redeem can fail before `claimInvite` is ever called: unknown/revoked/already-used
   * code, a project invite whose inviter or role no longer holds, or an empty display name. */
  private redeemFailure(row: InviteRow | null, displayName: string): 'INVITE_INVALID' | 'INVITE_USED' | 'BAD_REQUEST' | null {
    if (!row || row.revokedAt) return 'INVITE_INVALID';
    if (row.usedAt) return 'INVITE_USED';
    // For a project invite, the inviter must still be a member and the role (if any) must still exist,
    // or the invite can no longer be honoured, the same as an unknown or revoked one.
    if (row.projectId !== null) {
      if (row.createdBy === null || !this.isMember(row.createdBy, row.projectId)) return 'INVITE_INVALID';
      if (row.roleId !== null) {
        const role = this.deps.service.current.roles[row.roleId];
        if (!role || role.projectId !== row.projectId) return 'INVITE_INVALID';
      }
    }
    if (!displayName) return 'BAD_REQUEST';
    return null;
  }

  /** `code` unless `ip` is over the redeem limit, in which case `RATE_LIMITED` (contract §12.8); either way counts one failure for `ip`. */
  private rateLimitedOr(ip: string, code: 'INVITE_INVALID' | 'INVITE_USED' | 'BAD_REQUEST', details?: unknown): ApiError {
    const hit = this.deps.rateLimits.redeem.hit(ip);
    if (!hit.ok) return new ApiError('RATE_LIMITED', { retryAfter: hit.retryAfterSec });
    return new ApiError(code, details);
  }

  /**
   * On first start (no account exists yet), issues the one-time admin
   * bootstrap invite and writes it to `<dataDir>/admin-invite.txt` (mode
   * `0o600`). A no-op once any account exists. If a pending admin invite is
   * still waiting and its file is still there, nothing new is issued; if the
   * file is gone (lost or already shown), the old invite is revoked and a
   * fresh one takes its place.
   */
  async ensureAdminInvite(): Promise<{ code: string | null; file: string }> {
    const { accounts, cfg } = this.deps;
    const file = adminInviteFile(cfg.dataDir);
    if (await accounts.hasAnyAccount()) return { code: null, file };

    const pending = await accounts.pendingAdminInvite();
    if (pending && (await fileExists(file))) {
      cfg.print(`Admin invite not used yet: see ${file}`);
      return { code: null, file };
    }
    if (pending) await accounts.revokeInvite(pending.id, cfg.now().toISOString());

    const code = newInviteCode();
    const row: InviteRow = {
      id: `i-${randomUUID()}`,
      codeHash: hashInviteCode(code),
      projectId: null,
      roleId: null,
      admin: true,
      createdBy: null,
      createdAt: cfg.now().toISOString(),
      usedBy: null,
      usedAt: null,
      revokedAt: null,
    };
    await accounts.createInvite(row);
    await writeFile(file, `${code}\n`, { mode: 0o600 });
    // `mode` applies only when writeFile creates the file: a stale file left from before keeps its own mode otherwise.
    await chmod(file, 0o600);
    cfg.print(`Admin invite: ${code} (saved to ${file})`);
    return { code, file };
  }
}
