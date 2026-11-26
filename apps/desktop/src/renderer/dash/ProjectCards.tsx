import {
  activityCard,
  currentRound,
  deliveryCard,
  hypothesesCard,
  membersCard,
  progressCard,
  projectRounds,
  riskList,
  sourcesCard,
  weeklyCard,
  SEP,
  type CardId,
  type Id,
  type Risk,
} from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { useApp } from '../app/AppContext';
import { displayName } from '../model/state';
import { Avatar, NeedChip, Status } from '../ui/primitives';
import { Timeline } from '../ui/Timeline';
import { riskTone } from '../ui/tone';
import { leftText, riskTarget, riskText } from './model';
import { Bar, CardEmpty, rowButton } from './parts';

/*
 * The eight project dashboard cards (contract §8, Task 6), ported from the prototype's
 * `ProjectWidget`. Each reads core's card functions, which already exclude private items
 * (`dashboard.ts`'s own `shared`/`sharedWork`), so none of these need their own privacy filter.
 */

const HYP_STATUSES = ['held', 'refuted', 'testing', 'untested'] as const;

/** Where a risk row's click goes: the need, the confirm overlay, or an inputs/need view. */
function useRiskNav(): (r: Risk) => void {
  const { go, openNeed, openOverlay } = useApp();
  return (r) => {
    const target = riskTarget(r);
    if ('open' in target) openNeed(target.open.projectId, target.open.needId);
    else if ('overlay' in target) openOverlay(target.overlay);
    else go(target.go);
  };
}

function Progress({ projectId }: { projectId: Id }) {
  const { live, t, today, fmtDay, go } = useApp();
  const pc = progressCard(live, projectId, today);
  if (!pc.round) {
    return (
      <div className="pg">
        <div className="pg-big">{leftText(t, null)}</div>
        <button type="button" className="btn btn-sm" data-testid="pg-set-rounds" onClick={() => go({ view: 'rounds', projectId })}>
          {t('pg.setRounds')}
        </button>
      </div>
    );
  }
  const { round } = pc;
  return (
    <div className="pg">
      <div className="pg-top">
        <div>
          <div className="pg-big">{leftText(t, pc.daysLeft)}</div>
          <div className="muted">{[round.title || t('round', { n: round.n }), t('round.due', { d: fmtDay(round.due) })].join(SEP)}</div>
        </div>
      </div>
      <Bar a={pc.done} b={pc.ext} />
      <div className="pg-row">
        <span>{t('pg.done', { a: pc.done, b: pc.ext })}</span>
        <span>{t('pg.doing', { n: pc.doing })}</span>
        <span>{t('pg.todo', { n: pc.todo })}</span>
        <span>{t('pg.hyp', { n: pc.hypTesting })}</span>
      </div>
    </div>
  );
}

function Risks({ projectId }: { projectId: Id }) {
  const { live, me, t, today } = useApp();
  const nav = useRiskNav();
  const list = riskList(live, me, projectId, today);
  if (!list.length) return <div className="faint small">{t('rk.none')}</div>;
  return (
    <div className="rk">
      {list.map((r, i) => (
        <div key={i} className={`rk-i tone-${riskTone(r)}`} {...rowButton(() => nav(r))}>
          <span className="grow">{riskText(t, live, r)}</span>
          {r.needId && <NeedChip projectId={projectId} needId={r.needId} />}
        </div>
      ))}
    </div>
  );
}

