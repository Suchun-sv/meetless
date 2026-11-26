import {
  CLOSED_STATUSES,
  clip,
  questionId,
  questions,
  SEP,
  type CardId,
  type EventPayloads,
  type HomeItems,
  type Id,
  type IsoDate,
  type IsoTime,
  type Risk,
  type State,
} from '@meetless/core';
import type { Translator } from '@meetless/i18n';
import type { Overlay } from '../app/overlays';
import type { Route } from '../app/routes';

export type DashSet = EventPayloads['dashboard.set'];

/**
 * The `dashboard.set` payload for adding `card` to `cur`'s card set: appends the card when it is
 * not already there, stamps its refresh time as `now`, and keeps every other card's stamp.
 */
export function addCardPayload(cur: { cards: CardId[]; refreshed: Record<string, string> }, scope: Id, card: CardId, now: IsoTime): DashSet {
  const cards = cur.cards.includes(card) ? cur.cards : [...cur.cards, card];
  return { scope, cards, refreshed: { ...cur.refreshed, [card]: now } };
}

/** The `dashboard.set` payload for dropping `card` from `cur`'s card set, and its stamp with it. */
export function removeCardPayload(cur: { cards: CardId[]; refreshed: Record<string, string> }, scope: Id, card: CardId): DashSet {
  const { [card]: _dropped, ...refreshed } = cur.refreshed;
  // The timeline keeps its stamp when removed, so `cardsFor` does not add it back to the set.
  if (card === 'timeline') refreshed.timeline = cur.refreshed.timeline ?? new Date().toISOString();
  return { scope, cards: cur.cards.filter((c) => c !== card), refreshed };
}

/** The `dashboard.set` payload for re-stamping `card`'s refresh time as `now`, keeping the card list and every other stamp. */
export function refreshCardPayload(cur: { cards: CardId[]; refreshed: Record<string, string> }, scope: Id, card: CardId, now: IsoTime): DashSet {
  return { scope, cards: cur.cards, refreshed: { ...cur.refreshed, [card]: now } };
}

/** The refresh stamp shown for a card: its own stamp, or the time the page opened when it has none. */
export function cardStamp(refreshed: Record<string, string>, card: CardId, openedAt: IsoTime): IsoTime {
  return (refreshed[card] ?? openedAt) as IsoTime;
}

/** Days-left text for a round: `round.left`, `round.over` (overdue), or `pg.noRound` when there is no current round. */
export function leftText(t: Translator['t'], days: number | null): string {
  if (days === null) return t('pg.noRound');
  return days < 0 ? t('round.over', { n: -days }) : t('round.left', { n: days });
}

/** The text of one dashboard risk row: `rk.<code>`, filled with the need's code and the other person's name. */
export function riskText(t: Translator['t'], s: State, r: Risk): string {
  return t(`rk.${r.code}`, {
    need: r.needId ? s.needs[r.needId]?.code ?? '' : '',
    who: r.userId ? s.users[r.userId]?.displayName ?? '' : '',
    v: r.v ?? 0,
    n: r.n ?? 0,
    d: r.days ?? 0,
  });
}

/** Where a click on a dashboard risk row goes, from `r.go`. */
export function riskTarget(r: Risk): { open: { projectId: Id; needId: Id } } | { overlay: Overlay } | { go: Route } {
  if (r.go === 'need') return { open: { projectId: r.projectId, needId: r.needId! } };
  if (r.go === 'confirm') return { overlay: { kind: 'confirm', projectId: r.projectId } };
  return { go: { view: 'inputs', projectId: r.projectId } };
}

/** A project's short tag (the sidebar "Atlas" of "Atlas：数据导出"): text before the first colon, its first word, clipped to 12 chars. */
export function projectTag(name: string): string {
  const head = name.split(/[：:]/)[0] ?? name;
  const word = head.trim().split(/\s+/)[0] ?? '';
  return clip(word, 12);
}

export interface ConfirmRow {
  key: string;
  projectId: Id;
  tag: 'conflict' | 'proposal' | 'extract' | 'question';
  text: string;
  needId: Id | null;
}

/** A `question` confirm row's text and needId: looks the matching `Question` up in core's own `questions()`, by `questionId`, rather than re-deriving its day math. */
function questionRow(t: Translator['t'], s: State, me: Id, item: HomeItems['confirm'][number], today: IsoDate): ConfirmRow {
  const { projectId, id } = item;
  const q = questions(s, me, projectId, today).find((x) => questionId(x) === id);
  if (!q) return { key: id, projectId, tag: 'question', text: '', needId: null };
  if (q.kind === 'unlinked') {
    const w = s.work[q.workId];
    return { key: id, projectId, tag: 'question', text: t('ask.q.unlinked', { work: clip(w?.text ?? '', 60) }), needId: null };
  }
  const need = s.needs[q.needId]?.code ?? '';
  return { key: id, projectId, tag: 'question', text: t('ask.q.stale', { need, idle: q.idleDays, left: q.daysLeft }), needId: q.needId };
}

function confirmRowFor(t: Translator['t'], s: State, me: Id, item: HomeItems['confirm'][number], today: IsoDate): ConfirmRow {
  const { projectId, kind, id } = item;
  if (kind === 'conflict') {
    const c = s.conflicts[id];
    const need = c ? s.needs[c.needId]?.code ?? '' : '';
    return { key: id, projectId, tag: 'conflict', text: `${need}${SEP}${clip(c?.neu ?? '', 60)}`, needId: c?.needId ?? null };
  }
  if (kind === 'proposal') {
    const p = s.proposals[id];
    return { key: id, projectId, tag: 'proposal', text: p?.title ?? '', needId: p?.needId ?? null };
  }
  if (kind === 'extract') {
    const cut = id.lastIndexOf(':');
    const inputId = id.slice(0, cut);
    const extractId = id.slice(cut + 1);
    const x = s.inputs[inputId]?.extracts.find((e) => e.id === extractId);
    return { key: id, projectId, tag: 'extract', text: clip(x?.text ?? '', 60), needId: x?.needId ?? null };
  }
  return questionRow(t, s, me, item, today);
}

/**
 * Home's "To confirm" rows, with their own display text. `me` and `today` let a `question` row
 * look its `Question` back up in core's `questions(s, me, projectId, today)`: `homeItems` keeps
 * only its id, not the idle/left days (or the workId) it was built from.
 */
export function confirmRows(t: Translator['t'], s: State, me: Id, items: HomeItems['confirm'], today: IsoDate): ConfirmRow[] {
  return items.map((item) => confirmRowFor(t, s, me, item, today));
}

/**
 * Home's "owned by me" rows: `homeItems`'s own `mine` (needs `me` is the explicit owner of),
 * plus `me`'s own private needs that have no owner at all. `dashboard.ts`'s own doc comment
 * says Home's "owned by me" includes the viewer's own, but a private need is never assigned an
 * owner (nobody else could hold one), so `homeItems`'s `ownerId === me` check alone misses it.
 * `s` is the viewer's own view, so every private need already in it is already `me`'s.
 */
export function mineRows(s: State, me: Id, items: HomeItems['mine']): HomeItems['mine'] {
  const seen = new Set(items.map((item) => item.needId));
  const extra = Object.values(s.needs)
    .filter((n) => n.privateTo === me && n.ownerId === null && !CLOSED_STATUSES.has(n.status) && !seen.has(n.id))
    .map((n) => ({ projectId: n.projectId, needId: n.id }));
  return [...items, ...extra];
}

/** Whether a key press runs a focused `role="button"` row, as it would a native button: Enter or Space. */
export function isActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar';
}
