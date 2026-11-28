import { randomUUID } from 'node:crypto';
import { noDots, readableProjectIds } from '@meetless/core';
import type { AgentTokenInfo } from '@meetless/api';
import { hashSecret, newToken } from '../accounts/secrets';
import { agentSetup } from '../accounts/setup';
import type { TokenRow } from '../store/types';
import { ApiError } from './frame';
import type { Handler } from './frame';
import { optInt, reqString } from './fields';

const MAX_LABEL_LENGTH = 40;
/** `agentCalls.list`'s default and ceiling (brief: "limit default 50, maximum 200"). */
const DEFAULT_CALLS_LIMIT = 50;
const MAX_CALLS_LIMIT = 200;

const toInfo = (t: TokenRow): AgentTokenInfo => ({
  id: t.id,
  label: t.label,
  createdAt: t.createdAt,
  lastUsedAt: t.lastUsedAt,
  revokedAt: t.revokedAt,
});

/** Mints an agent token for the caller. The plaintext is returned once, never again. */
const tokensCreate: Handler<'tokens.create'> = async ({ p, req, deps }) => {
  const label = noDots(reqString(req.label, 'label')).trim();
  if (label.length < 1 || label.length > MAX_LABEL_LENGTH) throw new ApiError('BAD_REQUEST');
  const token = newToken('agent');
  const row: TokenRow = {
    id: `tok-${randomUUID()}`,
    kind: 'agent',
    userId: p.userId,
    label,
    tokenHash: hashSecret(token),
    createdAt: deps.cfg.now().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  };
  await deps.accounts.createToken(row);
  return { token, info: toInfo(row) };
};

/** The caller's agent tokens. Never the token itself or its hash. */
const tokensList: Handler<'tokens.list'> = async ({ p, deps }) => {
  const rows = await deps.accounts.listTokens(p.userId, 'agent');
  return { tokens: rows.map(toInfo) };
};

/**
 * Revokes one of the caller's own agent tokens. Anything else (missing, someone else's, or the
 * caller's own personal/session token, which goes through `session.revoke` instead) is NOT_FOUND:
 * `revokeToken` checks only (id, userId), not kind, so the agent-token scope is enforced here by
 * requiring the id to be in the caller's own agent-token list before revoking it.
 */
const tokensRevoke: Handler<'tokens.revoke'> = async ({ p, req, deps }) => {
  const mine = await deps.accounts.listTokens(p.userId, 'agent');
  if (!mine.some((t) => t.id === req.tokenId)) throw new ApiError('NOT_FOUND');
  const ok = await deps.accounts.revokeToken(req.tokenId, p.userId, deps.cfg.now().toISOString());
  if (!ok) throw new ApiError('NOT_FOUND');
  deps.auth.revoked(req.tokenId);
  return { revoked: true };
};

/** The caller's own agent-call log, newest first. An out-of-range `limit` is clamped; a non-integer one is BAD_REQUEST. */
const agentCallsList: Handler<'agentCalls.list'> = async ({ p, req, deps }) => {
  const n = optInt(req.limit, 'limit') ?? DEFAULT_CALLS_LIMIT;
  const limit = Math.min(Math.max(1, n), MAX_CALLS_LIMIT);
  const calls = await deps.accounts.listCalls(p.userId, limit);
  return { calls };
};

/** The Agents page's setup text, keyed to this request's protocol and host (contract §12.1). */
const agentSetupGet: Handler<'agentSetup.get'> = async ({ http, deps }) => agentSetup(deps.cfg, http.host, http.protocol);

/** Projects the caller (an agent token, in practice) may read. */
const projectsList: Handler<'projects.list'> = async ({ p, deps }) => {
  const view = deps.service.view(p.userId);
  // A project-scoped token sees its own project only.
  const ids = [...readableProjectIds(view, p.userId)].filter((id) => !p.projectId || id === p.projectId);
  return {
    projects: ids.map((id) => {
      const proj = view.projects[id]!;
      return { id: proj.id, name: proj.name, sample: proj.sample };
    }),
  };
};

/** Token, agent-call, agent-setup and project-list handlers: spread into `HANDLERS` in `api/index.ts`. */
export const TOKEN_HANDLERS = {
  'tokens.create': tokensCreate,
  'tokens.list': tokensList,
  'tokens.revoke': tokensRevoke,
  'agentCalls.list': agentCallsList,
  'agentSetup.get': agentSetupGet,
  'projects.list': projectsList,
};
