/**
 * 公开到项目 on an "Only me" need. `need.shared` is refused `PRIVATE_SOURCE` while the need's
 * source input (or a revision's) is still private, so the click shares those inputs first, then
 * the need. `input.shared` can be refused `PRIVATE_ITEM { needIds }` (an undecided revision of
 * that input targets other private needs): the click stops (`needFirst`), the button names those
 * codes, and the next click shares them first. When that cannot work (`decideFirst`), the way out
 * is deciding the extract in To confirm. The same sequence as the old renderer's share.ts, over
 * the app's `Submit` instead of its React context.
 */
import type { Id, Need, State } from '@meetless/core';
import type { Cmd } from '../../../../../desktop/src/renderer/collab/model';
import type { Submit } from '../../confirm/model/run';

/** The still-private input ids a need's source and revisions name, source first, each once. */
export function privateSourceInputIds(s: State, need: Need): Id[] {
  const seen = new Set<Id>();
  const out: Id[] = [];
  for (const id of [need.source.inputId, ...need.revisions.map((r) => r.inputId)]) {
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    if ((s.inputs[id]?.privateTo ?? null) !== null) out.push(id);
  }
  return out;
}

/** What the share click submits, in order: `input.shared` for each still-private source input, then `need.shared`. */
export function shareSteps(s: State, need: Need): Cmd[] {
  const cmds: Cmd[] = privateSourceInputIds(s, need).map((inputId): Cmd => ({ type: 'input.shared', payload: { inputId } }));
  cmds.push({ type: 'need.shared', payload: { needId: need.id } });
  return cmds;
}

export type ShareState = { kind: 'idle' } | { kind: 'needFirst'; needIds: Id[] } | { kind: 'decideFirst' };
export const SHARE_IDLE: ShareState = { kind: 'idle' };

function privateItemNeedIds(details: unknown): Id[] | null {
  const ids = (details as { needIds?: unknown } | null | undefined)?.needIds;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) return null;
  return [...new Set(ids as Id[])];
}

type StepsOutcome = { kind: 'done' } | { kind: 'failed' } | { kind: 'privateItem'; needIds: Id[] };

async function runSteps(cmds: readonly Cmd[], submit: Submit, sharedInputs: Set<Id>): Promise<StepsOutcome> {
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

/** One click on the share button, from `state`; resolves the state for the next click. */
export async function shareClick(s: State, need: Need, state: ShareState, submit: Submit): Promise<ShareState> {
  const sharedInputs = new Set<Id>();
  if (state.kind === 'needFirst') {
    for (const id of state.needIds) {
      const other = s.needs[id];
      if (!other || other.privateTo === null || id === need.id) continue;
      const r = await runSteps(shareSteps(s, other), submit, sharedInputs);
      if (r.kind !== 'done') return { kind: 'decideFirst' };
    }
  }
  const r = await runSteps(shareSteps(s, need), submit, sharedInputs);
  if (r.kind !== 'privateItem') return SHARE_IDLE;
  if (r.needIds.includes(need.id)) return { kind: 'decideFirst' };
  return { kind: 'needFirst', needIds: r.needIds };
}

export interface ShareView {
  /** The button's label key. */
  label: 'common.sharePrivateNeedFirst' | 'common.shareSourceFirst' | 'pv.publish';
  /** Codes of the other private needs the next click also shares (`dr.shareAlso`). */
  also: string[];
  /** Show `dr.decideFirst` with a button to To confirm. */
  decideFirst: boolean;
}

export function shareView(s: State, need: Need, state: ShareState): ShareView {
  const others = state.kind === 'needFirst' ? state.needIds.map((id) => s.needs[id]).filter((n): n is Need => !!n && n.privateTo !== null && n.id !== need.id) : [];
  if (others.length > 0) return { label: 'common.sharePrivateNeedFirst', also: others.map((n) => n.code), decideFirst: false };
  return { label: privateSourceInputIds(s, need).length > 0 ? 'common.shareSourceFirst' : 'pv.publish', also: [], decideFirst: state.kind === 'decideFirst' };
}
