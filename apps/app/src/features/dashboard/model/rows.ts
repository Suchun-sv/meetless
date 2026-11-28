import {
  CLOSED_STATUSES,
  clip,
  myProjectIds,
  questionId,
  questions,
  SEP,
  type HomeItems,
  type Id,
  type IsoDate,
  type Risk,
  type State,
} from '@meetless/core';
import type { Translator } from '@meetless/i18n';

/*
 * Text and targets of the dashboard rows, from the desktop renderer's `dash/model.ts` (repeated:
 * that module pulls in the desktop overlay components). Tones come from its `ui/tone.ts`.
 */

export { riskTone, ST_TONE, type Tone } from '../../../../../desktop/src/renderer/ui/tone';

type T = Translator['t'];

/** Days-left text for a round: `round.left`, `round.over` (overdue), or `pg.noRound`. */
export function leftText(t: T, days: number | null): string {
  if (days === null) return t('pg.noRound');
  return days < 0 ? t('round.over', { n: -days }) : t('round.left', { n: days });
}

/** Five days or fewer left reads as a warning. */
export function dueSoon(days: number | null): boolean {
  return days !== null && days <= 5;
}

/** One risk row's text: `rk.<code>`, with the need's code and the other person's name. */
export function riskText(t: T, s: State, r: Risk): string {
  return t(`rk.${r.code}`, {
    need: r.needId ? (s.needs[r.needId]?.code ?? '') : '',
    who: r.userId ? (s.users[r.userId]?.displayName ?? '') : '',
    v: r.v ?? 0,
    n: r.n ?? 0,
    d: r.days ?? 0,
  });
}

/** Where a risk row goes: the need, the confirm panel, or the project's inputs. */
export type RiskTarget = { kind: 'need'; projectId: Id; needId: Id } | { kind: 'confirm'; projectId: Id } | { kind: 'inputs'; projectId: Id };

export function riskTarget(r: Risk): RiskTarget {
  if (r.go === 'need' && r.needId) return { kind: 'need', projectId: r.projectId, needId: r.needId };
  if (r.go === 'confirm') return { kind: 'confirm', projectId: r.projectId };
  return { kind: 'inputs', projectId: r.projectId };
}

/** A project's short tag (「Atlas」 of 「Atlas：数据导出」): before the first colon, its first word, at most 12 chars. */
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

function questionRow(t: T, s: State, me: Id, item: HomeItems['confirm'][number], today: IsoDate): ConfirmRow {
  const { projectId, id } = item;
  const q = questions(s, me, projectId, today).find((x) => questionId(x) === id);
  if (!q) return { key: id, projectId, tag: 'question', text: '', needId: null };
  if (q.kind === 'unlinked') return { key: id, projectId, tag: 'question', text: t('ask.q.unlinked', { work: clip(s.work[q.workId]?.text ?? '', 60) }), needId: null };
  return { key: id, projectId, tag: 'question', text: t('ask.q.stale', { need: s.needs[q.needId]?.code ?? '', idle: q.idleDays, left: q.daysLeft }), needId: q.needId };
}

function confirmRow(t: T, s: State, me: Id, item: HomeItems['confirm'][number], today: IsoDate): ConfirmRow {
  const { projectId, kind, id } = item;
  if (kind === 'conflict') {
    const c = s.conflicts[id];
    return { key: id, projectId, tag: 'conflict', text: `${c ? (s.needs[c.needId]?.code ?? '') : ''}${SEP}${clip(c?.neu ?? '', 60)}`, needId: c?.needId ?? null };
  }
  if (kind === 'proposal') {
    const p = s.proposals[id];
    return { key: id, projectId, tag: 'proposal', text: p?.title ?? '', needId: p?.needId ?? null };
  }
  if (kind === 'extract') {
    const cut = id.lastIndexOf(':');
    const x = s.inputs[id.slice(0, cut)]?.extracts.find((e) => e.id === id.slice(cut + 1));
    return { key: id, projectId, tag: 'extract', text: clip(x?.text ?? '', 60), needId: x?.needId ?? null };
  }
  return questionRow(t, s, me, item, today);
}

/**
 * Home's 「待确认」 rows in `homeItems` order (per project: conflicts, proposals, extracts,
 * questions). A question row looks its `Question` back up in core's `questions()` for its days.
 * Extract rows carry the rule mark; conflict rows a warning label after the text.
 */
export function confirmRows(t: T, s: State, me: Id, items: HomeItems['confirm'], today: IsoDate): ConfirmRow[] {
  return items.map((item) => confirmRow(t, s, me, item, today));
}

/**
 * Home's 「我负责的」: `homeItems.mine` (needs `me` owns) plus `me`'s own private needs, which
 * never have an owner (archived projects left out). `s` is the viewer's own view, so every private
 * need in it is `me`'s.
 */
export function mineRows(s: State, me: Id, items: HomeItems['mine']): HomeItems['mine'] {
  const seen = new Set(items.map((item) => item.needId));
  const live = new Set(myProjectIds(s, me));
  const extra = Object.values(s.needs)
    .filter((n) => n.privateTo === me && n.ownerId === null && live.has(n.projectId) && !CLOSED_STATUSES.has(n.status) && !seen.has(n.id))
    .map((n) => ({ projectId: n.projectId, needId: n.id }));
  return [...items, ...extra];
}

/** The hypothesis card's four counts, in this order. */
export const HYP_CARD_STATUSES = ['held', 'refuted', 'testing', 'untested'] as const;
