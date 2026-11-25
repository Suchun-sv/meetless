/**
 * Pure derived data for the needs board (contract §2): board columns, card facts,
 * lineage groups and the drawer's lists. No React, no i18n — Task 3 (board page) and
 * Task 5 (drawer) render from this.
 */
import {
  currentRound,
  daysLeft,
  handoffForNeed,
  isProgress,
  projectNeeds,
  projectRounds,
  roundFeedback,
  userName,
  workFor,
  type Artifact,
  type Handoff,
  type Id,
  type IsoDate,
  type Need,
  type NeedKind,
  type Round,
  type SourceKind,
  type State,
  type ToConfirm,
  type WorkItem,
} from '@meetless/core';

export interface BoardFilter {
  kind: NeedKind | null;
  round: number | null;
}

/** The board page's own view state, held for one project at a time. */
export interface BoardView extends BoardFilter {
  projectId: Id | null;
  mode: 'rounds' | 'lineage';
}

/**
 * The board's view state for `projectId`: `v` while it was set on that project, else the defaults
 * (rounds, no kind or round filter). The page is not remounted on a board-to-board move, so a
 * "Round 3" filter must not carry over to a project without a round 3.
 */
export function boardViewFor(v: BoardView, projectId: Id | null): BoardView {
  return v.projectId === projectId ? v : { projectId, mode: 'rounds', kind: null, round: null };
}

export interface BoardColumn {
  round: Round | null;
  live: Need[];
  refuted: Need[];
  daysLeft: number | null;
}

/** External needs before hypotheses; otherwise the original (createdSeq) order. */
function orderLive(ns: Need[]): Need[] {
  return [...ns].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'ext' ? -1 : 1));
}

/**
 * The board's columns: one per round (filtered by `f.round`), in round order, plus a
 * trailing column for needs with no round when `f.round` is null and some exist. Refuted
 * hypotheses are split out of `live`; only the current round carries a day count.
 */
export function boardColumns(s: State, projectId: Id, f: BoardFilter, today: IsoDate): BoardColumn[] {
  const needs = projectNeeds(s, projectId).filter((n) => f.kind === null || n.kind === f.kind);
  const cur = currentRound(s, projectId);
  const column = (round: Round | null, ns: Need[]): BoardColumn => {
    const refuted = ns.filter((n) => n.status === 'refuted');
    const live = orderLive(ns.filter((n) => n.status !== 'refuted'));
    return { round, live, refuted, daysLeft: round && cur && round.id === cur.id ? daysLeft(round, today) : null };
  };
  const columns = projectRounds(s, projectId)
    .filter((r) => f.round === null || r.n === f.round)
    .map((r) => column(r, needs.filter((n) => n.roundId === r.id)));
  if (f.round === null) {
    const unscheduled = needs.filter((n) => n.roundId === null);
    if (unscheduled.length) columns.push(column(null, unscheduled));
  }
  return columns;
}

/** Sources that count as real progress evidence on a board card (not a chat remark or a meeting note). */
export const EVIDENCE_SRC: ReadonlySet<SourceKind> = new Set<SourceKind>(['exp', 'commit', 'doc', 'file', 'agent']);

export interface CardFacts {
  evidence: number;
  requester: { self: true } | { self: false; name: string };
  handoff: Handoff | null;
  pending: boolean;
}

/** Who raised a need: a member or an outside name. */
export type RaisedBy = { userId: Id } | { name: string };

/**
 * Who raised a need: its own requester (a member, else an outside name), else whoever created it.
 * `withCreator: false` leaves out that fallback (a feedback quote names its speaker or no one).
 * The one place this is derived: the card, the drawer's `dr.requester` and the lineage quotes.
 */
export function raisedBy(n: Need, withCreator = true): RaisedBy | null {
  const r = n.requester;
  if (r?.userId) return { userId: r.userId };
  if (r?.name) return { name: r.name };
  return withCreator ? { userId: n.createdBy } : null;
}

/** `raisedBy` for `me`: myself, or the member's display name or the outside name. */
export function requesterFacts(s: State, n: Need, me: Id): CardFacts['requester'] {
  const r = raisedBy(n)!;
  if ('name' in r) return { self: false, name: r.name };
  return r.userId === me ? { self: true } : { self: false, name: userName(s, r.userId) };
}

/** Facts a board card shows: progress evidence, who asked, the handoff in play and To-confirm pending state. */
export function cardFacts(s: State, n: Need, me: Id, pending: ReadonlySet<Id>): CardFacts {
  const evidence = workFor(s, n.id).filter((w) => isProgress(w) && EVIDENCE_SRC.has(w.src)).length;
  return { evidence, requester: requesterFacts(s, n, me), handoff: shownHandoff(s, n.id), pending: pending.has(n.id) };
}

