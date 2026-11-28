import { CLOSED_STATUSES, daysBetween, myProjectIds, projectNeeds, projectRounds, type Id, type IsoDate, type Need, type Round, type State } from '@meetless/core';
import { mostUrgent, urgencyKey, urgencyRank, type UrgencyKey } from '@/ui/urgency';
import { avatarTone } from '../../../../../desktop/src/renderer/ui/tone';

/*
 * 「我的」 mine-v3 (narrow screens): my projects' deadlines and time spans as one agenda, with a
 * calendar (two or five weeks) or a timeline above it. Pure; dates are calendar days.
 */

/** A time span (a trip, a block of days) rather than a deadline: core's `round.span`. */
export function isSpan(r: Round, demo?: ReadonlySet<string>): boolean {
  return r.span === true || (demo?.has(r.id) ?? false) || (demo?.has(r.title) ?? false);
}

export interface AgendaItem {
  round: Round;
  projectId: Id;
  projectName: string;
  /** The day it is listed under: a deadline's due date, a span's start. */
  date: IsoDate;
  daysLeft: number;
  span: boolean;
  spanDays: number;
  /** Every external need under it met (not delivered yet). */
  done: boolean;
  met: number;
  total: number;
  urgency: UrgencyKey;
  /** Index into the avatar palette for the project's colour bar. */
  color: number;
  /** Open needs, mine first, then not started before in progress. */
  open: Need[];
}

const RANK: Partial<Record<Need['status'], number>> = { todo: 0, untested: 0, partial: 1, doing: 2, testing: 2, parked: 3 };
const codeNum = (c: string) => Number(/\d+/.exec(c)?.[0] ?? 0);

/**
 * The agenda: undelivered deadlines of my projects (overdue ones first, by date), done ones only
 * until their due date, and spans that have not ended. Sorted by date.
 */
