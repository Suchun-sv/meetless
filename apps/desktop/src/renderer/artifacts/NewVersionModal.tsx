import { useRef, useState } from 'react';
import { currentRound, type Artifact } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { newId } from '../model/ids';
import { Modal } from '../ui/Modal';
import { Btn } from '../ui/primitives';
import { addVersion } from './actions';
import { acceptFor, checkUrl, fileKinds } from './model';

/** Add a version: a label, what changed, and either an uploaded file or a URL, by the artifact's kind. */
export function NewVersionModal({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const { live, today, t, submit, bridge, notify, errorText } = useApp();
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [url, setUrl] = useState('');
  const [hasFile, setHasFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isFileKind = fileKinds.has(artifact.kind);

  const canSave = label.trim().length > 0 && !busy && (isFileKind ? hasFile : checkUrl(artifact.kind, url) === 'ok');

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    const ok = await addVersion(
      { submit, uploadBlob: bridge.uploadBlob, notify, errorText },
      {
        artifactId: artifact.id,
        versionId: newId('v'),
        kind: artifact.kind,
        label: label.trim(),
        note: note.trim(),
        url: isFileKind ? null : url.trim() || null,
        file: isFileKind ? (fileRef.current?.files?.[0] ?? null) : null,
        today,
        roundId: currentRound(live, artifact.projectId)?.id ?? null,
      },
    );
    setBusy(false);
    // A failed upload or a refused version (its notice is already shown) keeps the modal open (M5).
    if (ok) onClose();
  };

  return (
    <Modal onClose={onClose} testId="afv-modal">
      <div className="row">
        <h2 className="grow">{t('af.addVersion')}</h2>
        <button type="button" className="x" onClick={onClose} aria-label={t('close')}>
          ×
        </button>
      </div>
      <label className="stack">
        <span className="small muted">{t('af.label')}</span>
        <input className="inp" data-testid="afv-label" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="stack">
        <span className="small muted">{t('af.note')}</span>
        <textarea className="inp ta" data-testid="afv-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {isFileKind ? (
        <label className="stack">
          <span className="small muted">{t('af.file')}</span>
          <input
            ref={fileRef}
            type="file"
            accept={acceptFor(artifact.kind) ?? undefined}
            data-testid="afv-file"
            onChange={(e) => setHasFile(!!e.target.files?.length)}
          />
        </label>
      ) : (
        <label className="stack">
          <span className="small muted">{t('af.url')}</span>
          <input className="inp" data-testid="afv-url" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
      )}
      <div className="row gap6 af-foot">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <Btn kind="primary" testId="afv-save" disabled={!canSave} onClick={save}>
          {t('common.save')}
        </Btn>
      </div>
    </Modal>
  );
}