/**
 * The handoff shown on a need: `handoffForNeed` (declined ones are already excluded there).
 * A conflict-decision handoff that the delegate resolved directly is no longer hidden: core
 * itself moves it to `done` when the delegate resolves the conflict (contract 12.11 I1), so
 * it is shown done rather than dropped.
 */
export function shownHandoff(s: State, needId: Id): Handoff | null {
  return handoffForNeed(s, needId);
}

/** Handoff states that can still be acted on (`done` and `declined` are terminal). */
const LIVE_HANDOFF: ReadonlySet<Handoff['state']> = new Set<Handoff['state']>(['sent', 'asked', 'accepted', 'doing', 'returned']);

/**
 * Every handoff on a need that is still live, newest first. Core accepts a second `handoff.created`
 * on a need while an earlier one is still open; the drawer renders a block for each, so the earlier
 * one can still be returned, confirmed or reopened.
 */
export function liveHandoffs(s: State, needId: Id): Handoff[] {
  return Object.values(s.handoffs)
    .filter((h) => h.needId === needId && LIVE_HANDOFF.has(h.state))
    .sort((a, b) => b.createdSeq - a.createdSeq);
}

/** The need ids "To confirm" is waiting on: the conflicts' needs, plus the stale questions' needs. */
export function pendingNeedIds(tc: ToConfirm): Set<Id> {
  const ids = new Set<Id>();
  for (const c of tc.conflicts) ids.add(c.needId);
  for (const q of tc.questions) if (q.kind === 'stale') ids.add(q.needId);
  return ids;
}

/** Opening quote marks and their closing pair. */
const QUOTE_PAIRS: Readonly<Record<string, string>> = { '“': '”', '「': '」', '『': '』', '‘': '’', '"': '"', "'": "'" };

/** A quote in quote marks: the text as it is when it already starts and ends with a matching pair, else wrapped in “ ”. */
export function quoted(text: string): string {
  const t = text.trim();
  const close = QUOTE_PAIRS[t[0] ?? ''];
  if (close !== undefined && t.length > 1 && t.endsWith(close)) return t;
  return `“${t}”`;
}

export interface LineageGroup {
  round: Round | null;
  quotes: { text: string; who: string | null }[];
  roots: Need[];
}

function quoteWho(s: State, n: Need): string | null {
  const r = raisedBy(n, false);
  if (!r) return null;
  return 'name' in r ? r.name : userName(s, r.userId);
}

/**
 * Lineage: shared roots (no parent; a private need is never a root, even for its owner),
 * grouped by the round whose feedback produced them — direct roots (no `fromRoundId`)
 * first, then one group per round that has roots, in round order.
 */
export function lineageGroups(s: State, projectId: Id): LineageGroup[] {
  const roots = projectNeeds(s, projectId).filter((n) => n.privateTo === null && n.parentId === null);
  const groups: LineageGroup[] = [];
  const direct = roots.filter((n) => n.fromRoundId === null);
  if (direct.length) groups.push({ round: null, quotes: [], roots: direct });
  for (const r of projectRounds(s, projectId)) {
    const rs = roots.filter((n) => n.fromRoundId === r.id);
    if (!rs.length) continue;
    const quotes = roundFeedback(s, r.id).map((n) => ({ text: n.source.quote, who: quoteWho(s, n) }));
    groups.push({ round: r, quotes, roots: rs });
  }
  return groups;
}

/** A need's children visible in `s`: a private child is never listed under a shared parent. */
export function childrenOf(s: State, needId: Id): Need[] {
  const parent = s.needs[needId];
  const sharedParent = parent?.privateTo === null;
  return Object.values(s.needs)
    .filter((n) => n.parentId === needId && !(sharedParent && n.privateTo !== null))
    .sort((a, b) => a.createdSeq - b.createdSeq);
}

/** Work on a need for the drawer: newest first, with ignored work left out (captures stay). */
export function drawerWork(s: State, needId: Id): WorkItem[] {
  return workFor(s, needId)
    .filter((w) => !w.ignored)
    .reverse();
}

/** Artifacts linked to a need, oldest first. */
export function needArtifacts(s: State, needId: Id): Artifact[] {
  return Object.values(s.artifacts)
    .filter((a) => a.needIds.includes(needId))
    .sort((a, b) => a.seq - b.seq);
}
