import { useState } from 'react';
import { noDots, SEP, userName, type Id } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { NeedChip, Pill, Status } from '../ui/primitives';
import { DeliverForm } from './DeliverForm';
import type { DeliverySection } from './model';

/**
 * One round's delivery card (task 10 brief; `dl-round[data-round][data-status]`). The milestone
 * mark (base `tl-ms` classes, `ui/timeline.css`) opens the header, before the round number and
 * title, never before a need code (R17): need chips inside the account and feedback rows always
 * come first, with any mark or button after them (R17a).
 *
 * - Delivered: the frozen date, items and account (`Delivery`, read as-is, never recomputed),
 *   then the feedback needs born from the round.
 * - Current: the draft is rule-generated output, so it is labelled with `Pill tone="ai"` showing
 *   `app.rules` (tooltip `app.rulesTip`), next to the existing `dl.draft` text (ruling R5 over the
 *   plan's `RulesMark`, which is reserved for extracts and rule-linked stream rows). `dl-deliver`
 *   opens `DeliverForm`.
 * - Planned: nothing yet.
 */
export function RoundSection({ projectId, section }: { projectId: Id; section: DeliverySection }) {
  const { live, t, fmtDay } = useApp();
  const { round, tone, delivered, draft, feedback } = section;
  const [deliverOpen, setDeliverOpen] = useState(false);

  return (
    <section className={`dl${round.status === 'planned' ? ' dl-planned' : ''}`} data-testid="dl-round" data-round={round.n} data-status={round.status}>
      <div className="dl-h">
        <span className={`tl-ms ms-${round.kind} s-${round.status} static`} />
        <strong>{(noDots(round.title) || t('round', { n: round.n }))}</strong>
        <Pill tone={tone}>{t(`round.${round.status}`)}</Pill>
        <span className="small faint">{t('round.due', { d: fmtDay(round.due) }) + SEP + t(round.kind === 'hard' ? 'tl.hard' : 'tl.cadence')}</span>
      </div>

      {round.status === 'delivered' && delivered && (
        <div className="dl-b">
          <div className="small muted">{t('dl.deliveredOn', { d: fmtDay(delivered.date) })}</div>
          <div className="dl-grid">
            <div>
              <h3>{t('dl.items')}</h3>
              {delivered.items.length === 0 ? (
                <div className="faint small">{t('dl.noItems')}</div>
              ) : (
                <ul className="plain">
                  {delivered.items.map((it, i) => (
                    <li key={i}>{noDots(it)}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3>{t('dl.account')}</h3>
              {delivered.account.map((a) => (
                <div key={a.needId} className="row gap6 wrap">
                  <NeedChip projectId={projectId} needId={a.needId} />
                  <Status s={a.status} />
                  {a.note && <span className="small muted">{noDots(a.note)}</span>}
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3>{t('dl.feedback')}</h3>
            {feedback.length === 0 ? (
              <div className="faint small">{t('dl.noFeedback')}</div>
            ) : (
              feedback.map((f) => (
                <div key={f.id} className="fb">
                  <span className="muted">{`“${noDots(f.source.quote)}”${SEP}${t('in.from', { who: noDots(userName(live, f.createdBy)) })}`}</span>
                  <span className="row gap6 wrap">
                    <NeedChip projectId={projectId} needId={f.id} />
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {round.status === 'current' && draft && (
        <div className="dl-b">
          <div className="note row gap6 wrap">
            <Pill tone="ai" title={t('app.rulesTip')}>
              {t('app.rules')}
            </Pill>
            <span className="small">{t('dl.draft')}</span>
          </div>
          <div className="dl-grid">
            <div>
              <h3>{t('dl.planned')}</h3>
              {draft.items.length === 0 ? (
                <div className="faint small">{t('dl.noItems')}</div>
              ) : (
                <ul className="plain">
                  {draft.items.map((it, i) => (
                    <li key={i}>{noDots(it)}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3>{t('dl.account')}</h3>
              {draft.account.map((a) => (
                <div key={a.needId} className="row gap6 wrap">
                  <NeedChip projectId={projectId} needId={a.needId} />
                  <Status s={a.status} />
                </div>
              ))}
            </div>
          </div>
          {deliverOpen ? (
            <DeliverForm round={round} items={draft.items} onDone={() => setDeliverOpen(false)} />
          ) : (
            <button type="button" className="btn btn-primary" data-testid="dl-deliver" onClick={() => setDeliverOpen(true)}>
              {t('dl.deliver')}
            </button>
          )}
        </div>
      )}

      {round.status === 'planned' && <div className="faint small">{t('dl.none')}</div>}
    </section>
  );
}
