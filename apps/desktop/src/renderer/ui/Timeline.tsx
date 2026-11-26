import { useLayoutEffect, useRef, useState } from 'react';
import { myProjectIds, projectRounds, SEP, type Id, type IsoDate } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { avatarTone } from './tone';
import { EV_TYPES, eventDays, projectEvents, type EventDay, type TimelineEvent } from './timeline-events';
import './timeline.css';

const DAY = 86_400_000;
const ms = (d: IsoDate) => Date.parse(`${d.slice(0, 10)}T12:00:00Z`);
const pct = (n: number) => `${n.toFixed(3)}%`;

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

/** Width of a label in px, roughly (CJK wider): enough to keep labels from colliding. */
export const textPx = (s: string) => [...s].reduce((w, c) => w + (/[\u2E80-\uFFFF]/.test(c) ? 12 : 6.6), 0);

/** The width of an element (a callback ref), followed as it resizes: the container's size, not the viewport's. */
function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number, T | null] {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w, el];
}

/** Fewer px than this per day and the track grows wider than the card, which then scrolls inside itself. */
export const MIN_PX_PER_DAY = 6;
const LABEL_GAP = 56;

export interface AxisLabel {
  x: number;
  text: string;
}

/**
 * The axis for `s`..`e` drawn `width` px wide: the step (a day, a week, two weeks or a month) is the
 * smallest that keeps labels about 56 px apart; day and week steps show the day of the month with
 * month names on a second row. Labels that would collide with each other or with today are dropped.
 */
export function axisLabels(s: number, e: number, width: number, today: number, locale: string): { main: AxisLabel[]; months: AxisLabel[] } {
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
      if (avoidToday && Math.abs(l.x - todayX) < (w + textPx(zh ? '今天' : 'Today')) / 2 + 12) continue;
      out.push(l);
    }
    return out;
  };
  return { main: keep(main, true), months: keep(months, false) };
}

/** The axis row(s): labels clamped inside the track, today on top. */
function Axis({ s, e, width, today }: { s: number; e: number; width: number; today: IsoDate }) {
  const { t, locale } = useApp();
  const { main, months } = axisLabels(s, e, width, ms(today), locale);
  const at = (x: number, text: string) => ({ left: `${Math.max(textPx(text) / 2, Math.min(width - textPx(text) / 2, x))}px` });
  const todayX = ((ms(today) - s) / (e - s)) * width;
  return (
    <>
      {months.length > 0 && (
        <div className="tl-axis tl-months">
          {months.map((l) => (
            <span key={`${l.x}-${l.text}`} className="tl-wk tl-mo" style={at(l.x, l.text)}>
              {l.text}
            </span>
          ))}
        </div>
      )}
      <div className="tl-axis">
        {main.map((l) => (
          <span key={`${l.x}-${l.text}`} className="tl-wk" style={at(l.x, l.text)}>
            {l.text}
          </span>
        ))}
        {todayX >= 0 && todayX <= width && (
          <span className="tl-wk tl-wk-today" style={at(todayX, t('tl.today'))}>
            {t('tl.today')}
          </span>
        )}
      </div>
    </>
  );
}

/** Scrolls a timeline's own scroller so today sits a third of the way in, once its width is known. */
function useScrollToToday(el: HTMLElement | null, todayPx: number, ready: boolean) {
  const done = useRef(false);
  useLayoutEffect(() => {
    if (!el || !ready || done.current) return;
    done.current = true;
    if (el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, todayPx - el.clientWidth / 3);
  });
}

