import { randomUUID } from 'node:crypto';
import { handoffForNeed, lastFetchedVersion, needContext, refreshPending } from '@meetless/core';
import { contextLabels, resolveLocale } from '@meetless/i18n';
import type { ApiRequest, ApiResponse } from '@meetless/api';
import type { Principal } from '../auth';
import type { ApiDeps } from '../api/frame';
import { optString } from '../api/fields';
import { resolveNeed } from './needs';

/**
 * `context.get` (contract §3): the live context behind a handoff link, in the caller's
 * locale, with a fetch recorded when it qualifies (contract §3, task brief).
 *
 * - Requires the caller to be a member of `req.projectId` (`NOT_A_MEMBER` for an existing
 *   project the caller cannot read; `NOT_FOUND` for a project that does not exist).
 * - `view = deps.service.view(p.userId)`: private items of other users are never in it.
 * - `req.code` resolves through `resolveNeed` (identical `NOT_FOUND` for a hidden need and
 *   a missing one).
 * - A fetch is recorded (`handoff.context_fetched`, in-process via `appendTrusted`, so it
 *   never reaches the client command path) when the caller holds an **agent** token, is the
 *   recipient of an open (not `done`) handoff on this need, and either has not fetched the
 *   current version yet or the sender is waiting on a requested refresh. `recordedFetch` in
 *   the response is true exactly when all of that holds and the current version ends up on
 *   record — whether this call just wrote it or it was already there from an earlier one.
 */
export async function fetchContext(deps: ApiDeps, p: Principal, req: ApiRequest<'context.get'>, client: string): Promise<ApiResponse<'context.get'>> {
  const wanted = optString(req.locale, 'locale');
  deps.service.requireMember(p.userId, req.projectId);
  const view = deps.service.view(p.userId);
  const user = view.users[p.userId];
  const locale = resolveLocale([wanted ?? user?.locale ?? 'en']);
  const need = resolveNeed(view, req.projectId, req.code);
  const L = contextLabels(locale);
  const ctx = needContext(view, need.id, L);

  let recordedFetch = false;
  const h = handoffForNeed(view, need.id);
  if (p.kind === 'agent' && h !== null && h.toId === p.userId && h.state !== 'done') {
    const needsRecording = lastFetchedVersion(h) !== ctx.version || refreshPending(h) !== null;
    if (needsRecording) {
      await deps.service.appendTrusted(p.userId, {
        id: randomUUID(),
        type: 'handoff.context_fetched',
        payload: { handoffId: h.id, version: ctx.version, client },
      });
    }
    // Either the call above just put the current version on record, or it already was.
    recordedFetch = true;
  }

  return { ...ctx, recordedFetch };
}
