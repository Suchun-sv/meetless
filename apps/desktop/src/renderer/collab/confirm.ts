/**
 * Pure derived data for "To confirm" (contract §2): the item list (conflicts, questions,
 * detected extracts, agent proposals), conflicts waiting on someone else, and the command
 * builders for every way to answer an item. No React, no i18n. Task 10 (the To-confirm panel)
 * renders and submits from this.
 */
import {
  isOpen,
  matchNeed,
  openConflicts,
  projectNeeds,
  questionId,
  toConfirm,
  type Conflict,
  type EventPayloads,
  type Extract,
  type Id,
  type Input,
  type IsoDate,
  type Need,
  type Proposal,
  type Question,
  type Round,
  type State,
  type WorkItem,
} from '@meetless/core';
import type { Cmd } from './model';

export type ConfirmItem =
  | { kind: 'conflict'; id: Id; conflict: Conflict; delegatedBy: Id | null }
  | { kind: 'question'; id: string; question: Question }
  | { kind: 'extract'; id: string; input: Input; extract: Extract }
  | { kind: 'proposal'; id: Id; proposal: Proposal };

/**
 * One user's "To confirm" items: conflicts, then questions, then detected extracts, then
 * proposals, each in the order `toConfirm` gives. A delegated conflict carries who handed
 * it off (`resolution.by`); every other item carries `delegatedBy: null`.
 */
export function confirmItems(s: State, me: Id, projectId: Id, today: IsoDate): ConfirmItem[] {
  const tc = toConfirm(s, me, projectId, today);
  const items: ConfirmItem[] = [];
  for (const c of tc.conflicts) {
    const delegatedBy = c.status === 'delegated' && c.resolution ? c.resolution.by : null;
    items.push({ kind: 'conflict', id: c.id, conflict: c, delegatedBy });
  }
  for (const q of tc.questions) items.push({ kind: 'question', id: questionId(q), question: q });
  for (const px of tc.extracts) {
    const input = s.inputs[px.inputId];
    const extract = input?.extracts.find((x) => x.id === px.extractId);
    if (!input || !extract) continue;
    items.push({ kind: 'extract', id: `${px.inputId}:${px.extractId}`, input, extract });
  }
  for (const p of tc.proposals) items.push({ kind: 'proposal', id: p.id, proposal: p });
  return items;
}

/**
 * Open or delegated conflicts in the project that are not `me`'s to confirm right now: not
 * `me`'s to decide (as the current decider), and not an open conflict on a need `me` owns.
 * `deciderId` is who decides now (the delegate once a conflict is delegated).
 */
export function waitingConflicts(s: State, me: Id, projectId: Id): { conflict: Conflict; deciderId: Id }[] {
  return openConflicts(s, projectId)
    .filter((c) => !(c.deciderId === me || (c.status === 'open' && s.needs[c.needId]?.ownerId === me)))
    .map((c) => ({ conflict: c, deciderId: c.deciderId }));
}

/** The `conflict.resolved` command for one of the three ways a conflict is answered. */
export function conflictCommand(
  c: Conflict,
  r: { kind: 'revise' } | { kind: 'park'; needId: Id; roundId: Id | null } | { kind: 'handoff'; handoffId: Id; toId: Id; ask: string; due: IsoDate | null },
): Cmd<'conflict.resolved'> {
  if (r.kind === 'revise') return { type: 'conflict.resolved', payload: { conflictId: c.id, resolution: 'revise' } };
  if (r.kind === 'park') return { type: 'conflict.resolved', payload: { conflictId: c.id, resolution: 'park', needId: r.needId, roundId: r.roundId } };
  return { type: 'conflict.resolved', payload: { conflictId: c.id, resolution: 'handoff', handoffId: r.handoffId, toId: r.toId, ask: r.ask, due: r.due } };
}

/**
 * The `extract.accepted` / `extract.ignored` command for a pending extract. `needId` is sent
 * only for `new` and `hyp` extracts (the ones that create a need); `roundId` is never sent,
 * so core fills the current round itself and marks it rule-filled (`autoRound`).
 */
