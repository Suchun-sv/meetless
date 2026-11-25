import {
  allRisks,
  homeItems,
  projectsCard,
  SEP,
  type CardId,
  type Id,
} from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { useApp } from '../app/AppContext';
import { displayName } from '../model/state';
import { Avatar, Btn, NeedChip, Pill, RulesMark, Status } from '../ui/primitives';
import { riskTone } from '../ui/tone';
import { confirmRows, leftText, mineRows, projectTag, riskText } from './model';
import { Bar, rowButton } from './parts';

/*
 * Home's seven cross-project cards (contract §8, Task 7), ported from the prototype's
 * `HomeWidget`. Each reads core's cross-project queries (`homeItems`, `allRisks`,
 * `projectsCard`), which already exclude private items for every project but the viewer's own
 * (Home's "owned by me" keeps the viewer's own private needs, as core's `homeItems` does).
 */

/** A project's short tag, from its live name. */
function Tag({ projectId }: { projectId: Id }) {
  const { live } = useApp();
  return <span className="ptag">{projectTag(live.projects[projectId]?.name ?? '')}</span>;
}

function Projects() {
  const { live, me, t, today, fmtDay, go } = useApp();
  const rows = projectsCard(live, me, today);
  return (
    <div className="pj">
      {rows.map((row) => {
        const p = live.projects[row.projectId];
        return (
          <button type="button" key={row.projectId} className="pj-i" data-project={row.projectId} onClick={() => go({ view: 'dash', projectId: row.projectId })}>
            <div className="row gap6">
              <strong className="grow">{p?.name ?? ''}</strong>
              <span className={`small${row.daysLeft !== null && row.daysLeft <= 5 ? ' tone-warning' : ' faint'}`}>{leftText(t, row.daysLeft)}</span>
            </div>
            {row.round && <div className="small muted">{[t('round', { n: row.round.n }), row.round.title, t('round.due', { d: fmtDay(row.round.due) })].join(SEP)}</div>}
            <Bar a={row.done} b={row.ext} />
            <div className="small faint">{t('pg.done', { a: row.done, b: row.ext })}</div>
          </button>
        );
      })}
    </div>
  );
}

function Confirm() {
  const { live, me, t, today, openOverlay } = useApp();
  const rows = confirmRows(t, live, me, homeItems(live, me, today).confirm, today);
  if (!rows.length) return <div className="faint small">{t('home.empty')}</div>;
  return (
    <div className="stack">
      {rows.map((row) => (
        <button type="button" key={row.key} className="hrow" onClick={() => openOverlay({ kind: 'confirm', projectId: row.projectId })}>
          <Tag projectId={row.projectId} />
          {row.tag === 'extract' && <RulesMark />}
          <span className="grow hrow-t">{row.text}</span>
          {/* After the text, which starts with the need code: a short pill right before a code reads as a kind badge (contract §8). */}
          {row.tag === 'conflict' && <Pill tone="warning">{t('cf.title')}</Pill>}
          <span className="small faint">{t('home.go')} ›</span>
        </button>
      ))}
    </div>
  );
}

