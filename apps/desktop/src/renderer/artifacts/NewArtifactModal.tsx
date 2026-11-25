import { useRef, useState } from 'react';
import { ARTIFACT_KINDS, clip, currentRound, noDots, type ArtifactKind, type Id } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { newId } from '../model/ids';
import { Modal } from '../ui/Modal';
import { Btn } from '../ui/primitives';
import { createArtifact } from './actions';
import { acceptFor, checkUrl, DEFAULT_WHERE, fileKinds, keepLinkable, linkableNeeds } from './model';

/** Create an artifact: kind, title, where it lives, an optional link, privacy, linked needs, and an optional first version. */
export function NewArtifactModal({ projectId, onClose, onCreated }: { projectId: Id; onClose: () => void; onCreated: (artifactId: Id) => void }) {
  const { live, today, t, submit, bridge, notify, errorText } = useApp();
  const [kind, setKind] = useState<ArtifactKind>('pdf');
  const [title, setTitle] = useState('');
  const [where, setWhere] = useState(DEFAULT_WHERE.pdf);
  const [url, setUrl] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [needIds, setNeedIds] = useState<Id[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Only the needs this privacy may link (I6): a shared artifact never offers my private needs.
  const needs = linkableNeeds(live, projectId, isPrivate);
  const urlOk = checkUrl(kind, url) === 'ok';
  const canCreate = title.trim().length > 0 && urlOk && !busy;

  const changeKind = (k: ArtifactKind) => {
    setKind(k);
    setWhere(DEFAULT_WHERE[k]);
    setUrl('');
  };

  const toggleNeed = (id: Id) => setNeedIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const changePrivate = (v: boolean) => {
    setIsPrivate(v);
    // Unticking "Only me" drops any private need ticked while it was on.
    if (!v) setNeedIds((xs) => keepLinkable(live, xs, false));
  };

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    const artifactId = newId('a');
    const ok = await createArtifact(
      { submit, uploadBlob: bridge.uploadBlob, notify, errorText },
      {
        artifactId,
        versionId: newId('v'),
        projectId,
        kind,
        title: title.trim(),
        where: where.trim(),
        url: url.trim() || null,
        needIds: keepLinkable(live, needIds, isPrivate),
        isPrivate,
        file: fileRef.current?.files?.[0] ?? null,
        today,
        roundId: currentRound(live, projectId)?.id ?? null,
      },
    );
    setBusy(false);
    // A refused artifact.created (its notice is already shown) keeps the modal open, input intact.
    if (!ok) return;
    onCreated(artifactId);
    onClose();
  };

  return (
    <Modal onClose={onClose} testId="afn-modal">
      <div className="row">
        <h2 className="grow">{t('af.new')}</h2>
        <button type="button" className="x" onClick={onClose} aria-label={t('close')}>
          ×
        </button>
      </div>
      <label className="stack">
        <span className="small muted">{t('af.kind')}</span>
        <select className="inp" data-testid="afn-kind" value={kind} onChange={(e) => changeKind(e.target.value as ArtifactKind)}>
          {ARTIFACT_KINDS.map((k) => (
            <option key={k} value={k}>
              {DEFAULT_WHERE[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="stack">
        <span className="small muted">{t('af.title')}</span>
        <input className="inp" data-testid="afn-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="stack">
        <span className="small muted">{t('af.where')}</span>
        <input className="inp" data-testid="afn-where" value={where} onChange={(e) => setWhere(e.target.value)} />
      </label>
      <label className="stack">
        <span className="small muted">{t('af.url')}</span>
        <input className="inp" data-testid="afn-url" value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label className="row gap6 small">
        <input type="checkbox" data-testid="afn-private" checked={isPrivate} onChange={(e) => changePrivate(e.target.checked)} />
        {t('pv.only')}
      </label>
      {needs.length > 0 && (
        <div className="stack">
          <span className="small muted">{t('af.link')}</span>
          {needs.map((n) => (
            <label key={n.id} className="row gap6 small">
              <span className="mono faint">{n.code}</span>
              <span>{noDots(clip(n.title, 60))}</span>
              <input type="checkbox" data-testid="afn-need" data-need={n.id} checked={needIds.includes(n.id)} onChange={() => toggleNeed(n.id)} />
            </label>
          ))}
        </div>
      )}
      {fileKinds.has(kind) && (
        <div className="stack">
          <span className="small muted">{t('af.firstVersion')}</span>
          <input ref={fileRef} type="file" accept={acceptFor(kind) ?? undefined} data-testid="afn-file" />
        </div>
      )}
      <div className="row gap6 af-foot">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <Btn kind="primary" testId="afn-create" disabled={!canCreate} onClick={create}>
          {t('common.create')}
        </Btn>
      </div>
    </Modal>
  );
}