/** The event legend and the 「显示事件」 switch. */
function EventBar({ on, setOn }: { on: boolean; setOn: (v: boolean) => void }) {
  const { t } = useApp();
  return (
    <div className="tl-evbar">
      <label className="tl-evsw small">
        <input type="checkbox" checked={on} data-testid="tl-events" onChange={(e) => setOn(e.target.checked)} />
        {t('ev.show')}
      </label>
      {on && (
        <span className="tl-legend">
          {EV_TYPES.map((k) => (
            <span key={k} className={`tl-lg ev-${k}`}>
              <span className="tl-lg-t" />
              {t(`ev.${k}`)}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/** One thin tick per day with events (a count when there are several), on the timeline's own axis. */
function EventTicks({ days: perDay, x, names, width }: { days: EventDay[]; x: (d: IsoDate) => number; names?: Map<Id, string>; width: number }) {
  const { t, fmtDay, go, openNeed } = useApp();
  const open = (ev: TimelineEvent) => {
    const g = ev.target;
    if ('need' in g) openNeed(ev.projectId, g.need);
    else if ('artifact' in g) go({ view: 'artifacts', projectId: ev.projectId, focusId: g.artifact });
    else if ('round' in g) go({ view: 'deliveries', projectId: ev.projectId, round: g.round });
    else go({ view: 'inputs', projectId: ev.projectId, focusId: g.input });
  };
  // Days closer than 14 px share one tick (its count covers both), so ticks and counts never crowd.
  const days: EventDay[] = [];
  for (const d of perDay) {
    const prev = days.at(-1);
    if (prev && ((x(d.date) - x(prev.date)) / 100) * width < 14) days[days.length - 1] = { ...prev, events: [...prev.events, ...d.events] };
    else days.push(d);
  }
  return (
    <div className="tl-ev">
      {days.map((d) => {
        const at = x(d.date);
        if (at < 0 || at > 100) return null;
        const line = (ev: TimelineEvent) =>
          `${names ? `${names.get(ev.projectId) ?? ''} ` : ''}${t(`ev.${ev.type}`)} ${ev.what}${ev.scene ? ` ${t(`lin.type.${ev.scene}` as never)}` : ''}`;
        const lines = d.events.slice(0, 6).map(line);
        if (d.events.length > 6) lines.push(t('ev.more', { n: d.events.length - 6 }));
        return (
          <button key={d.date} type="button" className={`tl-tick ev-${d.type}`} style={{ left: pct(at) }} title={`${fmtDay(d.date)}\n${lines.join('\n')}`} aria-label={`${fmtDay(d.date)} ${lines[0]}`} data-testid="tl-tick" onClick={() => open(d.events[0]!)}>
            {d.events.length > 1 && <span className="tl-tick-n">{d.events.length}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The project's DDLs as a gantt with a today line (prototype ui.jsx Timeline), drawn in px for the
 * card's own width: at least MIN_PX_PER_DAY a day, scrolling sideways inside the card (starting at
 * today) when the range is longer. Overlapping DDLs stack in lanes; a bar's label sits inside when
 * it fits, else to its right when there is room before the next bar, else only in the tooltip.
 * Diamonds sit on their own strip above the bars, so they never cover a label. Clicking a DDL
 * selects it; clicking it again clears the selection.
 */
export function Timeline({ projectId, selected = null, onSelect, events }: { projectId: Id; selected?: number | null; onSelect?: (n: number | null) => void; events?: 'on' | 'off' }) {
  const { live, today, t, fmtDay } = useApp();
  const [showEv, setShowEv] = useState(events === 'on');
  const [box, avail, boxEl] = useWidth<HTMLDivElement>();
  const rounds = projectRounds(live, projectId);
  const s = rounds.length ? Math.min(...rounds.map((r) => ms(r.start)), ms(today) - 3 * DAY) : 0;
  const e = rounds.length ? Math.max(...rounds.map((r) => ms(r.due)), ms(today)) + 4 * DAY : 1;
  const width = Math.max(avail || 800, ((e - s) / DAY) * MIN_PX_PER_DAY);
  const px = (d: IsoDate) => ((ms(d) - s) / (e - s)) * width;
  useScrollToToday(boxEl, px(today), avail > 0);
  if (rounds.length === 0) return null;
  const x = (d: IsoDate) => (px(d) / width) * 100;
  const lanes = packLanes(rounds, (r) => ms(r.start), (r) => ms(r.due) + DAY);
  return (
    <div className="tl">
      {events && <EventBar on={showEv} setOn={setShowEv} />}
      <div className="tl-scroll" ref={box}>
        <div className="tl-grid" style={{ width: `${width}px` }}>
          <Axis s={s} e={e} width={width} today={today} />
          {events && showEv && <EventTicks days={eventDays(projectEvents(live, projectId))} x={x} width={width} />}
          <div className="tl-ms-row">
            {rounds.map((r) => (
              <span key={r.id} className={`tl-ms ms-${r.kind} s-${r.status}`} style={{ left: `${px(r.due)}px` }} title={`${r.title || t('round', { n: r.n })}${SEP}${fmtDay(r.due)}`} />
            ))}
          </div>
          <div className="tl-rows">
            {lanes.map((lane) => (
              <div key={lane[0]!.id} className="tl-row">
                {lane.map((r, i) => {
                  const left = Math.max(0, px(r.start));
                  const right = Math.min(width, px(r.due) + width / ((e - s) / DAY));
                  const w = Math.max(6, right - left);
                  const on = selected === r.n;
                  const label = r.title || t('round', { n: r.n });
                  const need = textPx(label) + 20;
                  const next = lane[i + 1] ? px(lane[i + 1]!.start) : width;
                  const where = need <= w ? 'in' : left + w + need <= Math.min(next, width) ? 'out' : 'none';
                  return (
                    <span key={r.id}>
                      <button
                        type="button"
                        className={`tl-bar b-${r.status}${on ? ' on' : ''}`}
                        style={{ left: `${left}px`, width: `${w}px` }}
                        onClick={() => onSelect?.(on ? null : r.n)}
                        title={`${label}${SEP}${fmtDay(r.due)}`}
                        aria-label={`${label} ${fmtDay(r.due)}`}
                      >
                        {where === 'in' && <span className="tl-bar-t">{label}</span>}
                      </button>
                      {where === 'out' && (
                        <span className="tl-bar-out" style={{ left: `${left + w}px` }}>
                          {label}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            ))}
            <div className="tl-today" style={{ left: `${px(today)}px` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Every round of the viewer's projects on one timeline (Home's timeline card), packed into lanes so
 * parallel rounds are all visible: each bar reads 「项目名 轮次名」 in its project's colour (the avatar
 * tokens, with a legend). From two weeks back to ten weeks ahead, or 「全部」. Scrolls sideways; a
 * round opens that project's Deliveries at it.
 */
export function ProjectsTimeline() {
  const { live, me, today, t, fmtDay, go } = useApp();
  const [all, setAll] = useState(false);
  const [showEv, setShowEv] = useState(false);
  const [box, avail, boxEl] = useWidth<HTMLDivElement>();
  const pids = [...myProjectIds(live, me)].sort();
  // Each project's colour: its own hash, or the next free one when two projects would share it.
  const tone = new Map<Id, number>();
  for (const pid of pids) {
    let n: number = avatarTone(pid);
    for (let k = 0; k < 8 && [...tone.values()].includes(n); k++) n = (n % 8) + 1;
    tone.set(pid, n);
  }
  const bars = pids.flatMap((pid) => projectRounds(live, pid).map((r) => ({ r, pid, name: live.projects[pid]?.name ?? pid })));
  const s = all && bars.length ? Math.min(...bars.map((b) => ms(b.r.start)), ms(today) - 3 * DAY) : ms(today) - 14 * DAY;
  const e = all && bars.length ? Math.max(...bars.map((b) => ms(b.r.due)), ms(today)) + 4 * DAY : ms(today) + 70 * DAY;
  const width = Math.max(avail || 720, ((e - s) / DAY) * MIN_PX_PER_DAY);
  const px = (d: IsoDate) => ((ms(d) - s) / (e - s)) * width;
  useScrollToToday(boxEl, px(today), avail > 0);
  if (bars.length === 0) return <p className="muted small">{t('tl.noneHome')}</p>;
  const x = (d: IsoDate) => (px(d) / width) * 100;
  const shown = bars.filter((b) => ms(b.r.due) + DAY > s && ms(b.r.start) < e);
  const lanes = packLanes(shown, (b) => ms(b.r.start), (b) => ms(b.r.due) + DAY);
  const inLegend = pids.filter((pid) => bars.some((b) => b.pid === pid));
  return (
    <div className="tlm">
      <div className="tlm-top">
        <div className="tlm-legend">
          {inLegend.map((pid) => (
            <span key={pid} className="tlm-key">
              <span className={`tlm-sw pc-${tone.get(pid)}`} />
              {live.projects[pid]?.name ?? pid}
            </span>
          ))}
        </div>
        <EventBar on={showEv} setOn={setShowEv} />
        <div className="seg tlm-seg">
          <button type="button" className={all ? '' : 'on'} data-testid="tlm-window" onClick={() => setAll(false)}>
            {t('tl.window')}
          </button>
          <button type="button" className={all ? 'on' : ''} data-testid="tlm-all" onClick={() => setAll(true)}>
            {t('tl.all')}
          </button>
        </div>
      </div>
      <div className="tlm-scroll" ref={box}>
        <div className="tlm-in" style={{ width: `${width}px` }}>
          <Axis s={s} e={e} width={width} today={today} />
          {showEv && <EventTicks days={eventDays(pids.flatMap((pid) => projectEvents(live, pid)))} x={x} width={width} names={new Map(pids.map((pid) => [pid, live.projects[pid]?.name ?? pid]))} />}
          <div className="tlm-lanes">
            {lanes.map((lane) => (
              <div key={`${lane[0]!.pid}-${lane[0]!.r.id}`} className="tlm-lane" data-testid="tlm-lane">
                {lane.map(({ r, pid, name }, i) => {
                  const left = Math.max(0, px(r.start));
                  const right = Math.min(width, px(r.due) + width / ((e - s) / DAY));
                  const w = Math.max(6, right - left);
                  const label = `${name} ${r.title || t('round', { n: r.n })}`;
                  const need = textPx(label) + 20;
                  const next = lane[i + 1] ? px(lane[i + 1]!.r.start) : width;
                  const where = need <= w ? 'in' : left + w + need <= Math.min(next, width) ? 'out' : 'none';
                  return (
                    <span key={r.id}>
                      <button
                        type="button"
                        className={`tl-bar tlm-bar pc-${tone.get(pid)}${r.status === 'current' ? ' cur' : ''}`}
                        style={{ left: `${left}px`, width: `${w}px` }}
                        title={`${label} ${fmtDay(r.start)} ${fmtDay(r.due)}`}
                        aria-label={label}
                        onClick={() => go({ view: 'deliveries', projectId: pid, round: r.n })}
                      >
                        {where === 'in' && <span className="tl-bar-t">{label}</span>}
                      </button>
                      {where === 'out' && (
                        <span className="tl-bar-out" style={{ left: `${left + w}px` }}>
                          {label}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            ))}
            <div className="tl-today" style={{ left: `${px(today)}px` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
