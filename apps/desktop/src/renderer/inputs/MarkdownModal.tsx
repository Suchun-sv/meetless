import { useState } from 'react';
import type { Id } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { Modal } from '../ui/Modal';
import { Btn } from '../ui/primitives';
import { importMarkdown } from './importer';
import { requesterFrom } from './model';

/** Write a Markdown note straight into the project (prototype `MdModal`; task 8 brief). */
export function MarkdownModal({ projectId, onClose }: { projectId: Id; onClose: () => void }) {
  const app = useApp();
  const { live, t, notify, errorText } = app;
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);

  const canGo = text.trim().length > 0 && !busy;

  const go = async () => {
    if (!canGo) return;
    setBusy(true);
    const requester = requesterFrom(live, projectId, from);
    const r = await importMarkdown(app, { projectId, title, text, from: requester, private: isPrivate });
    setBusy(false);
    if (!r.ok) {
      notify('error', r.code === 'EMPTY_FILE' ? t('in.emptyFile') : errorText(r.code));
      return;
    }
    onClose();
  };

  return (
    <Modal onClose={onClose} testId="md-modal">
      <div className="row">
        <h2 className="grow">{t('in.mdTitle')}</h2>
        <button type="button" className="x" onClick={onClose} aria-label={t('close')}>
          ×
        </button>
      </div>
      <label className="stack">
        <span className="small muted">{t('in.mdName')}</span>
        <input className="inp" data-testid="md-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="stack">
        <span className="small muted">{t('in.mdPh')}</span>
        <textarea className="inp ta" data-testid="md-text" placeholder={t('in.mdPh')} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="stack">
        <span className="small muted">{t('in.fromPh')}</span>
        <input className="inp" data-testid="md-from" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="row gap6 small">
        <input type="checkbox" data-testid="md-priv-only" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
        {t('pv.only')}
      </label>
      <div className="row gap6 md-foot">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <Btn kind="primary" testId="md-go" disabled={!canGo} onClick={go}>
          {t('in.mdGo')}
        </Btn>
      </div>
    </Modal>
  );
}
