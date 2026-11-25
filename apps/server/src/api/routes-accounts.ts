import { InviteService } from '../accounts/invites';
import { ApiError } from './frame';
import type { Handler } from './frame';
import { optString } from './fields';

const invitesCreate: Handler<'invites.create'> = async ({ p, req, deps }) => {
  const { code, invite } = await new InviteService(deps).create(p.userId, req.projectId, optString(req.roleId, 'roleId'));
  return { code, invite };
};

const invitesList: Handler<'invites.list'> = async ({ p, req, deps }) => {
  const invites = await new InviteService(deps).list(p.userId, req.projectId);
  return { invites };
};

const invitesRevoke: Handler<'invites.revoke'> = async ({ p, req, deps }) => {
  await new InviteService(deps).revoke(p.userId, req.projectId, req.inviteId);
  return { revoked: true };
};

/** `auth: 'none'`: `p` is null, the caller has no token yet. `http.ip` is the key for the redeem rate limit (contract §12.8). */
const invitesRedeem: Handler<'invites.redeem'> = async ({ req, http, deps }) => new InviteService(deps).redeem(req, http.ip);

/** Ends the calling personal token. A dev token (no token row to revoke) gets `NOT_AUTHORISED`. */
const sessionRevoke: Handler<'session.revoke'> = async ({ p, deps }) => {
  if (!p.tokenId) throw new ApiError('NOT_AUTHORISED');
  const ok = await deps.accounts.revokeToken(p.tokenId, p.userId, deps.cfg.now().toISOString());
  if (!ok) throw new ApiError('NOT_AUTHORISED');
  deps.auth.revoked(p.tokenId);
  return { revoked: true };
};

/** Account-related handlers: spread into `HANDLERS` in `api/index.ts`. */
export const ACCOUNT_HANDLERS = {
  'invites.create': invitesCreate,
  'invites.list': invitesList,
  'invites.revoke': invitesRevoke,
  'invites.redeem': invitesRedeem,
  'session.revoke': sessionRevoke,
};
