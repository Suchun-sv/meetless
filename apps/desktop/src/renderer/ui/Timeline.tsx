import { useState } from 'react';
import { myProjectIds, projectRounds, SEP, type Id, type IsoDate } from '@meetless/core';
import { useApp } from '../app/AppContext';
import './timeline.css';

const DAY = 86_400_000;
const ms = (d: IsoDate) => Date.parse(`${d.slice(0, 10)}T12:00:00Z`);
const pct = (n: number) => `${n.toFixed(3)}%`;

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
          {rounds.map((r) => {
            const left = Math.max(0, Math.min(100, x(r.start)));
            const right = Math.max(0, Math.min(100, x(r.due)));
            const width = Math.max(2, right - left);
            const narrow = width < 10;
            const on = selected === r.n;
            const label = t('round', { n: r.n }) + SEP + r.title;
            const mark = (r.kind === 'hard' ? t('tl.hard') : t('tl.cadence')) + SEP + fmtDay(r.due);
            return (
              <div key={r.id} className="tl-row">
                <button type="button" className={`tl-bar b-${r.status}${on ? ' on' : ''}`} style={{ left: pct(left), width: pct(width) }} onClick={() => onSelect?.(on ? null : r.n)} title={label}>
                  {!narrow && <span className="tl-bar-t">{label}</span>}
                </button>
                {narrow && (
                  <span className="tl-bar-out" style={{ left: pct(right) }}>
                    {label}
                  </span>
                )}
                <span className={`tl-ms ms-${r.kind} s-${r.status}`} style={{ left: pct(right) }} title={mark} />
              </div>
            );
          })}
          <div className="tl-today" style={{ left: pct(now) }} />
        </div>
      </div>
    </div>
  );
}

/**
 * Every round of the viewer's projects on one timeline (Home's timeline card): one row per project,
 * the today line, from two weeks back to ten weeks ahead or 「全部」 (every round). Scrolls sideways.
 * A round opens that project's Deliveries at it.
 */
export function ProjectsTimeline() {
  const { live, me, today, t, fmtDay, go } = useApp();
  const [all, setAll] = useState(false);
  const rows = myProjectIds(live, me)
    .map((pid) => ({ pid, name: live.projects[pid]?.name ?? pid, rounds: projectRounds(live, pid) }))
    .filter((r) => r.rounds.length > 0);
  if (rows.length === 0) return <p className="muted small">{t('tl.noneHome')}</p>;
  const rs = rows.flatMap((r) => r.rounds);
  const s = all ? Math.min(...rs.map((r) => ms(r.start))) : ms(today) - 14 * DAY;
  const e = all ? Math.max(...rs.map((r) => ms(r.due))) + DAY : ms(today) + 70 * DAY;
  const x = (d: IsoDate) => ((ms(d) - s) / (e - s)) * 100;
  const now = Math.max(0, Math.min(100, x(today)));
  const weeks: IsoDate[] = [];
  for (let d = s; d <= e; d += 7 * DAY) weeks.push(new Date(d).toISOString().slice(0, 10));
  return (
    <div className="tlm">
      <div className="seg tlm-seg">
        <button type="button" className={all ? '' : 'on'} data-testid="tlm-window" onClick={() => setAll(false)}>
          {t('tl.window')}
        </button>
        <button type="button" className={all ? 'on' : ''} data-testid="tlm-all" onClick={() => setAll(true)}>
          {t('tl.all')}
        </button>
      </div>
      <div className="tlm-scroll">
        <div className="tlm-in">
          <div className="tlm-row tlm-head">
            <span />
            <div className="tlm-track tl-axis">
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
          </div>
          {rows.map((row) => (
            <div key={row.pid} className="tlm-row" data-testid="tlm-project">
              <span className="tlm-name" title={row.name}>
                {row.name}
              </span>
              <div className="tlm-track">
                {row.rounds
                  .filter((r) => ms(r.due) + DAY > s && ms(r.start) < e)
                  .map((r) => {
                    const left = Math.max(0, Math.min(100, x(r.start)));
                    const right = Math.max(0, Math.min(100, x(r.due)));
                    const width = Math.max(1.5, right - left);
                    const label = t('round', { n: r.n }) + SEP + r.title;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className={`tl-bar b-${r.status}`}
                        style={{ left: pct(left), width: pct(width) }}
                        title={`${row.name}${SEP}${label}${SEP}${fmtDay(r.due)}`}
                        onClick={() => go({ view: 'deliveries', projectId: row.pid, round: r.n })}
                      >
                        {width >= 10 && <span className="tl-bar-t">{label}</span>}
                      </button>
                    );
                  })}
                <div className="tl-today" style={{ left: pct(now) }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