export function extractCommand(a: 'accept' | 'ignore', input: Input, x: Extract, needId: Id): Cmd<'extract.accepted' | 'extract.ignored'> {
  if (a === 'ignore') return { type: 'extract.ignored', payload: { inputId: input.id, extractId: x.id } };
  const payload: EventPayloads['extract.accepted'] = { inputId: input.id, extractId: x.id };
  if (x.type === 'new' || x.type === 'hyp') payload.needId = needId;
  return { type: 'extract.accepted', payload };
}

/** The `proposal.accepted` / `proposal.rejected` command for an open agent proposal. */
export function proposalCommand(a: 'accept' | 'reject', p: Proposal, needId: Id, roundId: Id | null): Cmd<'proposal.accepted' | 'proposal.rejected'> {
  if (a === 'reject') return { type: 'proposal.rejected', payload: { proposalId: p.id } };
  return { type: 'proposal.accepted', payload: { proposalId: p.id, needId, roundId } };
}

// ---------------------------------------------------------------- Stale questions

export type StaleOption = 'park' | 'drop' | 'next';

/**
 * The ways to answer a stale question: an external need offers `drop`, a hypothesis offers
 * `park` (core has no `parked` for external needs and no `dropped` for hypotheses); both
 * offer `next` when a next round exists.
 */
export function staleOptions(n: Need, next: Round | null): StaleOption[] {
  const base: StaleOption = n.kind === 'ext' ? 'drop' : 'park';
  return next ? [base, 'next'] : [base];
}

/**
 * The commands for one stale option. `drop` and `park` just set the status; `next` moves the
 * need to the next round (and nothing else — a parked need is never asked again, so there is
 * no status to reset).
 */
export function staleCommands(o: StaleOption, n: Need, next: Round | null): Cmd[] {
  if (o === 'drop') return [{ type: 'need.status_set', payload: { needId: n.id, status: 'dropped' } }];
  if (o === 'park') return [{ type: 'need.status_set', payload: { needId: n.id, status: 'parked' } }];
  if (!next) return [];
  return [{ type: 'need.updated', payload: { needId: n.id, roundId: next.id } }];
}

// ---------------------------------------------------------------- Unlinked questions

/** The open needs of the project a work item could link to; shared work leaves out private needs. */
export function linkTargets(s: State, w: WorkItem): Need[] {
  const open = projectNeeds(s, w.projectId).filter(isOpen);
  return w.privateTo === null ? open.filter((n) => n.privateTo === null) : open;
}

/** What the rule would link an unlinked work item to, if anything. */
export function unlinkedSuggestion(s: State, w: WorkItem): Need | null {
  const m = matchNeed(w.text, linkTargets(s, w));
  return m ? s.needs[m.needId] ?? null : null;
}

/** Links (or corrects the link of) an unlinked work item to an existing need. */
export function linkCommand(w: WorkItem, needId: Id): Cmd<'work.linked'> {
  return { type: 'work.linked', payload: { workId: w.id, needId, effect: 'advance' } };
}

/** The work item is not worth linking; final. */
export function ignoreWorkCommand(w: WorkItem): Cmd<'work.ignored'> {
  return { type: 'work.ignored', payload: { workId: w.id } };
}

/**
 * Spawns a new hypothesis from an unlinked work item and links the work item to it. The need's
 * title and quote are the work item's own text; its source names where it came from (`ref`).
 */
export function newHypCommands(w: WorkItem, needId: Id, round: Round | null, me: Id, ref: string): [Cmd<'need.created'>, Cmd<'work.linked'>] {
  const created: Cmd<'need.created'> = {
    type: 'need.created',
    payload: {
      needId,
      projectId: w.projectId,
      kind: 'hyp',
      title: w.text,
      status: 'testing',
      roundId: round ? round.id : null,
      ownerId: me,
      source: { src: w.src, date: w.date, quote: w.text, ref },
      private: w.privateTo !== null,
    },
  };
  const linked: Cmd<'work.linked'> = { type: 'work.linked', payload: { workId: w.id, needId, effect: 'spawn' } };
  return [created, linked];
}
