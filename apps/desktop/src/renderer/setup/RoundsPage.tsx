import { useState } from 'react';
import { daysBetween, projectRounds, SEP, type Id, type Round } from '@meetless/core';
import { leftText } from '../dash/model';
import type { MessageKey } from '@meetless/i18n';
import { useApp } from '../app/AppContext';
import type { PageProps } from '../app/pages';
import { newId } from '../model/ids';
import { Btn } from '../ui/primitives';
import { Timeline } from '../ui/Timeline';
import { canSubmitRound, ddlStart, nextRoundDraft, roundCreateCommand, roundDraftError, roundUpdateCommand, type RoundDraft } from './model';
import './setup.css';

/** Round status as coloured text, never a dot (contract: no dot symbols anywhere). */
const STATUS_TONE: Record<Round['status'], 'info' | 'neutral' | 'success'> = {
  current: 'info',
  planned: 'neutral',
  delivered: 'success',
};

/**
 * The round fields (title, kind, start, due) shared by the add form and inline edit — the page
 * opens "the same fields inline" to edit a round. `prefix` keeps every field's testid unique on
 * the page: the add form uses `round` (`round-title`, `round-kind`, ...), inline edit uses
 * `round-edit` (`round-edit-title`, ...), so an editing row and the add form below it never
 * collide even though they render at the same time.
 */
function RoundFields({ prefix, draft, onChange }: { prefix: string; draft: RoundDraft; onChange: (d: RoundDraft) => void }) {
  const { t } = useApp();
  return (
    <div className="round-fields">
      <input
        className="inp"
        value={draft.title}
        onChange={(e) => onChange({ ...draft, title: e.target.value })}
        placeholder={t('pj.roundTitle')}
        aria-label={t('pj.roundTitle')}
        data-testid={`${prefix}-title`}
      />
      <input
        className="inp"
        type="date"
        value={draft.start}
        onChange={(e) => onChange({ ...draft, start: e.target.value })}
        aria-label={t('pj.roundStart')}
        title={t('pj.roundStart')}
        data-testid={`${prefix}-start`}
      />
      <input
        className="inp"
        type="date"
        value={draft.due}
        onChange={(e) => onChange({ ...draft, due: e.target.value })}
        aria-label={t('pj.roundDue')}
        data-testid={`${prefix}-due`}
      />
    </div>
  );
}

/**
 * Rounds setup (contract §8, design §8.4): the project's `Timeline`, then one row per round
 * (its title, kind, date range and status as coloured text), a "make current" action on planned
 * rows, an "edit" action that opens the same fields inline on rows that are not delivered, and
 * the add-round form. Like `MembersPage` and `NewProjectPage`, it renders no composer (ruling
 * R14): base `test/skeleton.test.tsx`'s `COMPOSER_VIEWS` leaves out `rounds` and asserts zero
 * composers there, so `composer` is accepted but never called.
 */
export function RoundsPage(_props: PageProps) {
  const { route, live, today, t, fmtDay, submit } = useApp();
  // Hooks always run, whatever `route` carries (Rules of Hooks): the `projectId in route` guard
  // below only decides what's returned, never which hooks are called.
  const projectId = 'projectId' in route ? route.projectId : null;
  const rounds = projectId ? projectRounds(live, projectId) : [];
  const [draft, setDraft] = useState<RoundDraft>(() => nextRoundDraft(rounds, today));
  const [addBusy, setAddBusy] = useState(false);
  const [addTried, setAddTried] = useState(false);
  const [editing, setEditing] = useState<Id | null>(null);
  const [editDraft, setEditDraft] = useState<RoundDraft | null>(null);
  const [editTried, setEditTried] = useState(false);
  const [editBusy, setEditBusy] = useState(false);

  if (!projectId) return null;

  const addError = addTried ? roundDraftError(t, draft) : null;

  const addRound = async () => {
    setAddTried(true);
    if (!canSubmitRound(t, draft, addBusy)) return;
    const roundId = newId('rnd');
    const cmd = roundCreateCommand(projectId, draft, roundId, ddlStart(rounds, draft.due, today));
    setAddBusy(true);
    const r = await submit(cmd.type, cmd.payload);
    setAddBusy(false);
    if (r.kind !== 'rejected') {
      setAddTried(false);
      // Only `due` feeds nextRoundDraft; the rest of this round stub is never read.
      setDraft(nextRoundDraft([...rounds, { due: draft.due } as Round], today));
    }
  };

  const startEdit = (r: Round) => {
    setEditing(r.id);
    setEditDraft({ title: r.title, kind: r.kind, start: r.start, due: r.due });
    setEditTried(false);
  };

  const saveEdit = async (r: Round) => {
    if (!editDraft) return;
    setEditTried(true);
    if (!canSubmitRound(t, editDraft, editBusy)) return;
    const cmd = roundUpdateCommand(r, editDraft);
    if (!cmd) {
      setEditing(null);
      return;
    }
    setEditBusy(true);
    const res = await submit(cmd.type, cmd.payload);
    setEditBusy(false);
    if (res.kind !== 'rejected') setEditing(null);
  };

  return (
    <div className="page" data-testid="page-rounds">
      <h1>{t('pj.rounds')}</h1>
      <Timeline projectId={projectId} />
      {rounds.length === 0 ? (
        <p className="small muted">{t('pj.noRounds')}</p>
      ) : (
        <div className="tools">
          {rounds.map((r) => {
            const delivered = r.status === 'delivered';
            const isEditing = editing === r.id;
            return (
              <div className="tool" key={r.id} data-testid="round" data-round={r.n} title={delivered ? t('pj.frozen') : undefined}>
                {isEditing && editDraft ? (
                  <>
                    <RoundFields prefix="round-edit" draft={editDraft} onChange={setEditDraft} />
                    {editTried && roundDraftError(t, editDraft) && (
                      <span className="small tone-danger" data-testid="round-edit-error">
                        {roundDraftError(t, editDraft)}
                      </span>
                    )}
                    <Btn kind="primary" testId="round-edit-save" disabled={editBusy} onClick={() => void saveEdit(r)}>
                      {t('common.save')}
                    </Btn>
                  </>
                ) : (
                  <span className="grow">
                    {r.title || t('round', { n: r.n })}
                    {SEP}
                    <span className="small muted">{fmtDay(r.due)}</span>
                    {r.status !== 'delivered' && (
                      <>
                        {SEP}
                        <span className="small muted">{leftText(t, daysBetween(today, r.due))}</span>
                      </>
                    )}
                  </span>
                )}
                <span className={`st tone-${STATUS_TONE[r.status]}`}>{t(`round.${r.status}` as MessageKey)}</span>
                {!isEditing && r.status === 'planned' && (
                  <Btn testId="round-start-now" onClick={() => void submit('round.started', { roundId: r.id })}>
                    {t('round.makeCurrent')}
                  </Btn>
                )}
                {!isEditing && !delivered && (
                  <Btn testId="round-edit" onClick={() => startEdit(r)}>
                    {t('pj.edit')}
                  </Btn>
                )}
              </div>
            );
          })}
        </div>
      )}

      <h2 className="h3">{t('pj.addRound')}</h2>
      <div className="tool">
        <RoundFields prefix="round" draft={draft} onChange={setDraft} />
        {addError && (
          <span className="small tone-danger" data-testid="round-error">
            {addError}
          </span>
        )}
        <Btn kind="primary" testId="round-add" disabled={addBusy} onClick={() => void addRound()}>
          {t('pj.addRound')}
        </Btn>
      </div>
    </div>
  );
}
