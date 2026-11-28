/**
 * 待确认's view model: my items (conflicts, questions, detected extracts, agent proposals), the
 * conflicts waiting on someone else, and every way to answer them: accept / ignore an extract
 * (with its due date changed or cleared first), 全部接受 (parents before children, one DDL per
 * day), and the three conflict answers (revise, keep and park the new ask, hand the decision
 * off). The item list and command builders are the old renderer's collab/confirm.ts, imported.
 */
import {
  currentOrLatestRound,
  nextRound,
  projectRounds,
  toConfirm,
  userName,
  type Conflict,
  type Extract as CoreExtract,
  type Id,
  type IsoDate,
  type Need,
  type Proposal,
  type Round,
  type State,
  type WorkItem,
} from '@meetless/core';
import { acceptCommands, confirmItems, conflictCommand, linkTargets, staleOptions, unlinkedSuggestion, waitingConflicts, type ConfirmItem, type StaleOption } from '../../../../../desktop/src/renderer/collab/confirm';
import { handoffPeople, roundDue, type Cmd } from '../../../../../desktop/src/renderer/collab/model';
import { newId } from '../../../../../desktop/src/renderer/model/ids';

export {
  acceptCommands,
  confirmItems,
  conflictCommand,
  extractCommand,
  ignoreWorkCommand,
  linkCommand,
  newHypCommands,
  proposalCommand,
  staleCommands,
  waitingConflicts,
  type ConfirmItem,
  type StaleOption,
} from '../../../../../desktop/src/renderer/collab/confirm';

export type ConflictEntry = Extract<ConfirmItem, { kind: 'conflict' }>;
export type QuestionEntry = Extract<ConfirmItem, { kind: 'question' }>;
export type ExtractEntry = Extract<ConfirmItem, { kind: 'extract' }>;
export type ProposalEntry = Extract<ConfirmItem, { kind: 'proposal' }>;

/** The To-confirm count for a badge. */
export function confirmCount(s: State, me: Id, projectId: Id, today: IsoDate): number {
  return toConfirm(s, me, projectId, today).count;
}

// ---------------------------------------------------------------- Conflicts

export type ConflictWhy = { kind: 'delegated'; who: string } | { kind: 'decider' } | { kind: 'owner' };

export interface ConflictVM {
  code: string | null;
  old: string;
  neu: string;
  src: string;
  /** Why it is mine: `cf.whyDelegated` / `cf.why` / `cf.whyOwner`. */
  why: ConflictWhy;
  /** Keep the need and park the new ask under one of these DDLs, or none (`cf.parkNone`). */
  parkRounds: Round[];
  /** Who the decision can go to (never me), with their role or null (`ho.noRole`). Empty: `ho.nobody`. */
  people: { id: Id; name: string; role: string | null }[];
}

export function conflictVM(s: State, me: Id, projectId: Id, item: ConflictEntry): ConflictVM {
  const c = item.conflict;
  const why: ConflictWhy = item.delegatedBy ? { kind: 'delegated', who: userName(s, item.delegatedBy) } : c.deciderId === me ? { kind: 'decider' } : { kind: 'owner' };
  return {
    code: s.needs[c.needId]?.code ?? null,
    old: c.old,
    neu: c.neu,
    src: c.src,
    why,
    parkRounds: projectRounds(s, projectId).filter((r) => r.status !== 'delivered'),
    people: handoffPeople(s, projectId, me).flatMap((g) => g.memberIds.map((id) => ({ id, name: userName(s, id), role: g.roleName }))),
  };
}

/** The `revise` answer: the need takes the new wording. */
export function reviseAnswer(c: Conflict): Cmd[] {
  return [conflictCommand(c, { kind: 'revise' })];
}

/** The `park` answer: the need stays, the new ask becomes its own need under `roundId` (or none). */
export function parkAnswer(c: Conflict, roundId: Id | null, needId: Id = newId('n')): Cmd[] {
  return [conflictCommand(c, { kind: 'park', needId, roundId })];
}

