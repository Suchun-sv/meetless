/**
 * Need edits: status (with a hypothesis's verdict), owner, revision, deadline (the DDL a need
 * sits under, or a new date) and parent. The payload builders the old renderer already has are
 * imported; deadline-by-date and parent are new here.
 */
import { EXT_STATUSES, HYP_STATUSES, membersOf, projectNeeds, projectRounds, clip, userName, type Id, type IsoDate, type Need, type NeedStatus, type Round, type State } from '@meetless/core';
import type { Cmd } from '../../../../../desktop/src/renderer/collab/model';
import { newId } from '../../../../../desktop/src/renderer/model/ids';
import { ddlStart } from '../../../../../desktop/src/renderer/setup/model';

export {
  newNeedCommand,
  ownerCommand,
  reviseCommand,
  roundCommand,
  statusChanged,
  statusCommand,
  type NewNeedForm,
} from '../../../../../desktop/src/renderer/needs/edit';
export type { Cmd };

/** The statuses a need can be set to (`st.<status>`). */
export function statusChoices(n: Need): readonly NeedStatus[] {
  return n.kind === 'ext' ? EXT_STATUSES : HYP_STATUSES;
}

/** The project's members, in membership order, for the owner picker (plus `own.none`). */
export function ownerChoices(s: State, projectId: Id): { id: Id; name: string }[] {
  return membersOf(s, projectId).map((id) => ({ id, name: userName(s, id) }));
}

/** The DDLs a need can move to: every one not delivered, plus its own even when delivered (plus `round.none`). */
export function deadlineChoices(s: State, n: Need): Round[] {
  return projectRounds(s, n.projectId).filter((r) => r.status !== 'delivered' || r.id === n.roundId);
}

/**
 * Moving a need to a due date: under the project's open DDL of that day, else a new DDL titled
 * from the need (created first). Null when the need already sits under that day's DDL.
 */
export function deadlineDateCommands(s: State, n: Need, due: IsoDate, today: IsoDate, roundId: () => Id = () => newId('rnd')): Cmd[] | null {
  const rounds = projectRounds(s, n.projectId);
  const hit = rounds.find((r) => r.due === due && r.status !== 'delivered');
  if (hit && hit.id === n.roundId) return null;
  if (hit) return [{ type: 'need.updated', payload: { needId: n.id, roundId: hit.id } }];
  const id = roundId();
  return [
    { type: 'round.created', payload: { roundId: id, projectId: n.projectId, title: clip(n.title, 40), kind: 'hard', start: ddlStart(rounds, due, today), due } },
    { type: 'need.updated', payload: { needId: n.id, roundId: id } },
  ];
}

/** Ids of `needId` and everything under it (a need cannot hang under itself or its own child). */
function selfAndBelow(s: State, needId: Id): Set<Id> {
  const out = new Set<Id>([needId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of Object.values(s.needs)) {
      if (n.parentId && out.has(n.parentId) && !out.has(n.id)) {
        out.add(n.id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * Needs `n` can hang under: same project, not itself or below it, and for a shared need never a
 * private one (core refuses that). External needs first, then hypotheses, each in creation order.
 */
export function parentChoices(s: State, n: Need): Need[] {
  const blocked = selfAndBelow(s, n.id);
  return projectNeeds(s, n.projectId)
    .filter((p) => !blocked.has(p.id) && (n.privateTo !== null || p.privateTo === null))
    .sort((a, b) => (a.kind === b.kind ? a.createdSeq - b.createdSeq : a.kind === 'ext' ? -1 : 1));
}

/** `need.updated`'s payload for a new parent (or none). */
export function parentCommand(n: Need, parentId: Id | null): Cmd<'need.updated'> {
  return { type: 'need.updated', payload: { needId: n.id, parentId } };
}
