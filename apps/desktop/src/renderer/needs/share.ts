/**
 * The private-need share sequence (contract §12.9, §12.22). `need.shared` throws `PRIVATE_SOURCE`
 * while the need's source input, or any revision's input, is still private: `dr-share`'s click
 * submits `input.shared` for each such input (source first, then revisions, each once), then
 * `need.shared`, and stops as soon as one of them is rejected.
 *
 * `input.shared` can itself be refused `PRIVATE_ITEM { needIds }`: an undecided `rev` extract of
 * that input targets still-private needs. Another private need is never published on the user's
 * behalf without them seeing it first: the click stops there (`needFirst`), the drawer relabels
 * `dr-share` to `common.sharePrivateNeedFirst` and names the codes, and only the next click shares
 * each named need (its own full share-first sequence), then retries the input and carries on.
 * When the refusal names the need being shared itself, or anything in that branch is refused,
 * the way out is deciding the extract (`decideFirst`: `dr.decideFirst` and `dr-share-review`).
 */
import type { Id, Need, State } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import type { AppApi } from '../app/AppContext';
import type { Cmd } from '../collab/model';

/** The still-private input ids a need's source and revisions name, source first, each once. */
export function privateSourceInputIds(s: State, need: Need): Id[] {
  const ids = [need.source.inputId, ...need.revisions.map((r) => r.inputId)];
  const seen = new Set<Id>();
  const out: Id[] = [];
  for (const id of ids) {
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    if ((s.inputs[id]?.privateTo ?? null) !== null) out.push(id);
  }
  return out;
}

/** The commands `dr-share` submits, in order: `input.shared` for each still-private source input, then `need.shared`. */
export function shareSteps(s: State, need: Need): Cmd[] {
  const cmds: Cmd[] = privateSourceInputIds(s, need).map((inputId): Cmd => ({ type: 'input.shared', payload: { inputId } }));
  cmds.push({ type: 'need.shared', payload: { needId: need.id } });
  return cmds;
}

/**
 * Where `dr-share` stands between clicks: `idle`; `needFirst` after an `input.shared` refusal
 * named other private needs (the next click shares them first); `decideFirst` when sharing cannot
 * go on this way and the input's pending revision must be decided in To confirm.
 */
export type ShareState = { kind: 'idle' } | { kind: 'needFirst'; needIds: Id[] } | { kind: 'decideFirst' };

export const SHARE_IDLE: ShareState = { kind: 'idle' };
const DECIDE_FIRST: ShareState = { kind: 'decideFirst' };

/**
 * `input.shared`'s `PRIVATE_ITEM` refusal names the private needs an undecided `rev` extract of
 * that input still targets (contract §12.22: `details: { needIds }`), deduped. Malformed details
 * (not an object, no `needIds`, or anything in it that is not a non-empty list of strings) give null.
 */
function privateItemNeedIds(details: unknown): Id[] | null {
  const ids = (details as { needIds?: unknown } | null | undefined)?.needIds;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) return null;
  return [...new Set(ids as Id[])];
}

type StepsOutcome = { kind: 'done' } | { kind: 'failed' } | { kind: 'privateItem'; needIds: Id[] };

/**
 * Runs `cmds` through `submit`, one at a time and in order; an accepted, queued or duplicate
 * result moves on, a rejection stops (`submit` already shows its notice). `sharedInputs` carries
 * the inputs this click already shared, so a later sequence never sends the same `input.shared`
 * twice.
 */
async function runSteps(cmds: readonly Cmd[], submit: AppApi['submit'], sharedInputs: Set<Id>): Promise<StepsOutcome> {
  for (const cmd of cmds) {
    if (cmd.type === 'input.shared' && sharedInputs.has(cmd.payload.inputId)) continue;
    const r = await submit(cmd.type, cmd.payload);
    if (r.kind === 'rejected') {
      const ids = cmd.type === 'input.shared' && r.code === 'PRIVATE_ITEM' ? privateItemNeedIds(r.details) : null;
      return ids ? { kind: 'privateItem', needIds: ids } : { kind: 'failed' };
    }
    if (cmd.type === 'input.shared') sharedInputs.add(cmd.payload.inputId);
  }
  return { kind: 'done' };
}

/**
 * One click on `dr-share`, from `state`; resolves the state for the next click. In `needFirst`
 * it first runs `shareSteps` for each named need still private in `s` (any refusal there gives
 * `decideFirst`), then `need`'s own steps, whose first one is the retried `input.shared`. A
 * `PRIVATE_ITEM` refusal of `need`'s own steps stops with `needFirst` (or `decideFirst` when it
 * names `need` itself); any other refusal leaves the button as it was (`idle`).
 */
export async function shareClick(s: State, need: Need, state: ShareState, submit: AppApi['submit']): Promise<ShareState> {
  const sharedInputs = new Set<Id>();
  if (state.kind === 'needFirst') {
    for (const id of state.needIds) {
      const other = s.needs[id];
      if (!other || other.privateTo === null || id === need.id) continue;
      const r = await runSteps(shareSteps(s, other), submit, sharedInputs);
      if (r.kind !== 'done') return DECIDE_FIRST;
    }
  }
  const r = await runSteps(shareSteps(s, need), submit, sharedInputs);
  if (r.kind !== 'privateItem') return SHARE_IDLE;
  if (r.needIds.includes(need.id)) return DECIDE_FIRST;
  return { kind: 'needFirst', needIds: r.needIds };
}

export interface ShareView {
  /** `dr-share`'s label. */
  label: MessageKey;
  /** The codes of the other private needs the next click also shares (`dr.shareAlso`). */
  also: string[];
  /** Show `dr.decideFirst` (with `dr-share-review`). */
  decideFirst: boolean;
}

/**
 * What `dr-share` shows for `state`. A `needFirst` whose needs have meanwhile all been shared (or
 * are gone) reads as `idle` again.
 */
export function shareView(s: State, need: Need, state: ShareState): ShareView {
  const others = state.kind === 'needFirst' ? state.needIds.map((id) => s.needs[id]).filter((n): n is Need => !!n && n.privateTo !== null && n.id !== need.id) : [];
  if (others.length > 0) return { label: 'common.sharePrivateNeedFirst', also: others.map((n) => n.code), decideFirst: false };
  const label: MessageKey = privateSourceInputIds(s, need).length > 0 ? 'common.shareSourceFirst' : 'pv.publish';
  return { label, also: [], decideFirst: state.kind === 'decideFirst' };
}
