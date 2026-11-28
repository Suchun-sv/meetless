import type { IsoDate } from '@meetless/core';

/*
 * Pure geometry for the DDL timelines, ported from the desktop renderer's `ui/Timeline.tsx`
 * (which also holds React and CSS, so it cannot be imported here). Everything is in px for a
 * track of a given width; the screens only place views at these numbers.
 */

export const DAY = 86_400_000;

/** A calendar date as ms at noon UTC, so day math never crosses a DST edge. */
export const ms = (d: IsoDate | string) => Date.parse(`${d.slice(0, 10)}T12:00:00Z`);

/** Fewer px than this per day and the track grows wider than its container, which then scrolls. */
export const MIN_PX_PER_DAY = 6;
const LABEL_GAP = 56;

/**
 * Greedy interval packing by start date: each item goes into the first lane whose last item ends
 * before it starts, else a new lane. Overlapping items always end up in different lanes.
 */
export function packLanes<T>(items: T[], start: (x: T) => number, end: (x: T) => number): T[][] {
  const lanes: { end: number; items: T[] }[] = [];
  for (const it of [...items].sort((a, b) => start(a) - start(b) || end(a) - end(b))) {
    const lane = lanes.find((l) => l.end <= start(it));
    if (lane) {
      lane.items.push(it);
      lane.end = end(it);
    } else lanes.push({ end: end(it), items: [it] });
  }
  return lanes.map((l) => l.items);
}

/** Width of a label in px at the xs text size, roughly (CJK wider): enough to keep labels apart. */
export const textPx = (s: string) => [...s].reduce((w, c) => w + (/[⺀-￿]/.test(c) ? 12 : 6.6), 0);

export interface AxisLabel {
  x: number;
  text: string;
}

/**
 * The axis for `s`..`e` drawn `width` px wide: the step (a day, a week or two weeks) is the
 * smallest that keeps labels about 56 px apart, with month names on a second row; wider spans
 * show months only. Labels that would collide with each other or with today are dropped.
 */
export function axisLabels(s: number, e: number, width: number, today: number, locale: string, todayText: string): { main: AxisLabel[]; months: AxisLabel[] } {
  const days = Math.max(1, (e - s) / DAY);
  const pxd = width / days;
  const zh = locale.startsWith('zh');
  const monthName = (d: Date) => (zh ? `${d.getUTCMonth() + 1}月` : d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }));
  const px = (t: number) => ((t - s) / (e - s)) * width;
  const step = [1, 7, 14].find((k) => k * pxd >= LABEL_GAP) ?? 0;
  const main: AxisLabel[] = [];
  const months: AxisLabel[] = [];
  const first = new Date(s);
  const monthStarts: number[] = [];
  for (let m = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1, 12); m <= e; m = Date.UTC(new Date(m).getUTCFullYear(), new Date(m).getUTCMonth() + 1, 1, 12)) monthStarts.push(m);
  if (step) {
    for (let t = s; t <= e; t += step * DAY) {
      const d = new Date(t);
      main.push({ x: px(t), text: zh ? `${d.getUTCDate()}日` : String(d.getUTCDate()) });
    }
    months.push({ x: 0, text: monthName(first) }, ...monthStarts.map((m) => ({ x: px(m), text: monthName(new Date(m)) })));
  } else {
    for (const m of monthStarts) main.push({ x: px(m), text: monthName(new Date(m)) });
  }
  const todayX = px(today);
  const keep = (ls: AxisLabel[], avoidToday: boolean) => {
    const out: AxisLabel[] = [];
    for (const l of ls) {
      const w = textPx(l.text);
      const prev = out.at(-1);
      if (prev && l.x - prev.x < (textPx(prev.text) + w) / 2 + 8) continue;
      if (avoidToday && Math.abs(l.x - todayX) < (w + textPx(todayText)) / 2 + 12) continue;
      out.push(l);
    }
    return out;
  };
  return { main: keep(main, true), months: keep(months, false) };
}

/** Where a label centred on `x` sits, clamped inside a `width` px track: its left edge and its width. */
export function labelBox(x: number, text: string, width: number): { left: number; width: number } {
  const w = textPx(text);
  const centre = Math.max(w / 2, Math.min(width - w / 2, x));
  return { left: centre - w / 2, width: w };
}
