import { useState } from 'react';
import { currentRound, projectRounds, type Id, type NeedKind } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { useApp } from '../app/AppContext';
import { newId } from '../model/ids';
import { Btn } from '../ui/primitives';
import { Modal } from '../ui/Modal';
import { useThrowNotice, withBusy } from './busy';
import { newNeedCommand, type NewNeedForm } from './edit';
import './needs.css';

const KINDS: readonly [kind: NeedKind, key: MessageKey][] = [
  ['ext', 'kind.ext'],
  ['hyp', 'kind.hyp'],
];

/**
 * A brand-new need (no prototype counterpart; design §6's empty board needs one): kind, a
 * one-line title, the kind-specific fields (acceptance for an external need, expected effect
 * and test for a hypothesis), a round (defaulting to the current one) and the Only-me switch.
 * Create submits `newNeedCommand`'s payload; an accepted or queued result closes the modal and
 * opens the new need; a rejection (the app context shows its notice) or a throw (with its notice)
 * leaves it open.
 */
export function NewNeedModal({ projectId, onClose }: { projectId: Id; onClose: () => void }) {
  const { t, live, today, submit, openNeed } = useApp();
  const onThrow = useThrowNotice();
  const [needId] = useState(() => newId('n'));
  const [kind, setKind] = useState<NeedKind>('ext');
  const [title, setTitle] = useState('');
  const [accept, setAccept] = useState('');
  const [expect, setExpect] = useState('');
  const [verify, setVerify] = useState('');
  const [roundId, setRoundId] = useState<Id | null>(() => currentRound(live, projectId)?.id ?? null);
  const [priv, setPriv] = useState(false);
  const [busy, setBusy] = useState(false);

  const form: NewNeedForm = { kind, title, accept, expect, verify, roundId, private: priv };
  const cmd = newNeedCommand(form, projectId, needId, today, t('nn.manual'));

  const onCreate = async () => {
    if (!cmd) return;
    const r = await withBusy(setBusy, () => submit(cmd.type, cmd.payload), onThrow);
    if (r?.kind === 'accepted' || r?.kind === 'queued') {
      openNeed(projectId, needId);
      onClose();
    }
  };

  return (
    <Modal onClose={onClose} testId="overlay-new-need">
      <h2>{t('nn.title')}</h2>
      <div className="row gap6 wrap">
        <div className="seg" data-testid="nn-kind">
          {KINDS.map(([k, key]) => (
            <button key={k} type="button" className={kind === k ? 'on' : undefined} disabled={busy} onClick={() => setKind(k)}>
              {t(key)}
            </button>
          ))}
        </div>
      </div>
      <input
        className="inp"
        data-testid="nn-title"
        placeholder={t('nn.titlePh')}
        value={title}
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
      />
      {kind === 'ext' ? (
        <input
          className="inp"
          data-testid="nn-accept"
          placeholder={t('nn.accept')}
          value={accept}
          disabled={busy}
          onChange={(e) => setAccept(e.target.value)}
        />
      ) : (
        <>
          <input
            className="inp"
            data-testid="nn-expect"
            placeholder={t('nn.expect')}
            value={expect}
            disabled={busy}
            onChange={(e) => setExpect(e.target.value)}
          />
          <input
            className="inp"
            data-testid="nn-verify"
            placeholder={t('nn.verify')}
            value={verify}
            disabled={busy}
            onChange={(e) => setVerify(e.target.value)}
          />
        </>
      )}
      <div className="kv">
        <span>{t('nn.round')}</span>
        <select
          className="inp"
          data-testid="nn-round"
          value={roundId ?? ''}
          disabled={busy}
          onChange={(e) => setRoundId(e.target.value === '' ? null : e.target.value)}
        >
          <option value="">{t('round.none')}</option>
          {projectRounds(live, projectId).map((r) => (
            <option key={r.id} value={r.id}>
              {(r.title || t('round', { n: r.n }))}
            </option>
          ))}
        </select>
      </div>
      <div className="seg" data-testid="nn-private">
        <button type="button" className={priv ? undefined : 'on'} disabled={busy} onClick={() => setPriv(false)}>
          {t('pv.project')}
        </button>
        <button type="button" className={priv ? 'on' : undefined} disabled={busy} onClick={() => setPriv(true)}>
          {t('pv.only')}
        </button>
      </div>
      <div className="row gap6 ho-foot">
        <Btn onClick={onClose}>{t('common.cancel')}</Btn>
        <Btn kind="primary" testId="nn-create" disabled={!cmd || busy} onClick={onCreate}>
          {t('nn.create')}
        </Btn>
      </div>
    </Modal>
  );
}
