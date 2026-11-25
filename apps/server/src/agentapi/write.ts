import { randomUUID } from 'node:crypto';
import { noDots, type Id } from '@meetless/core';
import type { ApiRequest, ApiResponse } from '@meetless/api';
import type { Principal } from '../auth';
import { ApiError, type ApiDeps } from '../api/frame';
import { optString, reqString } from '../api/fields';
import { resolveNeed } from './needs';

/**
 * A fresh id for a domain object this route creates: `<prefix>-<uuid>`, the same shape the
 * client's own `newId` uses (`apps/desktop/src/renderer/model/ids.ts`) — just a local copy,
 * since the server never imports from `apps/desktop` (amendments G2).
 */
function newId(prefix: string): Id {
  return `${prefix}-${randomUUID()}` as Id;
}

/** The server's local calendar date (contract: `today` is `YYYY-MM-DD`), from its own clock. */
export function todayIso(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** The agent-reporting `via`: the calling client, and the token's own id — `dev:<userId>` for a dev token, which has no row of its own. */
function viaOf(p: Principal, client: string): { client: string; tokenId: string } {
  return { client, tokenId: p.tokenId ?? `dev:${p.userId}` };
}

/**
 * `noDots`, then trimmed, for a *required* free-text field. Takes `unknown`, not `string`
 * (coordinator review, fix round 3): the route's own TS types say `string`, but nothing
 * enforces that on the wire — a number or a missing field reaches here as whatever JSON.parse
 * produced, and `noDots` itself throws a plain `TypeError` on a non-string (`500 INTERNAL`,
 * leaking an internal failure for a caller mistake). Checked first, so that case is `400
 * BAD_REQUEST` naming the field, same as every other refusal this function makes.
 *
 * Coordinator review, fix round 2: `noDots('•')` is `' '`, not `''` — it replaces a dot run
 * with a space, it does not delete it — so a bullet-only report, title or verdict must still be
 * caught here, after cleaning, or it is silently stored as a blank. Empty after cleaning is
 * `BAD_REQUEST` too, naming the field, before any append — never a 200 with nothing meaningful
 * behind it (e.g. an empty "## Verdict").
 */
function clean(s: unknown, field: string): string {
  const v = noDots(reqString(s, field)).trim();
  if (v.length === 0) throw new ApiError('BAD_REQUEST', { field });
  return v;
}

/**
 * `noDots`, then trimmed, for an *optional* free-text field: `null`/`undefined` (absent) stay
 * `null`. A *present* non-string (coordinator review, fix round 3: a number, an object — same
 * "the wire doesn't enforce the TS type" reasoning as `clean`) is `400 BAD_REQUEST` naming the
 * field, not silently coerced to `null` — a caller that sent something is telling us it meant
 * something, and unlike an absent field, a present non-string value is never ambiguous with
 * "the caller didn't say". A string that is empty once cleaned (a bullet-only `why`, for
 * instance — fix round 2) comes out `null`, the same as not sending it at all.
 */
function cleanOpt(s: unknown, field: string): string | null {
  const raw = optString(s, field);
  if (raw === null) return null;
  const v = noDots(raw).trim();
  return v.length > 0 ? v : null;
}

/**
 * `work.record` (contract §3; task brief): an agent's work report, appended as `work.recorded`
 * by the token's own user (`e.actorId = p.userId`), through `appendTrusted` — `service.submit`
 * itself refuses any client command carrying `via`, so this route could not go through it even
 * if it tried. `src: 'agent'`, no `capture`, no `ignored`: it counts as progress (`isProgress`).
 * `date` defaults to the server's own today (`todayIso(cfg.now())`) when the caller omits it.
 * `private` is set from the *resolved need's* own privacy (`need.privateTo !== null`), never a
 * caller-supplied flag — this route takes no such field, so a report never claims a privacy
 * the need itself does not already have. `text` is a required field: cleaned and validated
 * non-empty (`clean`) before anything is appended; `why` is optional (`cleanOpt`).
 */
export async function recordWork(deps: ApiDeps, p: Principal, req: ApiRequest<'work.record'>, client: string): Promise<ApiResponse<'work.record'>> {
  const code = reqString(req.code, 'code');
  const effect = optString(req.effect, 'effect') as ApiRequest<'work.record'>['effect'];
  const date = optString(req.date, 'date');
  deps.service.requireMember(p.userId, req.projectId);
  const view = deps.service.view(p.userId);
  const need = resolveNeed(view, req.projectId, code);
  const text = clean(req.text, 'text');
  const why = cleanOpt(req.why, 'why');
  const workId = newId('w');
  const { event } = await deps.service.appendTrusted(p.userId, {
    id: randomUUID(),
    type: 'work.recorded',
    payload: {
      workId,
      projectId: req.projectId,
      needId: need.id,
      src: 'agent',
      text,
      why,
      effect: effect ?? null,
      date: date ?? todayIso(deps.cfg.now()),
      private: need.privateTo !== null,
      via: viaOf(p, client),
    },
  });
  return { workId, seq: event.seq };
}

/**
 * `needs.propose` (contract §3; task brief): a proposal appended as `proposal.created`, which
 * is service-only (`SERVICE_ONLY_EVENTS`) — `appendTrusted`, same as `work.record`. It lands in
 * open proposals (`openProposals`) and the owning project's "To confirm" (`toConfirm`) until
 * accepted or rejected. `parentCode`, when given, resolves exactly like any other need code
 * (`resolveNeed`: identical `NOT_FOUND` for a hidden or missing parent); core's own `checkParent`
 * still refuses a (necessarily shared) proposal naming a still-private parent (`PRIVATE_ITEM`) —
 * this route adds no check of its own for that, since core already owns the decision correctly.
 * `title` is required (`clean`, non-empty); `accept`/`expect`/`verify`/`why` are optional
 * (`cleanOpt`) — all before anything is appended.
 */
export async function proposeNeed(deps: ApiDeps, p: Principal, req: ApiRequest<'needs.propose'>, client: string): Promise<ApiResponse<'needs.propose'>> {
  const kind = reqString(req.kind, 'kind') as ApiRequest<'needs.propose'>['kind'];
  const parentCode = optString(req.parentCode, 'parentCode');
  deps.service.requireMember(p.userId, req.projectId);
  const parentId = parentCode ? resolveNeed(deps.service.view(p.userId), req.projectId, parentCode).id : null;
  const title = clean(req.title, 'title');
  const accept = cleanOpt(req.accept, 'accept');
  const expect = cleanOpt(req.expect, 'expect');
  const verify = cleanOpt(req.verify, 'verify');
  const why = cleanOpt(req.why, 'why');
  const proposalId = newId('pr');
  const { event } = await deps.service.appendTrusted(p.userId, {
    id: randomUUID(),
    type: 'proposal.created',
    payload: {
      proposalId,
      projectId: req.projectId,
      kind,
      title,
      accept,
      expect,
      verify,
      why,
      parentId,
      via: viaOf(p, client),
    },
  });
  return { proposalId, seq: event.seq };
}

/**
 * `needs.verdict` (contract §3; task brief): a plain client command (`service.submit`, not
 * `appendTrusted`) — `need.status_set` is not in `SERVICE_ONLY_EVENTS`, so the agent token's
 * ordinary write authority on this route covers it. The code resolves through `resolveNeed`
 * exactly like every other need reference here.
 *
 * Coordinator review, fix round 1: every status this route's own type permits (`testing`,
 * `held`, `refuted`, `parked`) is a *hypothesis*-only status (`HYP_STATUSES`), so on a real
 * external need `need.status_set`'s reducer always throws `INVALID_STATUS` from `statusFor`
 * before it ever reaches its "only hypotheses have a verdict" check — the contract's
 * `INVALID_EVENT` for a non-hypothesis was unreachable by any caller actually limited to this
 * route's typed `status` values. So this route now checks the need's kind itself, before
 * `submit`, and answers the contract's code directly.
 *
 * Coordinator review, fix round 2: `verdict` is required — core's own `optText` has no
 * non-empty check, so without this route's own validation a bullet-only verdict would be
 * accepted and stored as a blank, and `context.get` would later render an empty "## Verdict"
 * section. `clean` both cleans it with `noDots` and rejects it (`BAD_REQUEST`) if that leaves
 * nothing, before `submit` is ever called.
 */
export async function setVerdict(deps: ApiDeps, p: Principal, req: ApiRequest<'needs.verdict'>): Promise<ApiResponse<'needs.verdict'>> {
  const status = reqString(req.status, 'status') as ApiRequest<'needs.verdict'>['status'];
  deps.service.requireMember(p.userId, req.projectId);
  const need = resolveNeed(deps.service.view(p.userId), req.projectId, req.code);
  if (need.kind !== 'hyp') throw new ApiError('INVALID_EVENT', { what: 'verdict', kind: need.kind });
  const verdict = clean(req.verdict, 'verdict');
  const { event } = await deps.service.submit(p.userId, {
    id: randomUUID(),
    type: 'need.status_set',
    payload: { needId: need.id, status, verdict },
  });
  return { seq: event.seq };
}
