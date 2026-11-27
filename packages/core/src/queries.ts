import { currentRound, lastFetchedVersion, needVersion } from './reducer';
import { daysBetween } from './text';
import {
  CLOSED_STATUSES,
  dashboardKey,
  type ChatMessage,
  type Conflict,
  type Handoff,
  type Id,
  type Input,
  type IsoDate,
  type Need,
  type NeedStatus,
  type Proposal,
  type Round,
  type State,
  type WorkItem,
} from './types';

const bySeq = <T extends { seq?: number; createdSeq?: number }>(a: T, b: T) => (a.seq ?? a.createdSeq ?? 0) - (b.seq ?? b.createdSeq ?? 0);

export function projectRounds(s: State, projectId: Id): Round[] {
  return Object.values(s.rounds).filter((r) => r.projectId === projectId).sort((a, b) => a.n - b.n);
}

/** The first planned round after the current one (null if there is none). */
export function nextRound(s: State, projectId: Id): Round | null {
  const n = currentRound(s, projectId)?.n ?? 0;
  return projectRounds(s, projectId).filter((r) => r.status === 'planned' && r.n > n)[0] ?? null;
}

/** Shared needs born from a delivered round's feedback (its lineage), oldest first. */
export function roundFeedback(s: State, roundId: Id): Need[] {
  return Object.values(s.needs)
    .filter((n) => n.privateTo === null && n.fromRoundId === roundId)
    .sort((a, b) => a.createdSeq - b.createdSeq);
}

/** One user's visible chat history with the project agent for a scope ('home' or a project id), oldest first. */
export function chatMessages(s: State, userId: Id, scope: Id): ChatMessage[] {
  const t = s.chats[dashboardKey(userId, scope)];
  if (!t) return [];
  return t.messages.filter((m) => m.seq > t.clearedSeq).sort((a, b) => a.seq - b.seq);
}

export function projectNeeds(s: State, projectId: Id): Need[] {
  return Object.values(s.needs).filter((n) => n.projectId === projectId).sort((a, b) => a.createdSeq - b.createdSeq);
}

export function projectWork(s: State, projectId: Id): WorkItem[] {
  return Object.values(s.work).filter((w) => w.projectId === projectId).sort(bySeq);
}

export function projectInputs(s: State, projectId: Id): Input[] {
  return Object.values(s.inputs).filter((i) => i.projectId === projectId).sort((a, b) => b.seq - a.seq);
}

export function needByCode(s: State, projectId: Id, code: string): Need | null {
  const c = code.trim().toUpperCase().replace(/^([NH])P/, '$1p');
  return Object.values(s.needs).find((n) => n.projectId === projectId && n.code === c) ?? null;
}

/** Work linked to a need (also as secondary link), oldest first. */
export function workFor(s: State, needId: Id): WorkItem[] {
  return Object.values(s.work).filter((w) => w.needId === needId || w.alsoNeedId === needId).sort(bySeq);
}

/** Progress = work that is not a project-agent capture and was not ignored. Agent reports over MCP count. */
export function isProgress(w: WorkItem): boolean {
  return !w.capture && !w.ignored;
}

export function isOpen(n: Need): boolean {
  return !CLOSED_STATUSES.has(n.status);
}

/** The handoff shown on a need: the latest one that was not declined. */
export function handoffForNeed(s: State, needId: Id): Handoff | null {
  const hs = Object.values(s.handoffs)
    .filter((h) => h.needId === needId && h.state !== 'declined')
    .sort((a, b) => a.createdSeq - b.createdSeq);
  return hs[hs.length - 1] ?? null;
}

export interface Staleness {
  fetched: number;
  current: number;
  /** The sender already asked for a refresh at the current version. */
  reminded: boolean;
}

/**
 * The recipient's agent fetched an older context version than the need has now.
 * Null when never fetched, or when the latest fetch is current.
 */
export function handoffStaleness(s: State, h: Handoff): Staleness | null {
  const need = s.needs[h.needId];
  const fetched = lastFetchedVersion(h);
  if (!need || fetched === null || h.state === 'done' || h.state === 'declined') return null;
  const current = needVersion(need);
  if (fetched >= current) return null;
  return { fetched, current, reminded: (h.refreshRequested?.version ?? 0) >= current };
}

