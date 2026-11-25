import { useState } from 'react';
import { currentOrLatestRound, type Id } from '@meetless/core';
import type { Overlay } from '../app/overlays';
import { useApp } from '../app/AppContext';
import { newId } from '../model/ids';
import { useThrowNotice, withBusy } from '../needs/busy';
import { displayName } from '../model/state';
import { Avatar, Btn } from '../ui/primitives';
import { Modal } from '../ui/Modal';
import { dueChoices, handoffPayload, handoffPeople, type DueChoice, type PeopleGroup } from './model';
import { PromptBox } from './PromptBox';
import './collab.css';

/** `overlay.toId` when it is one of the listed people, else the first listed person, else null. */
function initialTo(groups: PeopleGroup[], toId: Id | null | undefined): Id | null {
  const all = groups.flatMap((g) => g.memberIds);
  if (toId && all.includes(toId)) return toId;
  return all[0] ?? null;
}

/** The close `×`, shared by the "not available" and "private" placeholders. */
function CloseButton({ onClose }: { onClose: () => void }) {
  const { t } = useApp();
  return (
    <button type="button" className="x" aria-label={t('close')} title={t('close')} onClick={onClose}>
      {'×'}
    </button>
  );
}

/**
 * The handoff modal (needs3/collab.jsx `HandoffModal`, no kind mark): title, then the code and
 * title of the need; who takes it, grouped by role (`handoffPeople`); the ask; the due date
 * (`dueChoices`, with the round's own deadline when `currentOrLatestRound` offers one); the
 * preview of what the recipient receives (Task 7's `PromptBox`); and Send, which submits
 * `handoff.created` built by `handoffPayload`. The owner never changes here: core sets it on
 * accept. A need outside `live` (unknown id, or a projectId mismatch) renders only `dr.missing`
 * and the close, like `NeedDrawer`'s placeholder. A private need renders only `ho.privateFirst`
 * and the close: no people, no preview, no Send (it must be shared first).
 */
export function HandoffModal({ overlay }: { overlay: Extract<Overlay, { kind: 'handoff' }> }) {
  const { t, me, live, today, fmtDay, submit, closeOverlay } = useApp();
  const onThrow = useThrowNotice();
  const n = live.needs[overlay.needId];
  const found = n && n.projectId === overlay.projectId ? n : null;
  const priv = found ? found.privateTo !== null : false;

  const groups = found && !priv ? handoffPeople(live, overlay.projectId, me) : [];
  const [to, setTo] = useState<Id | null>(() => initialTo(groups, overlay.toId));
  const [ask, setAsk] = useState(overlay.ask ?? '');
  const [due, setDue] = useState<DueChoice['key']>('week');
  const [busy, setBusy] = useState(false);

  if (!found) {
    return (
      <Modal onClose={closeOverlay} wide testId="overlay-handoff">
        <div className="row gap6">
          <p className="faint small grow">{t('dr.missing')}</p>
          <CloseButton onClose={closeOverlay} />
        </div>
      </Modal>
    );
  }

  if (priv) {
    return (
      <Modal onClose={closeOverlay} wide testId="overlay-handoff">
        <div className="row gap6">
          <p className="faint small grow">{t('ho.privateFirst')}</p>
          <CloseButton onClose={closeOverlay} />
        </div>
      </Modal>
    );
  }

  const choices = dueChoices(today, currentOrLatestRound(live, overlay.projectId));
  const chosen = choices.find((c) => c.key === due) ?? choices[0]!;

  const onSend = async () => {
    if (to === null) return;
    const payload = handoffPayload({ handoffId: newId('h'), projectId: overlay.projectId, need: found, toId: to, ask, due: chosen.date });
    const r = await withBusy(setBusy, () => submit('handoff.created', payload), onThrow);
    if (r?.kind === 'accepted' || r?.kind === 'queued') closeOverlay();
  };

  return (
    <Modal onClose={closeOverlay} wide testId="overlay-handoff">
      <h2>{t('ho.title')}</h2>
      <div className="row gap6 small faint">
        <span className="mono">{found.code}</span>
        <span className="grow">{found.title}</span>
        <CloseButton onClose={closeOverlay} />
      </div>
      {groups.length === 0 ? (
        <p className="faint small">{t('ho.nobody')}</p>
      ) : (
        groups.map((g, gi) => (
          <div key={g.roleName ?? `norole-${gi}`}>
            <div className="small faint">{g.roleName ?? t('ho.noRole')}</div>
            <div className="people">
              {g.memberIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`person${to === id ? ' on' : ''}`}
                  data-testid="ho-person"
                  data-person={id}
                  onClick={() => setTo(id)}
                >
                  <Avatar userId={id} />
                  <span className="grow">
                    <span className="person-n" title={displayName(live, id)}>
                      {displayName(live, id)}
                    </span>
                  </span>
                  {to === id && <span>{'✓'}</span>}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
      <textarea className="inp" rows={2} placeholder={t('ho.askPh')} value={ask} onChange={(e) => setAsk(e.target.value)} data-testid="ho-ask-text" />
      <div className="row gap6 wrap">
        <span className="small faint">{t('ho.due')}</span>
        {choices.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`chip${due === c.key ? ' on' : ''}`}
            data-testid="ho-due"
            data-due={c.key}
            onClick={() => setDue(c.key)}
          >
            {t(`ho.d.${c.key}`)} {fmtDay(c.date)}
          </button>
        ))}
      </div>
      <h3>{t('ho.preview')}</h3>
      <PromptBox projectId={overlay.projectId} needId={overlay.needId} />
      <div className="row gap6 ho-foot">
        <Btn onClick={closeOverlay}>{t('common.cancel')}</Btn>
        <Btn kind="primary" testId="ho-send" disabled={to === null || busy} onClick={onSend}>
          {t('ho.send')}
        </Btn>
      </div>
    </Modal>
  );
}