/**
 * The `handoff` answer: a decision handoff to `toId`, due on the current (or latest) DDL while it
 * is open and not past, else with no due date. `ask` is the `cf.handoffAsk` text.
 */
export function handoffAnswer(s: State, projectId: Id, c: Conflict, toId: Id, ask: string, today: IsoDate, handoffId: Id = newId('h')): Cmd[] {
  const due = roundDue(currentOrLatestRound(s, projectId), today);
  return [conflictCommand(c, { kind: 'handoff', handoffId, toId, ask, due })];
}

// ---------------------------------------------------------------- Extracts

export interface ExtractVM {
  type: CoreExtract['type'];
  inputTitle: string;
  text: string;
  /** A later message already did it (`ask.alreadyDone`). */
  met: boolean;
  /** For a revision: the need it revises. */
  revNeedId: Id | null;
  /** `new` and `hyp` carry a due date that can be changed or cleared (`ask.due`, `ask.dueClear`). */
  datable: boolean;
  /** The due date the text gave. */
  due: IsoDate | null;
  /** Found by the AI model (violet `ai.deepseek`), else by the rule (`RulesMark`). */
  ai: boolean;
  /** What it hangs under: another item of the same input, or an existing need. */
  under: { kind: 'item'; text: string } | { kind: 'need'; id: Id; code: string } | null;
}

export function extractVM(s: State, item: ExtractEntry): ExtractVM {
  const { input, extract: x } = item;
  let under: ExtractVM['under'] = null;
  if (x.parent) {
    const sib = input.extracts.find((y) => y.id === x.parent);
    if (sib) under = sib.resultNeedId && s.needs[sib.resultNeedId] ? { kind: 'need', id: sib.resultNeedId, code: s.needs[sib.resultNeedId]!.code } : { kind: 'item', text: sib.text };
    else if (s.needs[x.parent]) under = { kind: 'need', id: x.parent, code: s.needs[x.parent]!.code };
  }
  return {
    type: x.type,
    inputTitle: input.title,
    text: x.text,
    met: x.met,
    revNeedId: x.type === 'rev' ? x.needId : null,
    datable: x.type === 'new' || x.type === 'hyp',
    due: x.due ?? null,
    ai: input.detector.startsWith('deepseek'),
    under,
  };
}

/** Accepting one extract, with its due date as changed in To confirm (`undefined` = the extract's own). */
export function acceptAnswer(s: State, item: ExtractEntry, today: IsoDate, due?: IsoDate | null, needId: Id = newId('n')): Cmd[] {
  const d = due === undefined ? item.extract.due ?? null : due;
  return acceptCommands(s, item.input, item.extract, needId, today, d);
}

/**
 * The extracts 全部接受 takes: every pending extract except a conflicting revision of a shared
 * input (that one is decided as a conflict, never in bulk).
 */
export function bulkExtracts(items: readonly ConfirmItem[]): ExtractEntry[] {
  return items.filter((i): i is ExtractEntry => i.kind === 'extract' && !(i.extract.conflict && i.input.privateTo === null));
}

/**
 * Parents before children: an extract whose parent is another extract of the same input in
 * `xs` comes after it (at any depth), so a hypothesis accepted in the same batch hangs under its
 * need. Otherwise the given order.
 */