/** The sender asked for a refresh and the recipient's agent has not fetched that version yet. */
export function refreshPending(h: Handoff): number | null {
  if (!h.refreshRequested) return null;
  const fetched = lastFetchedVersion(h) ?? 0;
  return fetched < h.refreshRequested.version ? h.refreshRequested.version : null;
}

export function openConflicts(s: State, projectId?: Id | null): Conflict[] {
  return Object.values(s.conflicts)
    .filter((c) => c.status !== 'resolved' && (!projectId || c.projectId === projectId))
    .sort((a, b) => a.openedSeq - b.openedSeq);
}

export function openProposals(s: State, projectId?: Id | null): Proposal[] {
  return Object.values(s.proposals)
    .filter((p) => p.status === 'open' && (!projectId || p.projectId === projectId))
    .sort(bySeq);
}

export function pendingExtracts(input: Input): number {
  return input.extracts.filter((x) => x.state === null).length;
}

export function inputStatus(input: Input): 'pending' | 'done' {
  return pendingExtracts(input) > 0 ? 'pending' : 'done';
}

// ---------------------------------------------------------------- To confirm

/** A shared need idle this many days (no progress) ... */
export const STALE_IDLE_DAYS = 10;
/** ... in a round due within this many days is asked about. */
export const STALE_DUE_DAYS = 7;

/** Something the rules cannot settle alone, asked of one person in To confirm. */
export type Question =
  | { kind: 'unlinked'; projectId: Id; workId: Id }
  | { kind: 'stale'; projectId: Id; needId: Id; idleDays: number; daysLeft: number };

export function questionId(q: Question): string {
  return q.kind === 'unlinked' ? `unlinked:${q.workId}` : `stale:${q.needId}`;
}

/** Not started. A parked hypothesis has been set aside on purpose, so it is not stale. */
const STALE_STATUSES: ReadonlySet<NeedStatus> = new Set<NeedStatus>(['todo', 'untested']);

/** Projects in creation order: one when named (archived or not), else all that are not archived. */
function projectsIn(s: State, projectId: Id | null): Id[] {
  return Object.values(s.projects)
    .filter((p) => (projectId === null ? !p.archived : p.id === projectId))
    .sort((a, b) => a.createdSeq - b.createdSeq)
    .map((p) => p.id);
}

/**
 * Questions for one user (rule-based):
 * - unlinked: work they recorded that is linked to no need and not ignored;
 * - stale: a shared open need they own (or created, without an owner) in the current round,
 *   not started, with no live handoff, idle STALE_IDLE_DAYS or more while the round is due
 *   within STALE_DUE_DAYS.
 */
export function questions(s: State, userId: Id, projectId: Id | null, today: IsoDate): Question[] {
  const out: Question[] = [];
  for (const pid of projectsIn(s, projectId)) {
    for (const w of projectWork(s, pid)) {
      if (w.needId === null && !w.ignored && w.by === userId) out.push({ kind: 'unlinked', projectId: pid, workId: w.id });
    }
    const r = currentRound(s, pid);
    if (!r) continue;
    const left = daysBetween(today, r.due);
    if (left < 0 || left > STALE_DUE_DAYS) continue;
    // The delegate's decision moves a conflict-decision handoff to `done`; the conflict check also covers a
    // delegation that was declined before the conflict was resolved.
    const live = new Set(
      Object.values(s.handoffs)
        .filter((h) => h.state !== 'declined' && h.state !== 'done' && !(h.conflictId !== null && s.conflicts[h.conflictId]?.status === 'resolved'))
        .map((h) => h.needId),
    );
    for (const n of projectNeeds(s, pid)) {
      if (n.privateTo !== null || !isOpen(n) || n.roundId !== r.id || !STALE_STATUSES.has(n.status)) continue;
      if ((n.ownerId ?? n.createdBy) !== userId || live.has(n.id)) continue;
      const last = workFor(s, n.id).filter(isProgress).reduce((d, w) => (w.date > d ? w.date : d), n.source.date);
      const idleDays = daysBetween(last, today);
      if (idleDays >= STALE_IDLE_DAYS) out.push({ kind: 'stale', projectId: pid, needId: n.id, idleDays, daysLeft: left });
    }
  }
  return out;
}