export function agenda(s: State, me: Id, today: IsoDate, demo?: ReadonlySet<string>): AgendaItem[] {
  const out: AgendaItem[] = [];
  const colorOf = projectColors(myProjectIds(s, me));
  for (const pid of myProjectIds(s, me)) {
    const needs = projectNeeds(s, pid);
    const mine = (n: Need) => n.ownerId === me || Object.values(s.handoffs).some((h) => h.needId === n.id && h.toId === me && h.state !== 'declined' && h.state !== 'done');
    for (const r of projectRounds(s, pid)) {
      if (r.status === 'delivered') continue;
      const span = isSpan(r, demo);
      const inRound = needs.filter((n) => n.roundId === r.id);
      const ext = inRound.filter((n) => n.kind === 'ext');
      const met = ext.filter((n) => n.status === 'met').length;
      const done = ext.length > 0 && met === ext.length;
      const daysLeft = daysBetween(today, r.due);
      if (daysLeft < 0 && (span || done)) continue;
      const open = inRound
        .filter((n) => !CLOSED_STATUSES.has(n.status))
        .sort((a, b) => Number(mine(b)) - Number(mine(a)) || (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || a.kind.localeCompare(b.kind) || codeNum(a.code) - codeNum(b.code));
      out.push({
        round: r,
        projectId: pid,
        projectName: s.projects[pid]?.name ?? '',
        date: span ? (r.start > today ? r.start : today) : r.due,
        daysLeft,
        span,
        spanDays: daysBetween(r.start, r.due) + 1,
        done,
        met,
        total: ext.length,
        urgency: span ? 'far' : urgencyKey(daysLeft, done),
        color: colorOf.get(pid) ?? 1,
        open,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || Number(a.span) - Number(b.span) || a.projectName.localeCompare(b.projectName));
}

/** Subline counts (deadlines only, not done): overdue, due today, due tomorrow, due this week. */
export function sublineCounts(items: AgendaItem[], today: IsoDate): { overdue: number; today: number; tomorrow: number; week: number } {
  const live = items.filter((i) => !i.span && !i.done);
  const toSunday = (7 - weekdayOf(today)) % 7;
  return {
    overdue: live.filter((i) => i.daysLeft < 0).length,
    today: live.filter((i) => i.daysLeft === 0).length,
    tomorrow: live.filter((i) => i.daysLeft === 1).length,
    week: live.filter((i) => i.daysLeft >= 0 && i.daysLeft <= toSunday).length,
  };
}

/** The deadline expanded by default: the nearest one from today on that is not done. */
export function defaultExpanded(items: AgendaItem[]): Id | null {
  return items.find((i) => !i.span && !i.done && i.daysLeft >= 0)?.round.id ?? null;
}

// ---------------------------------------------------------------- days

const DAY = 86_400_000;
const ms = (d: IsoDate) => Date.parse(`${d.slice(0, 10)}T12:00:00Z`);
export const addDays = (d: IsoDate, n: number): IsoDate => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
export const diffDays = (a: IsoDate, b: IsoDate) => Math.round((ms(b) - ms(a)) / DAY);
export const mondayOf = (d: IsoDate): IsoDate => addDays(d, -((weekdayOf(d) + 6) % 7));
export const dayOfMonth = (d: IsoDate) => Number(d.slice(8, 10));
export const monthOf = (d: IsoDate) => Number(d.slice(5, 7));
export const yearOf = (d: IsoDate) => Number(d.slice(0, 4));
/** The 1st of `d`'s month, moved by `n` months. */
export function addMonths(d: IsoDate, n: number): IsoDate {
  const y = yearOf(d);
  const m = monthOf(d) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}-01`;
}
export const firstOfMonth = (d: IsoDate) => `${d.slice(0, 7)}-01`;
export function weekdayOf(d: IsoDate): number {
  return new Date(ms(d)).getUTCDay();
}

export function monthName(d: IsoDate, locale: string): string {
  return locale.startsWith('zh') ? `${monthOf(d)}月` : new Date(ms(d)).toLocaleDateString('en', { month: 'short', timeZone: 'UTC' });
}

/** 「2026年11月28日 星期六」 / 「Saturday, November 28, 2026」. */
export function dateLine(today: IsoDate, locale: string): string {
  if (locale.startsWith('zh')) return `${yearOf(today)}年${monthOf(today)}月${dayOfMonth(today)}日 星期${'日一二三四五六'[weekdayOf(today)]}`;
  return new Date(ms(today)).toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** A month header: 「12月」 in this year, 「2027年1月」 in any other (「Jan 2027」 in English). */
export function monthLabel(d: IsoDate, today: IsoDate, locale: string): string {
  if (yearOf(d) === yearOf(today)) return monthName(d, locale);
  return locale.startsWith('zh') ? `${yearOf(d)}年${monthOf(d)}月` : `${monthName(d, locale)} ${yearOf(d)}`;
}

/** 「12月21日–25日」 / 「Dec 21–25」. */
export function spanRange(a: IsoDate, b: IsoDate, locale: string): string {
  if (locale.startsWith('zh')) return monthOf(a) === monthOf(b) ? `${monthOf(a)}月${dayOfMonth(a)}日–${dayOfMonth(b)}日` : `${monthOf(a)}月${dayOfMonth(a)}日–${monthOf(b)}月${dayOfMonth(b)}日`;
  return monthOf(a) === monthOf(b) ? `${monthName(a, locale)} ${dayOfMonth(a)}–${dayOfMonth(b)}` : `${monthName(a, locale)} ${dayOfMonth(a)}–${monthName(b, locale)} ${dayOfMonth(b)}`;
}

/**
 * The view row's title for a range of days: 「11月–12月」 or 「12月」 within this year; across a year
 * boundary every month carries its year, 「2026年12月 – 2027年1月」; a range wholly in another year
 * reads 「2027年1月」 or 「2027年1月–2月」.
 */
export function rangeTitle(from: IsoDate, to: IsoDate, today: IsoDate, locale: string): string {
  const zh = locale.startsWith('zh');
  if (from.slice(0, 7) === to.slice(0, 7)) return monthLabel(from, today, locale);
  if (yearOf(from) !== yearOf(to)) return zh ? `${yearOf(from)}年${monthOf(from)}月 – ${yearOf(to)}年${monthOf(to)}月` : `${monthName(from, locale)} ${yearOf(from)} – ${monthName(to, locale)} ${yearOf(to)}`;
  if (yearOf(from) === yearOf(today)) return `${monthName(from, locale)}–${monthName(to, locale)}`;
  return zh ? `${yearOf(from)}年${monthOf(from)}月–${monthOf(to)}月` : `${monthName(from, locale)}–${monthName(to, locale)} ${yearOf(from)}`;
}

// ---------------------------------------------------------------- calendar

export interface CalendarDay {
  date: IsoDate;
  today: boolean;
  past: boolean;
  /** Outside the month page being shown (expanded view): light grey, no marks. */
  out: boolean;
  /** Deadlines due that day (not spans), most urgent first. */
  deadlines: AgendaItem[];
  urgency: UrgencyKey | null;
}

/** The page a calendar shows: two weeks from a Monday (collapsed) or a month (expanded). */
export type CalPage = { kind: 'weeks'; start: IsoDate } | { kind: 'month'; first: IsoDate };

/** The first and last day a page covers (a month page: its own days, for the title). */
export function pageRange(p: CalPage): { from: IsoDate; to: IsoDate } {
  if (p.kind === 'weeks') return { from: p.start, to: addDays(p.start, 13) };
  return { from: p.first, to: addDays(addMonths(p.first, 1), -1) };
}

/** The rows of Monday to Sunday a page draws. */
export function calendarPage(items: AgendaItem[], today: IsoDate, p: CalPage): CalendarDay[][] {
  const start = p.kind === 'weeks' ? p.start : mondayOf(p.first);
  const last = p.kind === 'weeks' ? addDays(p.start, 13) : addDays(addMonths(p.first, 1), -1);
  const weeks = Math.ceil((diffDays(start, last) + 1) / 7);
  const month = p.kind === 'month' ? p.first.slice(0, 7) : null;
  const byDay = new Map<IsoDate, AgendaItem[]>();
  for (const i of items) if (!i.span) byDay.set(i.round.due, [...(byDay.get(i.round.due) ?? []), i]);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, w * 7 + d);
      const out = month !== null && date.slice(0, 7) !== month;
      const deadlines = out ? [] : (byDay.get(date) ?? []).sort((a, b) => urgencyRank(a.urgency) - urgencyRank(b.urgency));
      return { date, today: date === today, past: date < today, out, deadlines, urgency: deadlines.length ? mostUrgent(deadlines.map((x) => x.urgency)) : null };
    }),
  );
}

/** Spans overlapping a week row, as the first and last column (0..6) they cover. */
export function spansInWeek(items: AgendaItem[], week: CalendarDay[]): { item: AgendaItem; from: number; to: number }[] {
  const a = week[0]!.date;
  const b = week[6]!.date;
  return items.filter((i) => i.span && i.round.start <= b && i.round.due >= a).map((item) => ({ item, from: Math.max(0, diffDays(a, item.round.start)), to: Math.min(6, diffDays(a, item.round.due)) }));
}

/** Within a page's own month only (expanded view): the span part outside the month is not drawn. */
export function clipSpan(week: CalendarDay[], from: number, to: number): { from: number; to: number } | null {
  let f = from;
  let t = to;
  while (f <= t && week[f]!.out) f++;
  while (t >= f && week[t]!.out) t--;
  return f <= t ? { from: f, to: t } : null;
}

// ---------------------------------------------------------------- timeline

export const TL_PX = 14;
export const TL_BACK = 2;

export interface Marker {
  date: IsoDate;
  x: number;
  items: AgendaItem[];
  urgency: UrgencyKey;
  /** Diameter: 22 merged; 10 hollow when done; else 8 + 2 per open need, at most 18. */
  size: number;
  hollow: boolean;
  /** 0 on the line, 1 lifted above a neighbour it would overlap. */
  lane: 0 | 1;
}

/** The timeline from two days back to the last deadline (at least seven weeks), one marker per day. */
export function timeline(items: AgendaItem[], today: IsoDate): { from: IsoDate; days: number; markers: Marker[]; spans: AgendaItem[] } {
  const from = addDays(today, -TL_BACK);
  const last = items.reduce((m, i) => (i.round.due > m ? i.round.due : m), today);
  const days = Math.max(49, diffDays(from, last) + 5);
  const by = new Map<IsoDate, AgendaItem[]>();
  for (const i of items) if (!i.span && i.round.due >= from) by.set(i.round.due, [...(by.get(i.round.due) ?? []), i]);
  const markers: Marker[] = [];
  for (const [date, its] of [...by.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const merged = its.length > 1;
    const one = its[0]!;
    const hollow = !merged && one.done;
    const size = merged ? 22 : hollow ? 10 : Math.min(18, 8 + 2 * one.open.length);
    const x = (diffDays(from, date) + 0.5) * TL_PX;
    const prev = markers.at(-1);
    const lane = prev && prev.lane === 0 && x - prev.x < (prev.size + size) / 2 + 1 ? 1 : 0;
    markers.push({ date, x, items: its, urgency: mostUrgent(its.map((i) => i.urgency)), size, hollow, lane });
  }
  return { from, days, markers, spans: items.filter((i) => i.span) };
}

/**
 * Each project's colour bar: muted avatar tones only (none of the warm ones that read as urgency),
 * by hash, moving on to the next free tone when two of my projects would share one.
 */
const MUTED = [1, 2, 3, 4, 6, 7, 5];
export function projectColors(pids: Id[]): Map<Id, number> {
  const out = new Map<Id, number>();
  for (const pid of [...pids].sort()) {
    let k = (avatarTone(pid) - 1) % MUTED.length;
    for (let i = 0; i < MUTED.length && [...out.values()].includes(MUTED[k]!); i++) k = (k + 1) % MUTED.length;
    out.set(pid, MUTED[k]!);
  }
  return out;
}

/**
 * Dev builds only (web): `?mlSpanDemo=<round id or title>,…` shows rounds as spans, client-side,
 * for trying the striped look. Production builds (8445, the desktop) ignore it.
 */
export function demoSpans(): ReadonlySet<string> {
  if (!__DEV__) return new Set();
  const loc = (globalThis as { location?: { search?: string } }).location;
  const raw = loc?.search ? new URLSearchParams(loc.search).get('mlSpanDemo') : null;
  return new Set(raw ? raw.split(',').map((x) => x.trim()).filter(Boolean) : []);
}
