import type { SubmitResult } from '@meetless/client/bridge';
import type { Artifact, EventPayloads, EventType, Id, State } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { shareState } from '@renderer/artifacts/model';
import { blockedFor, sharePrivateNeedIds, type BlockedShare } from '@renderer/inputs/model';

/**
 * 「仅自己」: the project / only-me toggle and the share flows. The server filters private items
 * for everyone else; nothing here hides anything as a privacy measure.
 */

export { blockedFor, sharePrivateNeedIds, shareState, type BlockedShare };

export type Visibility = 'project' | 'only';

export const VISIBILITY_OPTIONS: readonly { value: Visibility; key: MessageKey }[] = [
  { value: 'project', key: 'pv.project' },
  { value: 'only', key: 'pv.only' },
];

/** The `private` flag a create or import event takes. */
export function isPrivate(v: Visibility): boolean {
  return v === 'only';
}

export function visibilityOf(item: { privateTo: Id | null }): Visibility {
  return item.privateTo === null ? 'project' : 'only';
}

/** 「仅你可见」 shows on my own private items (muted text, never a dot). */
export function isMine(item: { privateTo: Id | null }, me: Id): boolean {
  return item.privateTo === me;
}

export const MINE_KEY: MessageKey = 'pv.mine';
export const PUBLISH_KEY: MessageKey = 'pv.publish';

export type Submit = <K extends EventType>(type: K, payload: EventPayloads[K]) => Promise<SubmitResult>;

/**
 * Shares an input. A `PRIVATE_ITEM` refusal comes back as the needs to share first, tagged with
 * this input, so a later screen for another input can never act on it (`blockedFor`).
 */
export async function shareInput(submit: Submit, inputId: Id): Promise<BlockedShare | null> {
  const r = await submit('input.shared', { inputId });
  const needIds = sharePrivateNeedIds(r);
  return needIds ? { inputId, needIds } : null;
}

/** Shares the blocking needs one by one (stops at the first refusal), then the input again. */
export async function shareNeedsThenInput(submit: Submit, blocked: BlockedShare): Promise<BlockedShare | null> {
  for (const needId of blocked.needIds) {
    const r = await submit('need.shared', { needId });
    if (r.kind === 'rejected') return blocked;
  }
  return shareInput(submit, blocked.inputId);
}

/** Shares an artifact only when core would accept it; otherwise says why not. */
export async function shareArtifact(submit: Submit, s: State, me: Id, a: Artifact): Promise<ReturnType<typeof shareState> | 'rejected'> {
  const st = shareState(s, me, a);
  if (st !== 'ok') return st;
  const r = await submit('artifact.shared', { artifactId: a.id });
  return r.kind === 'rejected' ? 'rejected' : 'shared';
}

export async function shareNeed(submit: Submit, needId: Id): Promise<boolean> {
  const r = await submit('need.shared', { needId });
  return r.kind !== 'rejected';
}
