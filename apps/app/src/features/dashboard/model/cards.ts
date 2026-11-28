import { cardsFor, membersOf, projectRounds, WIDE_CARDS, type CardId, type EventPayloads, type Id, type IsoTime, type State } from '@meetless/core';

/*
 * The dashboard card set and its grid, for both a project dashboard and Home (scope 'home').
 * The payloads are the desktop renderer's `dash/model.ts` ones, repeated because that module
 * also pulls in the desktop overlay components.
 */

export type DashSet = EventPayloads['dashboard.set'];
type CardSet = { cards: CardId[]; refreshed: Record<string, string> };

/** The `dashboard.set` payload for adding `card`: appended when not already there, its refresh stamp `now`. */
export function addCardPayload(cur: CardSet, scope: Id, card: CardId, now: IsoTime): DashSet {
  const cards = cur.cards.includes(card) ? cur.cards : [...cur.cards, card];
  return { scope, cards, refreshed: { ...cur.refreshed, [card]: now } };
}

/** The `dashboard.set` payload for dropping `card`, and its stamp with it (the timeline keeps its stamp, so `cardsFor` does not add it back). */
export function removeCardPayload(cur: CardSet, scope: Id, card: CardId): DashSet {
  const { [card]: _dropped, ...refreshed } = cur.refreshed;
  if (card === 'timeline') refreshed.timeline = cur.refreshed.timeline ?? new Date().toISOString();
  return { scope, cards: cur.cards.filter((c) => c !== card), refreshed };
}

/** The `dashboard.set` payload for re-stamping `card` as refreshed `now`. */
export function refreshCardPayload(cur: CardSet, scope: Id, card: CardId, now: IsoTime): DashSet {
  return { scope, cards: cur.cards, refreshed: { ...cur.refreshed, [card]: now } };
}

/** The stamp a card shows: its own, or the time the page opened when it has none. */
export function cardStamp(refreshed: Record<string, string>, card: CardId, openedAt: IsoTime): IsoTime {
  return (refreshed[card] ?? openedAt) as IsoTime;
}

/** Container width (px) from which the grid has two columns; below it, one. */
export const TWO_COLUMNS_FROM = 880;

export interface GridRow {
  key: string;
  /** One card spanning the row (a wide card, or any card in one column), or two side by side. A lone narrow card before a wide one keeps half the row. */
  cards: CardId[];
  wide: boolean;
}

/**
 * The cards in rows for a container `width` px wide, as the desktop CSS grid places them: two
 * columns from TWO_COLUMNS_FROM, wide cards (`WIDE_CARDS`) spanning both, narrow ones paired in
 * order. One column below that.
 */
export function gridRows(cards: CardId[], width: number): GridRow[] {
  if (width < TWO_COLUMNS_FROM) return cards.map((c) => ({ key: c, cards: [c], wide: true }));
  const rows: GridRow[] = [];
  let half: CardId[] = [];
  const flush = () => {
    if (half.length) rows.push({ key: half.join('+'), cards: half, wide: false });
    half = [];
  };
  for (const c of cards) {
    if (WIDE_CARDS.has(c)) {
      flush();
      rows.push({ key: c, cards: [c], wide: true });
    } else {
      half.push(c);
      if (half.length === 2) flush();
    }
  }
  flush();
  return rows;
}

export interface DashView {
  cards: CardId[];
  refreshed: Record<string, string>;
  /** The setup strip: shown while the project has only its creator, or no rounds. */
  setupMembers: boolean;
  setupRounds: boolean;
}

/** A project dashboard: its card set and whether the setup strip shows. */
export function projectDash(s: State, me: Id, projectId: Id): DashView {
  const { cards, refreshed } = cardsFor(s, me, projectId);
  return { cards, refreshed, setupMembers: membersOf(s, projectId).length <= 1, setupRounds: projectRounds(s, projectId).length === 0 };
}

/** The width of a progress bar, 0..100; a bar, never a dot (the screen keeps a minimum width so near 0 still shows). */
export function barPct(a: number, b: number): number {
  return b ? Math.round((a / b) * 100) : 0;
}