export interface PendingExtract {
  projectId: Id;
  inputId: Id;
  extractId: Id;
}

/** Undecided extracts of inputs the user imported. Conflict-flagged extracts of shared inputs are conflicts, not extracts. */
export function pendingExtractsFor(s: State, userId: Id, projectId: Id | null): PendingExtract[] {
  const out: PendingExtract[] = [];
  for (const pid of projectsIn(s, projectId)) {
    for (const i of [...projectInputs(s, pid)].reverse()) {
      if (i.importedBy !== userId) continue;
      for (const x of i.extracts) {
        if (x.state === null && !(x.conflict && i.privateTo === null)) out.push({ projectId: pid, inputId: i.id, extractId: x.id });
      }
    }
  }
  return out;
}

export interface ToConfirm {
  conflicts: Conflict[];
  proposals: Proposal[];
  extracts: PendingExtract[];
  questions: Question[];
  count: number;
}

/**
 * "To confirm" for one user: conflicts they decide (or, while open, whose need they own),
 * open agent proposals, their pending extracts and their questions. `projectId` null = all projects.
 */
export function toConfirm(s: State, userId: Id, projectId: Id | null, today: IsoDate): ToConfirm {
  const conflicts = openConflicts(s, projectId).filter((c) => c.deciderId === userId || (c.status === 'open' && s.needs[c.needId]?.ownerId === userId));
  const proposals = openProposals(s, projectId);
  const extracts = pendingExtractsFor(s, userId, projectId);
  const qs = questions(s, userId, projectId, today);
  return { conflicts, proposals, extracts, questions: qs, count: conflicts.length + proposals.length + extracts.length + qs.length };
}

/** Handoffs sent to the user and not yet answered. A conflict-decision handoff is counted in To confirm instead. */
function sentToMe(s: State, userId: Id, projectId: Id): Handoff[] {
  return Object.values(s.handoffs).filter((h) => h.projectId === projectId && h.toId === userId && h.state === 'sent' && h.conflictId === null);
}

export function daysLeft(round: Pick<Round, 'due'>, today: string): number {
  return daysBetween(today, round.due);
}

export function membersOf(s: State, projectId: Id): Id[] {
  return s.projects[projectId]?.memberIds ?? [];
}

/** Roles of a project in creation order, with members; members without a role are listed last. */
export function rolesOf(s: State, projectId: Id): { roleId: Id | null; name: string | null; memberIds: Id[] }[] {
  const roles = Object.values(s.roles)
    .filter((r) => r.projectId === projectId)
    .sort((a, b) => a.createdSeq - b.createdSeq)
    .map((r) => ({ roleId: r.id as Id | null, name: r.name as string | null, memberIds: [...r.memberIds] }));
  const inRole = new Set(roles.flatMap((r) => r.memberIds));
  const rest = membersOf(s, projectId).filter((m) => !inRole.has(m));
  if (rest.length) roles.push({ roleId: null, name: null, memberIds: rest });
  return roles;
}

export function currentOrLatestRound(s: State, projectId: Id): Round | null {
  return currentRound(s, projectId) ?? projectRounds(s, projectId).filter((r) => r.status !== 'delivered')[0] ?? projectRounds(s, projectId).at(-1) ?? null;
}

export function userName(s: State, id: Id | null | undefined): string {
  if (!id) return '';
  return s.users[id]?.displayName ?? id;
}

/** Badge counts for the sidebar: inputs to process; on the board, handoffs sent to the user + "To confirm" (each item once). */
export function projectBadges(s: State, userId: Id, projectId: Id, today: IsoDate): { inputs: number; board: number; total: number } {
  const inputs = projectInputs(s, projectId).filter((i) => inputStatus(i) === 'pending').length;
  const board = sentToMe(s, userId, projectId).length + toConfirm(s, userId, projectId, today).count;
  return { inputs, board, total: board };
}