function Members({ projectId }: { projectId: Id }) {
  const { live, t, fmtDay } = useApp();
  const rows = membersCard(live, projectId);
  return (
    <div className="mb">
      {rows.map((row) => (
        <div key={row.userId} className="mb-i">
          <Avatar userId={row.userId} />
          <div className="grow">
            <div className="row gap6">
              <strong className="mb-n" title={displayName(live, row.userId)}>
                {displayName(live, row.userId)}
              </strong>
              <span className="faint small mb-m">{row.role ?? t('pj.noRole')}</span>
              <span className="grow" />
              <span className="small muted mb-m">{t('mb.owns', { n: row.owns })}</span>
            </div>
            <div className="small muted mb-l">{row.last ? [fmtDay(row.last.date), row.last.text].join(SEP) : t('mb.none')}</div>
            {row.handoffs.map((h) => (
              <div key={h.id} className="small faint">
                {[
                  live.needs[h.needId]?.code ?? '',
                  h.toId === row.userId ? t('ho.from', { who: displayName(live, h.fromId) }) : t('ho.to', { who: displayName(live, h.toId) }),
                  t(`ho.st.${h.state}` as MessageKey),
                ].join(SEP)}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Delivery({ projectId }: { projectId: Id }) {
  const { live, t, go } = useApp();
  const dc = deliveryCard(live, projectId);
  if (!dc.round) return <CardEmpty text={t('pg.noRound')} action={t('pg.setRounds')} onAction={() => go({ view: 'rounds', projectId })} />;
  if (!dc.lines.length) return <CardEmpty text={t('db.deliveryEmpty')} action={t('db.openInputs')} onAction={() => go({ view: 'inputs', projectId })} />;
  return (
    <div className="stack">
      {dc.lines.map((line) => (
        <div key={line.needId} className="dl-i">
          <NeedChip projectId={projectId} needId={line.needId} />
          <span className="grow" />
          <Status s={line.status} />
        </div>
      ))}
    </div>
  );
}

function Hyps({ projectId }: { projectId: Id }) {
  const { live, t, go } = useApp();
  const hc = hypothesesCard(live, projectId);
  return (
    <div className="stack">
      <div className="hy-row">
        {HYP_STATUSES.map((s) => (
          <div key={s} className="hy-c">
            <div className="hy-n">{hc.counts[s]}</div>
            <Status s={s} />
          </div>
        ))}
      </div>
      {hc.recent.length === 0 && <CardEmpty text={t('db.hypsEmpty')} action={t('db.openBoard')} onAction={() => go({ view: 'board', projectId })} />}
      {hc.recent.map((needId) => (
        <div key={needId} className="dl-i">
          <NeedChip projectId={projectId} needId={needId} />
          <span className="grow" />
          <Status s={live.needs[needId]!.status} />
        </div>
      ))}
    </div>
  );
}

function Activity({ projectId }: { projectId: Id }) {
  const { live, t, fmtDay, go } = useApp();
  const items = activityCard(live, projectId);
  if (!items.length) return <CardEmpty text={t('db.activityEmpty')} action={t('db.openBoard')} onAction={() => go({ view: 'board', projectId })} />;
  return (
    <div className="act">
      {items.map((w) => (
        <div key={w.id} className="act-i">
          <span className="act-d faint small">{fmtDay(w.date)}</span>
          <Avatar userId={w.by} size="sm" />
          <span className="grow act-t">{w.text}</span>
          {w.needId && <NeedChip projectId={projectId} needId={w.needId} />}
        </div>
      ))}
    </div>
  );
}

function Sources({ projectId }: { projectId: Id }) {
  const { live, t, go } = useApp();
  const rows = sourcesCard(live, projectId);
  if (!rows.length) return <CardEmpty text={t('db.sourcesEmpty')} action={t('db.openInputs')} onAction={() => go({ view: 'inputs', projectId })} />;
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <div className="stack">
      {rows.map((row) => (
        <div key={row.key} className="src-i">
          <span className="src-n">{row.userId ? displayName(live, row.userId) : row.name ?? ''}</span>
          <Bar a={row.count} b={max} grow />
          <span className="small faint">{t('sr.count', { n: row.count })}</span>
        </div>
      ))}
    </div>
  );
}

function Weekly({ projectId }: { projectId: Id }) {
  const { live, t, today, go } = useApp();
  const rows = weeklyCard(live, projectId, today);
  if (!rows.length) return <CardEmpty text={t('db.weeklyEmpty')} action={t('db.openBoard')} onAction={() => go({ view: 'board', projectId })} />;
  return (
    <div className="stack">
      {rows.map((row) => (
        <div key={row.userId} className="mb-i">
          <Avatar userId={row.userId} size="sm" />
          <div className="grow">
            <div className="row gap6">
              <strong className="small">{displayName(live, row.userId)}</strong>
              <span className="small faint">{t('wk.items', { n: row.count })}</span>
            </div>
            <div className="small muted mb-l">{row.last.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The project's rounds with the today line, the current round marked; a round opens Deliveries at it. */
function RoundsCard({ projectId }: { projectId: Id }) {
  const { live, go, t } = useApp();
  const cur = currentRound(live, projectId);
  if (projectRounds(live, projectId).length === 0) return <p className="muted small">{t('dl.noRounds')}</p>;
  return <Timeline projectId={projectId} events="on" selected={cur?.n ?? null} onSelect={(n) => go({ view: 'deliveries', projectId, ...(n !== null ? { round: n } : cur ? { round: cur.n } : {}) })} />;
}

/** One project dashboard card's body, by id. Home-only card ids never reach this (`ProjectDashPage` only ever asks for `PROJECT_CARDS`). */
export function ProjectCard({ id, projectId }: { id: CardId; projectId: Id }) {
  switch (id) {
    case 'timeline':
      return <RoundsCard projectId={projectId} />;
    case 'progress':
      return <Progress projectId={projectId} />;
    case 'risks':
      return <Risks projectId={projectId} />;
    case 'members':
      return <Members projectId={projectId} />;
    case 'delivery':
      return <Delivery projectId={projectId} />;
    case 'hyps':
      return <Hyps projectId={projectId} />;
    case 'activity':
      return <Activity projectId={projectId} />;
    case 'sources':
      return <Sources projectId={projectId} />;
    case 'weekly':
      return <Weekly projectId={projectId} />;
    default:
      return null;
  }
}
