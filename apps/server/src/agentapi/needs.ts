import { currentRound, DomainError, needByCode, needLink, needVersion, projectNeeds, projectRounds, userName } from '@meetless/core';
import type { Id, Need, State } from '@meetless/core';
import type { ApiRequest, NeedSummary } from '@meetless/api';
import { ApiError } from '../api/frame';
import { optString } from '../api/fields';

/**
 * Resolves `code` (case-insensitive, `needByCode`) to a need visible in `view`. Throws
 * `NOT_FOUND` whose details are built from the request alone (`projectId`, `code`): a need
 * hidden from this viewer (another user's private item) and a code that does not exist at
 * all give byte-identical bodies, so ids cannot be probed for existence.
 */
export function resolveNeed(view: State, projectId: Id, code: string): Need {
  const need = needByCode(view, projectId, code);
  if (!need) throw new DomainError('NOT_FOUND', 'need not found', { what: 'need', projectId, code });
  return need;
}

/**
 * `needs.list` (contract §3): the project's needs visible to `view`, filtered by `kind`,
 * `status` and `round` (`'current'` or a round number; a round that does not resolve to an
 * actual round in this project gives an empty list, not every need). Private needs of
 * other users are never in `view.needs`, so they can never appear here.
 */
export function listNeeds(view: State, req: ApiRequest<'needs.list'>): NeedSummary[] {
  const kind = optString(req.kind, 'kind');
  const status = optString(req.status, 'status');
  const r = req.round as unknown;
  if (r !== undefined && r !== 'current' && !(typeof r === 'number' && Number.isSafeInteger(r))) throw new ApiError('BAD_REQUEST', { field: 'round' });
  let needs = projectNeeds(view, req.projectId);
  if (kind) needs = needs.filter((n) => n.kind === kind);
  if (status) needs = needs.filter((n) => n.status === status);
  if (r !== undefined) {
    const round = r === 'current' ? currentRound(view, req.projectId) : (projectRounds(view, req.projectId).find((x) => x.n === r) ?? null);
    needs = round ? needs.filter((n) => n.roundId === round.id) : [];
  }
  return needs.map((n) => ({
    projectId: n.projectId,
    code: n.code,
    kind: n.kind,
    title: n.title,
    status: n.status,
    round: n.roundId ? (view.rounds[n.roundId]?.n ?? null) : null,
    owner: n.ownerId ? userName(view, n.ownerId) : null,
    version: needVersion(n),
    link: needLink(n.projectId, n.code),
  }));
}
