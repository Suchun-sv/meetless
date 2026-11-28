import type { Id, IsoDate, State } from '@meetless/core';
import type { Translator } from '@meetless/i18n';
import { eventDays, projectEvents, type EventDay, type TimelineEvent } from '../../../../../desktop/src/renderer/ui/timeline-events';

/*
 * The timeline's event ticks. What happened when (`projectEvents`, `eventDays`) is the desktop
 * renderer's own pure module, imported as is; this adds the px placement and the tick text.
 */

export { EV_TYPES, eventDays, projectEvents, type EvTarget, type EvType, type EventDay, type TimelineEvent } from '../../../../../desktop/src/renderer/ui/timeline-events';

export interface Tick {
  date: IsoDate;
  x: number;
  day: EventDay;
  /** The tooltip / long-press lines: up to six events, then 「等 n 件」. */
  lines: string[];
}

/** Closer than this many px and two days share one tick (its count covers both). */
const TICK_GAP = 14;

/**
 * One tick per day with events, placed at `px(date)` on a `width` px track; days closer than
 * 14 px merge, and ticks off the track are dropped. `names` prefixes each line with its project
 * (Home's timeline, where ticks of several projects share one axis).
 */
export function placeTicks(t: Translator['t'], perDay: EventDay[], px: (d: IsoDate) => number, width: number, names?: Map<Id, string>): Tick[] {
  const days: EventDay[] = [];
  for (const d of perDay) {
    const prev = days.at(-1);
    if (prev && px(d.date) - px(prev.date) < TICK_GAP) days[days.length - 1] = { ...prev, events: [...prev.events, ...d.events] };
    else days.push(d);
  }
  const line = (ev: TimelineEvent) =>
    `${names ? `${names.get(ev.projectId) ?? ''} ` : ''}${t(`ev.${ev.type}`)} ${ev.what}${ev.scene ? ` ${t(`lin.type.${ev.scene}` as never)}` : ''}`;
  const out: Tick[] = [];
  for (const d of days) {
    const x = px(d.date);
    if (x < 0 || x > width) continue;
    const lines = d.events.slice(0, 6).map(line);
    if (d.events.length > 6) lines.push(t('ev.more', { n: d.events.length - 6 }));
    out.push({ date: d.date, x, day: d, lines });
  }
  return out;
}

/** Ticks for several projects on one axis (Home's timeline). */
export function eventsFor(s: State, projectIds: Id[]): EventDay[] {
  return eventDays(projectIds.flatMap((pid) => projectEvents(s, pid)));
}