export function parentsFirst(xs: readonly ExtractEntry[]): ExtractEntry[] {
  const byKey = new Map(xs.map((x) => [x.id, x]));
  const out: ExtractEntry[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();
  const place = (x: ExtractEntry) => {
    if (placed.has(x.id) || visiting.has(x.id)) return;
    visiting.add(x.id);
    const p = x.extract.parent ? byKey.get(`${x.input.id}:${x.extract.parent}`) : undefined;
    if (p) place(p);
    visiting.delete(x.id);
    placed.add(x.id);
    out.push(x);
  };
  for (const x of xs) place(x);
  return out;
}

/**
 * 全部接受's commands, in order: `bulkExtracts`, parents first, each with its due date as changed
 * in To confirm (`dues`, keyed by item id; absent = the extract's own), two items due the same
 * day sharing one new DDL. `ids` are the item ids it answers.
 */
export function acceptAllPlan(
  s: State,
  items: readonly ConfirmItem[],
  today: IsoDate,
  dues: ReadonlyMap<string, IsoDate | null> = new Map(),
  needId: () => Id = () => newId('n'),
): { ids: string[]; cmds: Cmd[] } {
  // One map of new DDLs per project: two items due the same day share a DDL only within a project.
  const made = new Map<Id, Map<IsoDate, Id>>();
  const ordered = parentsFirst(bulkExtracts(items));
  const cmds = ordered.flatMap((x) => {
    const due = dues.has(x.id) ? dues.get(x.id)! : x.extract.due ?? null;
    const m = made.get(x.input.projectId) ?? new Map<IsoDate, Id>();
    made.set(x.input.projectId, m);
    return acceptCommands(s, x.input, x.extract, needId(), today, due, m);
  });
  return { ids: ordered.map((x) => x.id), cmds };
}

// ---------------------------------------------------------------- Questions and proposals

export type QuestionVM =
  | { kind: 'unlinked'; work: WorkItem; suggestion: Need | null; others: Need[] }
  | { kind: 'stale'; need: Need; idle: number; left: number; options: StaleOption[]; next: Round | null }
  | { kind: 'missing' };

export function questionVM(s: State, projectId: Id, item: QuestionEntry): QuestionVM {
  const q = item.question;
  if (q.kind === 'unlinked') {
    const w = s.work[q.workId];
    if (!w) return { kind: 'missing' };
    const suggestion = unlinkedSuggestion(s, w);
    return { kind: 'unlinked', work: w, suggestion, others: linkTargets(s, w).filter((n) => n.id !== suggestion?.id) };
  }
  const n = s.needs[q.needId];
  if (!n) return { kind: 'missing' };
  const next = nextRound(s, projectId);
  return { kind: 'stale', need: n, idle: q.idleDays, left: q.daysLeft, options: staleOptions(n, next), next };
}

export interface ProposalVM {
  proposal: Proposal;
  by: string;
  /** The agent client, else null (`src.agent`). */
  client: string | null;
}

export function proposalVM(s: State, item: ProposalEntry): ProposalVM {
  const p = item.proposal;
  return { proposal: p, by: userName(s, p.by), client: p.via?.client ?? null };
}

/** The DDL an accepted proposal goes under: the current one, else the latest open, else the last. */
export function proposalRound(s: State, projectId: Id): Id | null {
  return currentOrLatestRound(s, projectId)?.id ?? null;
}

// ---------------------------------------------------------------- The panel

export interface ConfirmPanelVM {
  items: ConfirmItem[];
  /** Conflicts waiting on someone else: muted, no buttons (`cf.q`, `ask.waiting`). */
  waiting: { conflict: Conflict; code: string | null; decider: string }[];
  /** How many extracts 全部接受 would take; 0 = no button. */
  bulk: number;
}

/** The panel's lists, leaving out what was answered in this session (`answered` item ids). */
export function confirmPanelVM(s: State, me: Id, projectId: Id | null, today: IsoDate, answered: ReadonlySet<string>): ConfirmPanelVM {
  // `null` = every project (the 待确认 tab); core's queries take null for all.
  const open = confirmItems(s, me, projectId as Id, today).filter((i) => !answered.has(i.id));
  return {
    items: open,
    waiting: waitingConflicts(s, me, projectId as Id).map(({ conflict, deciderId }) => ({ conflict, code: s.needs[conflict.needId]?.code ?? null, decider: userName(s, deciderId) })),
    bulk: bulkExtracts(open).length,
  };
}
