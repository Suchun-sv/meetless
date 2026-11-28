/**
 * The needs board's view model: columns by DDL (one per round, plus Unscheduled), or by status
 * (todo / doing / done) when the project has no DDLs; the kind filter (all / external / hypothesis)
 * and the round filter; card data. Pure, no React or i18n: the screen renders from this.
 */
import { currentRound, projectRounds, toConfirm, userName, type Handoff, type Id, type IsoDate, type NeedKind, type NeedStatus, type Round, type State } from '@meetless/core';
import { boardColumns, boardViewFor, cardFacts, pendingNeedIds, type BoardColumn, type BoardFilter, type BoardView, type CardFacts } from '../../../../../desktop/src/renderer/needs/model';
import { ST_TONE, type Tone } from '../../../../../desktop/src/renderer/ui/tone';

export { boardViewFor, type BoardFilter, type BoardView, type Tone };

/** The kind filter chips, in order: all, external needs, hypotheses (`filter.all|ext|hyp`). */
export const KIND_FILTERS: readonly (NeedKind | null)[] = [null, 'ext', 'hyp'];

/** The tone a status is shown in (coloured text, never a dot). */
export function statusTone(s: NeedStatus): Tone {
  return ST_TONE[s];
}

/** A handoff as a line: who it is from or to (`ho.from` / `ho.to` / `ho.fromTo`) and its state (`ho.st.<state>`). */
export interface HandoffLineVM {
  dir: 'from' | 'to' | 'between';
  from: string;
  to: string;
  state: Handoff['state'];
  /** Sent to me and not yet answered: the info tone (never violet). */
  hot: boolean;
}

export function handoffLine(s: State, h: Handoff, me: Id): HandoffLineVM {
  const dir = h.toId === me ? 'from' : h.fromId === me ? 'to' : 'between';
  return { dir, from: userName(s, h.fromId), to: userName(s, h.toId), state: h.state, hot: h.toId === me && h.state === 'sent' };
}

export interface CardVM {
  id: Id;
  projectId: Id;
  code: string;
  title: string;
  kind: NeedKind;
  status: NeedStatus;
  tone: Tone;
  /** Only me (`pv.mine`). */
  private: boolean;
  /** `card.self`, or the name. */
  requester: CardFacts['requester'];
  /** Progress evidence count (`card.evidence`), 0 = not shown. */
  evidence: number;
  handoff: HandoffLineVM | null;
  /** To confirm is waiting on this need (`ask.btn`); shown only when there is no handoff. */
  pending: boolean;
  ownerId: Id | null;
  /** The footer row shows at all (a handoff, the pending mark or an owner). */
  footer: boolean;
}

export type ColumnHead =
  | { kind: 'round'; round: Round; title: string | null; n: number; due: IsoDate; delivered: boolean; daysLeft: number | null; current: boolean }
  | { kind: 'status'; status: 'todo' | 'doing' | 'done' }
  | { kind: 'unscheduled' };

export interface ColumnVM {
  key: string;
  head: ColumnHead;
  cards: CardVM[];
  /** Refuted hypotheses, folded apart (`col.refuted`). */
  refuted: CardVM[];
}

export interface BoardVM {
  columns: ColumnVM[];
  /** No DDLs: the columns are by status, and `board.noRounds` is shown. */
  noRounds: boolean;
  /** The project's rounds, for the round filter chips. */
  rounds: Round[];
  /** The column a phone shows first: the current round's, else the first not delivered, else 0. */
  initialIndex: number;
}

function cardVM(s: State, me: Id, n: BoardColumn['live'][number], pending: ReadonlySet<Id>): CardVM {
  const f = cardFacts(s, n, me, pending);
  return {
    id: n.id,
    projectId: n.projectId,
    code: n.code,
    title: n.title,
    kind: n.kind,
    status: n.status,
    tone: statusTone(n.status),
    private: n.privateTo !== null,
    requester: f.requester,
    evidence: f.evidence,
    handoff: f.handoff ? handoffLine(s, f.handoff, me) : null,
    pending: f.pending,
    ownerId: n.ownerId,
    footer: f.handoff !== null || f.pending || n.ownerId !== null,
  };
}

function headOf(col: BoardColumn, cur: Round | null): ColumnHead {
  if (col.round) {
    const r = col.round;
    return { kind: 'round', round: r, title: r.title || null, n: r.n, due: r.due, delivered: r.status === 'delivered', daysLeft: col.daysLeft, current: cur?.id === r.id };
  }
  if (col.status) return { kind: 'status', status: col.status };
  return { kind: 'unscheduled' };
}

export function boardVM(s: State, me: Id, projectId: Id, f: BoardFilter, today: IsoDate): BoardVM {
  const pending = pendingNeedIds(toConfirm(s, me, projectId, today));
  const cur = currentRound(s, projectId);
  const columns = boardColumns(s, projectId, f, today).map((col) => ({
    key: col.round?.id ?? col.status ?? 'unscheduled',
    head: headOf(col, cur),
    cards: col.live.map((n) => cardVM(s, me, n, pending)),
    refuted: col.refuted.map((n) => cardVM(s, me, n, pending)),
  }));
  let initialIndex = columns.findIndex((c) => c.head.kind === 'round' && c.head.current);
  if (initialIndex < 0) initialIndex = columns.findIndex((c) => c.head.kind === 'round' && !c.head.delivered);
  if (initialIndex < 0) initialIndex = 0;
  const rounds = projectRounds(s, projectId);
  return { columns, noRounds: rounds.length === 0, rounds, initialIndex };
}

/** `round.left` / `round.over` / `pg.noRound`: which key and its count for a day count. */
export function leftKey(days: number | null): { key: 'pg.noRound' } | { key: 'round.left' | 'round.over'; n: number } {
  if (days === null) return { key: 'pg.noRound' };
  return days < 0 ? { key: 'round.over', n: -days } : { key: 'round.left', n: days };
}

/**
 * The board's layout for a container width: under 720px one column at a time, picked with
 * tabs (`pager`); wider, side-by-side columns that scroll sideways, each at least 260px.
 */
export function boardLayout(width: number): { mode: 'pager' | 'columns'; colWidth: number } {
  if (width < 720) return { mode: 'pager', colWidth: width };
  return { mode: 'columns', colWidth: Math.max(260, Math.min(340, Math.floor((width - 16) / 4))) };
}
