import { useEffect, useState } from 'react';
import { userName, type Handoff, type Need } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { useThrowNotice, withBusy } from '../needs/busy';
import { Avatar, Btn } from '../ui/primitives';
import { HandoffLine } from '../needs/NeedCard';
import { handoffCommand, handoffView, type HandoffAction } from './model';

/** The textarea + send row for the `ask` note (optional) or the `reopen` note (mandatory). */
function NoteForm({ kind, note, setNote, busy, onSend }: { kind: 'ask' | 'reopen'; note: string; setNote: (v: string) => void; busy: boolean; onSend: () => void }) {
  const { t } = useApp();
  const empty = note.trim() === '';
  return (
    <div className="row gap6 wrap">
      <textarea
        className="inp"
        rows={2}
        data-testid="ho-note"
        placeholder={t(kind === 'ask' ? 'ho.notePh' : 'ho.reopenPh')}
        value={note}
        disabled={busy}
        onChange={(e) => setNote(e.target.value)}
      />
      <Btn testId="ho-note-send" disabled={busy || (kind === 'reopen' && empty)} onClick={onSend}>
        {t(kind === 'ask' ? 'ho.sendQuestion' : 'ho.sendBack')}
      </Btn>
    </div>
  );
}

/**
 * The handoff block in the need drawer (needs3/board.jsx `HandoffBlock`, rebuilt on Task 4's
 * full state machine — `handoffView` for what to show and offer, `handoffCommand` for every
 * submitted command, rather than the prototype's three-state shortcut). Rendered by Task 5's
 * `NeedDrawer` right after the header, once per live handoff (`liveHandoffs`), else for the
 * closed one `shownHandoff` returns. `.hob.hot` (a recipient still deciding on a `sent` handoff)
 * uses the info tone already prefilled in needs/needs.css; it is never violet.
 */
export function HandoffBlock({ need, h }: { need: Need; h: Handoff }) {
  const { t, me, live, submit, openOverlay, fmtDay, fmtDateTime } = useApp();
  const onThrow = useThrowNotice();
  const [form, setForm] = useState<'ask' | 'reopen' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // A different handoff (the drawer switched needs, or this one was superseded) starts fresh.
  useEffect(() => {
    setForm(null);
    setNote('');
    setBusy(false);
  }, [h.id]);

  const view = handoffView(live, h, me);
  const hot = view.role === 'recipient' && h.state === 'sent';
  const other = h.toId === me ? h.fromId : h.toId;

  /** Submits a plain handoff command; every action button is disabled until it settles. */
  const run = async (action: Exclude<HandoffAction, 'copy' | 'decide'>, text?: string) => {
    const cmd = handoffCommand(action, h, text);
    const r = await withBusy(setBusy, () => submit(cmd.type, cmd.payload), onThrow);
    // A rejection (or a throw) leaves the form open (and its note) so the sender can edit and retry.
    if (r?.kind === 'accepted' || r?.kind === 'queued') {
      setForm(null);
      setNote('');
    }
  };

  const toggleForm = (kind: 'ask' | 'reopen') => setForm((f) => (f === kind ? null : kind));
  // `remind` lives inside the staleness warning below, not in the plain action row.
  const rowActions = view.actions.filter((a) => a !== 'remind');

  return (
    <div className={`hob${hot ? ' hot' : ''}`} data-testid="hob" data-handoff={h.id} data-state={h.state}>
      <div className="row gap6">
        <Avatar userId={other} size="sm" />
        <HandoffLine h={h} me={me} />
        <span className="grow" />
        {h.due && <span className="small faint">{t('ho.dueOn', { d: fmtDay(h.due) })}</span>}
      </div>
      <div className="hob-ask">{h.ask}</div>
      {view.note && <div className="small muted">{t('ho.note', { note: view.note })}</div>}

      {view.role === 'sender' && (
        <>
          {view.lastFetch ? (
            <div className="small faint">{t('ho.fetched', { v: view.lastFetch.version, at: fmtDateTime(view.lastFetch.at) })}</div>
          ) : (
            (h.state === 'accepted' || h.state === 'doing') && <div className="small faint">{t('ho.notFetched')}</div>
          )}
          {view.stale && !view.stale.reminded && (
            <div className="hob-warn">
              <span>{t('ho.stale', { v: view.stale.current })}</span>
              {view.actions.includes('remind') && (
                <Btn kind="sm" testId="ho-remind" disabled={busy} onClick={() => run('remind')}>
                  {t('ho.remind')}
                </Btn>
              )}
            </div>
          )}
          {view.stale?.reminded && <div className="small tone-success">{'✓ ' + t('ho.reminded')}</div>}
        </>
      )}

      {view.role === 'recipient' && (
        <>
          {view.lastFetch && <div className="small faint">{t('ho.myFetched', { v: view.lastFetch.version, at: fmtDateTime(view.lastFetch.at) })}</div>}
          {view.refresh !== null && (
            <div className="hob-warn">
              <span>{t('ho.refreshAsked', { who: userName(live, h.fromId), v: view.refresh })}</span>
            </div>
          )}
          {h.state === 'returned' && <div className="small muted">{t('ho.onlySender')}</div>}
        </>
      )}

      {rowActions.length > 0 && (
        <div className="row gap6 wrap">
          {rowActions.map((a) => {
            switch (a) {
              case 'accept':
                return (
                  <Btn key={a} kind="primary" testId="ho-accept" disabled={busy} onClick={() => run('accept')}>
                    {t('ho.accept')}
                  </Btn>
                );
              case 'ask':
                return (
                  <Btn key={a} testId="ho-ask" disabled={busy} onClick={() => toggleForm('ask')}>
                    {t('ho.question')}
                  </Btn>
                );
              case 'decline':
                return (
                  <Btn key={a} testId="ho-decline" disabled={busy} onClick={() => run('decline')}>
                    {t('ho.decline')}
                  </Btn>
                );
              case 'start':
                return (
                  <Btn key={a} testId="ho-start" disabled={busy} onClick={() => run('start')}>
                    {t('ho.start')}
                  </Btn>
                );
              case 'copy':
                return (
                  <Btn key={a} testId="ho-copy" disabled={busy} onClick={() => openOverlay({ kind: 'link', projectId: need.projectId, needId: need.id })}>
                    {t('lk.btn')}
                  </Btn>
                );
              case 'return':
                return (
                  <Btn key={a} testId="ho-return" disabled={busy} onClick={() => run('return')}>
                    {t('ho.return')}
                  </Btn>
                );
              case 'confirm':
                return (
                  <Btn key={a} kind="primary" testId="ho-confirm" disabled={busy} onClick={() => run('confirm')}>
                    {t('ho.confirm')}
                  </Btn>
                );
              case 'reopen':
                return (
                  <Btn key={a} testId="ho-reopen" disabled={busy} onClick={() => toggleForm('reopen')}>
                    {t('ho.reopen')}
                  </Btn>
                );
              case 'decide':
                return (
                  <Btn key={a} testId="ho-decide" disabled={busy} onClick={() => openOverlay({ kind: 'confirm', projectId: need.projectId })}>
                    {t('ho.decision')}
                  </Btn>
                );
              default:
                return null;
            }
          })}
        </div>
      )}

      {form && <NoteForm kind={form} note={note} setNote={setNote} busy={busy} onSend={() => void run(form, note.trim() === '' ? undefined : note.trim())} />}
    </div>
  );
}
