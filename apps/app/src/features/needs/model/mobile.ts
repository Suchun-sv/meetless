/**
 * Phone 需求 view model (mobile-v1 02): 下一步 (up to three open needs worth doing next, each with
 * a one-line reason), the current deadline's needs with hypotheses nested under their parent,
 * and 其他截止 (the upcoming deadlines, then a fold for the past ones and the unscheduled needs).
 */
import {
  clip,
  currentOrLatestRound,
  daysLeft,
  isOpen,
  projectNeeds,
  projectRounds,
  workFor,
  type Handoff,
  type Id,
  type IsoDate,
  type Need,
  type Round,
  type State,
} from '@meetless/core';
import { liveHandoffs } from '../../../../../desktop/src/renderer/needs/model';

export type NextReason =
  | { kind: 'handoff'; code: string; h: Handoff }
  | { kind: 'notStarted'; code: string }
  | { kind: 'progress'; code: string; text: string }
  | { kind: 'status'; code: string; status: Need['status'] };

export interface NextStep {
  need: Need;
  reason: NextReason;
}

/** Open needs to do next, in this order: handed to me and unanswered, mine not started, in progress (latest report), the rest. */
export function nextSteps(s: State, me: Id, needs: readonly Need[], max = 3): NextStep[] {
  const ranked = needs
    .filter((n) => isOpen(n) && n.status !== 'refuted')
    .map((n) => {
      const h = liveHandoffs(s, n.id).find((x) => x.toId === me && (x.state === 'sent' || x.state === 'asked' || x.state === 'accepted' || x.state === 'doing'));
      if (h) return { n, rank: 0, reason: { kind: 'handoff', code: n.code, h } as NextReason };
      const last = workFor(s, n.id).filter((w) => !w.ignored && !w.capture).at(-1);
      const mine = n.ownerId === me || n.ownerId === null;
      if ((n.status === 'todo' || n.status === 'untested') && mine) return { n, rank: 1, reason: { kind: 'notStarted', code: n.code } as NextReason };
      if (last) return { n, rank: 2, reason: { kind: 'progress', code: n.code, text: clip(last.text, 40) } as NextReason };
      return { n, rank: 3, reason: { kind: 'status', code: n.code, status: n.status } as NextReason };
    })
    .sort((a, b) => a.rank - b.rank || a.n.createdSeq - b.n.createdSeq);
  return ranked.slice(0, max).map((x) => ({ need: x.n, reason: x.reason }));
}

export interface NeedRow {
  need: Need;
  /** Nested under its parent in this list (a hypothesis under its need). */
  nested: boolean;
}

/** Needs in list order: each top-level need followed by the children in the same list (any depth), then the rest. */
export function nestedRows(needs: readonly Need[]): NeedRow[] {
  const ids = new Set(needs.map((n) => n.id));
  const kids = new Map<Id, Need[]>();
  for (const n of needs) if (n.parentId && ids.has(n.parentId)) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  const out: NeedRow[] = [];
  const seen = new Set<Id>();
  const walk = (n: Need, nested: boolean) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    out.push({ need: n, nested });
    for (const k of kids.get(n.id) ?? []) walk(k, true);
  };
  // External needs first, then hypotheses with no parent here; creation order within each.
  const tops = needs.filter((n) => !(n.parentId && ids.has(n.parentId)));
  for (const n of [...tops.filter((n) => n.kind === 'ext'), ...tops.filter((n) => n.kind !== 'ext')]) walk(n, false);
  return out;
}

export interface DeadlineGroup {
  round: Round | null;
  rows: NeedRow[];
}

export interface MobileNeedsVM {
  current: Round | null;
  /** Days left on the current deadline, null without one. */
  left: number | null;
  next: NextStep[];
  /** The current deadline's needs (all needs when the project has no deadline). */
  rows: NeedRow[];
  /** Deadlines after (or besides) the current one, by date, with their needs. */
  others: DeadlineGroup[];
  /** Delivered or past deadlines, folded. */
  past: DeadlineGroup[];
  /** Needs under no deadline (only while there is a current deadline). */
  unscheduled: NeedRow[];
}

export function mobileNeedsVM(s: State, me: Id, projectId: Id, today: IsoDate): MobileNeedsVM {
  const needs = projectNeeds(s, projectId);
  const rounds = projectRounds(s, projectId);
  const open = rounds.filter((r) => r.status !== 'delivered');
  const cur = currentOrLatestRound(s, projectId);
  const current = cur && cur.status !== 'delivered' ? cur : (open[0] ?? null);
  const inRound = (r: Round) => needs.filter((n) => n.roundId === r.id);
  const rows = current ? nestedRows(inRound(current)) : nestedRows(needs);
  const byDue = (a: Round, b: Round) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.n - b.n);
  const others = open
    .filter((r) => r.id !== current?.id)
    .sort(byDue)
    .map((r) => ({ round: r, rows: nestedRows(inRound(r)) }));
  const past = rounds
    .filter((r) => r.status === 'delivered')
    .sort(byDue)
    .reverse()
    .map((r) => ({ round: r, rows: nestedRows(inRound(r)) }));
  const unscheduled = current ? nestedRows(needs.filter((n) => n.roundId === null)) : [];
  return {
    current,
    left: current ? daysLeft(current, today) : null,
    next: nextSteps(s, me, rows.map((r) => r.need)),
    rows,
    others,
    past,
    unscheduled,
  };
}