function ToMe() {
  const { live, me, t, today, fmtDay, openOverlay, submit } = useApp();
  const items = homeItems(live, me, today).toMe;
  if (!items.length) return <div className="faint small">{t('home.empty')}</div>;
  const respond = (handoffId: Id, response: 'accepted' | 'asked' | 'declined') => void submit('handoff.responded', { handoffId, response });
  return (
    <div className="stack">
      {items.map((item) => {
        const h = live.handoffs[item.handoffId];
        if (!h) return null;
        return (
          <div key={h.id} className="hitem">
            <div className="row gap6">
              <Avatar userId={h.fromId} size="sm" />
              <span className="small">{t('ho.from', { who: displayName(live, h.fromId) })}</span>
              <Tag projectId={item.projectId} />
              <span className="grow" />
              {h.due && <span className="small faint">{t('ho.dueOn', { d: fmtDay(h.due) })}</span>}
            </div>
            <NeedChip projectId={item.projectId} needId={item.needId} />
            <div className="small muted mb-l">{h.ask}</div>
            {h.state === 'sent' ? (
              <div className="row gap6">
                <Btn kind="primary" testId="home-accept" onClick={() => respond(h.id, 'accepted')}>
                  {t('ho.accept')}
                </Btn>
                <Btn testId="home-ask" onClick={() => respond(h.id, 'asked')}>
                  {t('ho.question')}
                </Btn>
                <Btn testId="home-decline" onClick={() => respond(h.id, 'declined')}>
                  {t('ho.decline')}
                </Btn>
              </div>
            ) : (
              <div className="row gap6">
                <span className="st tone-info">{t(`ho.st.${h.state}` as MessageKey)}</span>
                <span className="grow" />
                {(h.state === 'accepted' || h.state === 'doing') && (
                  <Btn testId="home-link" onClick={() => openOverlay({ kind: 'link', projectId: item.projectId, needId: item.needId })}>
                    {t('lk.btn')}
                  </Btn>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ByMe() {
  const { live, me, t, today, openNeed } = useApp();
  const items = homeItems(live, me, today).byMe;
  if (!items.length) return <div className="faint small">{t('home.empty')}</div>;
  return (
    <div className="stack">
      {items.map((item) => {
        const h = live.handoffs[item.handoffId];
        const n = live.needs[item.needId];
        if (!h || !n) return null;
        return (
          <button type="button" key={h.id} className="hitem hbtn" onClick={() => openNeed(item.projectId, item.needId)}>
            <div className="row gap6">
              <Avatar userId={h.toId} size="sm" />
              <span className="small">{[t('ho.to', { who: displayName(live, h.toId) }), t(`ho.st.${h.state}` as MessageKey)].join(SEP)}</span>
              <Tag projectId={item.projectId} />
            </div>
            <div className="mb-l">
              <span className="mono faint">{n.code}</span> {n.title}
            </div>
            {item.last && <div className="small muted mb-l">{item.last.text}</div>}
            {item.stale !== null && <div className="small tone-warning">{t('ho.stale', { v: item.stale })}</div>}
          </button>
        );
      })}
    </div>
  );
}

function Mine() {
  const { live, me, t, today, openNeed } = useApp();
  const items = mineRows(live, me, homeItems(live, me, today).mine);
  if (!items.length) return <div className="faint small">{t('mine.none')}</div>;
  return (
    <div className="stack">
      {items.map((item) => {
        const n = live.needs[item.needId];
        if (!n) return null;
        return (
          <button type="button" key={item.needId} className="hrow" onClick={() => openNeed(item.projectId, item.needId)}>
            <Tag projectId={item.projectId} />
            <span className="mono faint small">{n.code}</span>
            <span className="grow hrow-t">{n.title}</span>
            <Status s={n.status} />
          </button>
        );
      })}
    </div>
  );
}

function Due() {
  const { live, me, t, today, fmtDay, go } = useApp();
  const items = homeItems(live, me, today).due;
  if (!items.length) return <div className="faint small">{t('home.empty')}</div>;
  return (
    <div className="stack">
      {items.map((item) => {
        const p = live.projects[item.projectId];
        const r = live.rounds[item.roundId];
        return (
          <button type="button" key={item.projectId} className="hrow" onClick={() => go({ view: 'dash', projectId: item.projectId })}>
            <span className="grow hrow-t">
              {p?.name ?? ''}
              {r && <span className="faint">{SEP}{t('round', { n: r.n })} {r.title}</span>}
            </span>
            <span className={`small${item.daysLeft <= 5 ? ' tone-warning' : ' faint'}`}>{[r ? fmtDay(r.due) : '', leftText(t, item.daysLeft)].join(SEP)}</span>
          </button>
        );
      })}
    </div>
  );
}

function AllRisks() {
  const { live, me, t, today, go } = useApp();
  const risks = allRisks(live, me, today);
  if (!risks.length) return <div className="faint small">{t('rk.none')}</div>;
  return (
    <div className="rk">
      {risks.map((r, i) => (
        <div key={i} className={`rk-i tone-${riskTone(r)}`} {...rowButton(() => go({ view: 'dash', projectId: r.projectId }))}>
          <Tag projectId={r.projectId} />
          <span className="grow">{riskText(t, live, r)}</span>
        </div>
      ))}
    </div>
  );
}

/** One Home card's body, by id (`HOME_CARDS`). */
export function HomeCard({ id }: { id: CardId }) {
  switch (id) {
    case 'projects':
      return <Projects />;
    case 'toMe':
      return <ToMe />;
    case 'confirm':
      return <Confirm />;
    case 'byMe':
      return <ByMe />;
    case 'mine':
      return <Mine />;
    case 'due':
      return <Due />;
    case 'allRisks':
      return <AllRisks />;
    default:
      return null;
  }
}
