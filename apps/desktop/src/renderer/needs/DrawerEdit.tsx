import { useEffect, useState } from 'react';
import { EXT_STATUSES, HYP_STATUSES, membersOf, userName, type Id, type Need, type NeedStatus } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import type { SubmitResult } from '@meetless/client/bridge';
import { useApp } from '../app/AppContext';
import { newId } from '../model/ids';
import { Btn } from '../ui/primitives';
import { useThrowNotice, withBusy } from './busy';
import { ownerCommand, reviseCommand, statusChanged, statusCommand } from './edit';

/**
 * The revise form `dr-revise` opens: the new wording and the reason, and `dr-revise-send`,
 * disabled until both are filled. An accepted or queued revision closes it (`onDone`); a refusal
 * or a throw keeps the draft. The revision id is minted at submit time.
 */
export function ReviseForm({ need, busy, setBusy, onDone }: { need: Need; busy: boolean; setBusy: (b: boolean) => void; onDone: () => void }) {
  const { t, today, submit } = useApp();
  const onThrow = useThrowNotice();
  const [text, setText] = useState('');
  const [why, setWhy] = useState('');
  const ready = reviseCommand(need, text, why, 'draft', today) !== null;

  const onRevise = async (): Promise<void> => {
    const cmd = reviseCommand(need, text, why, newId('rev'), today);
    if (!cmd) return;
    const r: SubmitResult | undefined = await withBusy(setBusy, () => submit(cmd.type, cmd.payload), onThrow);
    if (r?.kind === 'accepted' || r?.kind === 'queued') onDone();
  };

  return (
    <div className="stack" data-testid="dr-revise-form">
      <input className="inp" data-testid="nn-revise-text" placeholder={t('nn.reviseText')} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} />
      <input className="inp" data-testid="nn-revise-why" placeholder={t('nn.reviseWhy')} value={why} disabled={busy} onChange={(e) => setWhy(e.target.value)} />
      <div className="row gap6">
        <Btn kind="primary" testId="dr-revise-send" disabled={busy || !ready} onClick={onRevise}>
          {t('nn.revise')}
        </Btn>
        <Btn disabled={busy} onClick={onDone}>
          {t('common.cancel')}
        </Btn>
      </div>
    </div>
  );
}

/**
 * The need's own edit controls (contract §2 "need edits"; the prototype has no such form), set
 * inside the drawer's `dr.meta` (`NeedDrawer` passes this as `MetaSection`'s children): its
 * status, with a verdict field for a hypothesis; its owner; and `dr-revise`, which opens the
 * `ReviseForm`. The selects stay compact and the form stays closed until asked for, so the
 * drawer's activity and artifacts are not pushed below the fold.
 *
 * `busy`/`setBusy` default to a local flag but are normally the drawer's own shared one (passed
 * by `NeedDrawer`, the same lock the header's hand-off/share buttons and the round fix use), so
 * only one submit across the whole drawer is ever in flight at a time.
 *
 * The status and owner selects read straight from `need` (like `RoundRow` does for its round):
 * there is no local copy of `need.status`/`need.ownerId` that could drift from what the server
 * actually holds. While a change is in flight the select shows the value just picked
 * (`pendingStatus`/`pendingOwner`); once the submit settles that overlay is dropped, so a
 * rejection simply falls back to `need`'s own (unchanged) value, and an acceptance shows the
 * new one as soon as `need` itself reflects it.
 */
export function DrawerEdit({ need, busy: busyProp, setBusy: setBusyProp }: { need: Need; busy?: boolean; setBusy?: (b: boolean) => void }) {
  const { t, live, submit } = useApp();
  const onThrow = useThrowNotice();
  const [busyLocal, setBusyLocal] = useState(false);
  const busy = busyProp ?? busyLocal;
  const setBusy = setBusyProp ?? setBusyLocal;

  const [pendingStatus, setPendingStatus] = useState<NeedStatus | null>(null);
  const [pendingOwner, setPendingOwner] = useState<{ id: Id | null } | null>(null);
  const [verdict, setVerdict] = useState(need.verdict ?? '');
  const [revising, setRevising] = useState(false);

  // The drawer can switch to a different need without unmounting: close the revise form and
  // any in-flight overlay left over from the need that was showing before, and re-seed the
  // verdict field from the new need. Changing need.status/verdict/ownerId on *this* need (our
  // own submit landing, or someone else's) must not run this: it would close an open revise
  // form for no reason, since the status/owner selects already read `need` directly.
  useEffect(() => {
    setPendingStatus(null);
    setPendingOwner(null);
    setVerdict(need.verdict ?? '');
    setRevising(false);
  }, [need.id]);

  const statuses = need.kind === 'ext' ? EXT_STATUSES : HYP_STATUSES;
  const status = pendingStatus ?? need.status;
  const ownerId = pendingOwner ? pendingOwner.id : need.ownerId;

  const onStatus = async (next: NeedStatus): Promise<void> => {
    const cmd = statusCommand(need, next, verdict);
    setPendingStatus(next);
    await withBusy(setBusy, () => submit(cmd.type, cmd.payload), onThrow);
    setPendingStatus(null);
  };

  const onVerdictBlur = async (): Promise<void> => {
    if (!statusChanged(need, status, verdict)) return;
    const cmd = statusCommand(need, status, verdict);
    setPendingStatus(status);
    await withBusy(setBusy, () => submit(cmd.type, cmd.payload), onThrow);
    setPendingStatus(null);
  };

  const onOwner = async (next: Id | null): Promise<void> => {
    const cmd = ownerCommand(need, next);
    setPendingOwner({ id: next });
    await withBusy(setBusy, () => submit(cmd.type, cmd.payload), onThrow);
    setPendingOwner(null);
  };

  return (
    <>
      <div className="kv">
        <span>{t('nn.status')}</span>
        <span className="row gap6 wrap">
          <select className="inp inp-c" data-testid="dr-status" value={status} disabled={busy} onChange={(e) => onStatus(e.target.value as NeedStatus)}>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {t(`st.${s}` as MessageKey)}
              </option>
            ))}
          </select>
          {need.kind === 'hyp' && (
            <input
              className="inp inp-c"
              data-testid="dr-verdict"
              placeholder={t('nn.verdict')}
              value={verdict}
              disabled={busy}
              onChange={(e) => setVerdict(e.target.value)}
              onBlur={onVerdictBlur}
            />
          )}
        </span>
      </div>
      <div className="kv">
        <span>{t('own.owner')}</span>
        <select
          className="inp inp-c"
          data-testid="dr-owner"
          value={ownerId ?? ''}
          disabled={busy}
          onChange={(e) => onOwner(e.target.value === '' ? null : e.target.value)}
        >
          <option value="">{t('own.none')}</option>
          {membersOf(live, need.projectId).map((id) => (
            <option key={id} value={id}>
              {userName(live, id)}
            </option>
          ))}
        </select>
      </div>
      <div className="row gap6">
        <Btn kind="sm" testId="dr-revise" aria-expanded={revising} disabled={busy} onClick={() => setRevising((r) => !r)}>
          {t('nn.revise')}
        </Btn>
      </div>
      {revising && <ReviseForm key={need.id} need={need} busy={busy} setBusy={setBusy} onDone={() => setRevising(false)} />}
    </>
  );
}
