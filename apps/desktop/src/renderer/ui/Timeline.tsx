import { useState } from 'react';
import { myProjectIds, projectRounds, SEP, type Id, type IsoDate } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { avatarTone } from './tone';
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

/**
 * The project's rounds as a gantt with a today line (prototype ui.jsx Timeline). Clicking a round
 * selects it; clicking the selected round clears the selection. Inline styles carry geometry only.
 */
export function Timeline({ projectId, selected = null, onSelect }: { projectId: Id; selected?: number | null; onSelect?: (n: number | null) => void }) {
  const { live, today, t, fmtDay } = useApp();
  const rounds = projectRounds(live, projectId);
  if (rounds.length === 0) return null;
  const s = Math.min(...rounds.map((r) => ms(r.start)));
  const e = Math.max(...rounds.map((r) => ms(r.due))) + DAY;
  const x = (d: IsoDate) => ((ms(d) - s) / (e - s)) * 100;
  const now = Math.max(0, Math.min(100, x(today)));
  const weeks: IsoDate[] = [];
  for (let d = s; d <= e; d += 7 * DAY) weeks.push(new Date(d).toISOString().slice(0, 10));
  return (
    <div className="tl">
      <div className="tl-grid">
        <div className="tl-axis">
          {weeks
            .filter((w) => Math.abs(x(w) - now) > 5)
            .map((w) => (
              <span key={w} className="tl-wk" style={{ left: pct(x(w)) }}>
                {fmtDay(w)}
              </span>
            ))}
          <span className="tl-wk tl-wk-today" style={{ left: pct(now) }}>
            {t('tl.today')}
          </span>
        </div>
        <div className="tl-rows">
          {packLanes(rounds, (r) => ms(r.start), (r) => ms(r.due) + DAY).map((lane) => (
            <div key={lane[0]!.id} className="tl-row">
              {lane.map((r, i) => {
            const left = Math.max(0, Math.min(100, x(r.start)));
            const right = Math.max(0, Math.min(100, x(r.due)));
            const width = Math.max(2, right - left);
            const narrow = width < 10;
            const on = selected === r.n;
            const label = t('round', { n: r.n }) + SEP + r.title;
            const mark = (r.kind === 'hard' ? t('tl.hard') : t('tl.cadence')) + SEP + fmtDay(r.due);
            return (
              <span key={r.id}>
                <button type="button" className={`tl-bar b-${r.status}${on ? ' on' : ''}`} style={{ left: pct(left), width: pct(width) }} onClick={() => onSelect?.(on ? null : r.n)} title={label}>
                  {!narrow && <span className="tl-bar-t">{label}</span>}
                </button>
                {/* Outside a narrow bar only when nothing follows it in the lane. */}
                {narrow && i === lane.length - 1 && (
                  <span className="tl-bar-out" style={{ left: pct(right) }}>
                    {label}
                  </span>
                )}
                <span className={`tl-ms ms-${r.kind} s-${r.status}`} style={{ left: pct(right) }} title={mark} />
              </span>
            );
              })}
            </div>
          ))}
          <div className="tl-today" style={{ left: pct(now) }} />
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
  const pids = [...myProjectIds(live, me)].sort();
  // Each project's colour: its own hash, or the next free one when two projects would share it.
  const tone = new Map<Id, number>();
  for (const pid of pids) {
    let n: number = avatarTone(pid);
    for (let k = 0; k < 8 && [...tone.values()].includes(n); k++) n = (n % 8) + 1;
    tone.set(pid, n);
  }
  const bars = pids.flatMap((pid) => projectRounds(live, pid).map((r) => ({ r, pid, name: live.projects[pid]?.name ?? pid })));
  if (bars.length === 0) return <p className="muted small">{t('tl.noneHome')}</p>;
  const s = all ? Math.min(...bars.map((b) => ms(b.r.start))) : ms(today) - 14 * DAY;
  const e = all ? Math.max(...bars.map((b) => ms(b.r.due))) + DAY : ms(today) + 70 * DAY;
  const x = (d: IsoDate) => ((ms(d) - s) / (e - s)) * 100;
  const now = Math.max(0, Math.min(100, x(today)));
  const weeks: IsoDate[] = [];
  for (let d = s; d <= e; d += 7 * DAY) weeks.push(new Date(d).toISOString().slice(0, 10));
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
        <div className="seg tlm-seg">
          <button type="button" className={all ? '' : 'on'} data-testid="tlm-window" onClick={() => setAll(false)}>
            {t('tl.window')}
          </button>
          <button type="button" className={all ? 'on' : ''} data-testid="tlm-all" onClick={() => setAll(true)}>
            {t('tl.all')}
          </button>
        </div>
      </div>
      <div className="tlm-scroll">
        <div className="tlm-in">
          <div className="tl-axis">
            {weeks
              .filter((w) => Math.abs(x(w) - now) > 5)
              .map((w) => (
                <span key={w} className="tl-wk" style={{ left: pct(x(w)) }}>
                  {fmtDay(w)}
                </span>
              ))}
            <span className="tl-wk tl-wk-today" style={{ left: pct(now) }}>
              {t('tl.today')}
            </span>
          </div>
          <div className="tlm-lanes">
            {lanes.map((lane) => (
              <div key={`${lane[0]!.pid}-${lane[0]!.r.id}`} className="tlm-lane" data-testid="tlm-lane">
                {lane.map(({ r, pid, name }) => {
                  const left = Math.max(0, Math.min(100, x(r.start)));
                  const right = Math.max(0, Math.min(100, x(r.due)));
                  const width = Math.max(1.5, right - left);
                  const label = `${name} ${r.title || t('round', { n: r.n })}`;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={`tl-bar tlm-bar pc-${tone.get(pid)}${r.status === 'current' ? ' cur' : ''}`}
                      style={{ left: pct(left), width: pct(width) }}
                      title={`${label} ${fmtDay(r.start)} ${fmtDay(r.due)}`}
                      onClick={() => go({ view: 'deliveries', projectId: pid, round: r.n })}
                    >
                      {width >= 8 && <span className="tl-bar-t">{label}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="tl-today" style={{ left: pct(now) }} />
          </div>
        </div>
      </div>
    </div>
  );
}
