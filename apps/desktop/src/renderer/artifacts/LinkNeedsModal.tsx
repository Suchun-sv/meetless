import { useState } from 'react';
import { clip, noDots, type Artifact, type Id } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { Modal } from '../ui/Modal';
import { Btn } from '../ui/primitives';
import { linkableNeeds } from './model';

/** Link or unlink needs. A shared artifact cannot link a still-private need (core's `linkNeeds`). */
export function LinkNeedsModal({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const { live, t, submit } = useApp();
  const needs = linkableNeeds(live, artifact.projectId, artifact.privateTo !== null);
  const [selected, setSelected] = useState<Id[]>(artifact.needIds);
  const toggle = (id: Id) => setSelected((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const save = async () => {
    await submit('artifact.linked', { artifactId: artifact.id, needIds: selected });
    onClose();
  };

  return (
    <Modal onClose={onClose} testId="afl-modal">
      <div className="row">
        <h2 className="grow">{t('af.link')}</h2>
        <button type="button" className="x" onClick={onClose} aria-label={t('close')}>
          ×
        </button>
      </div>
      {needs.length === 0 ? (
        <div className="faint small">{t('af.needsNone')}</div>
      ) : (
        <div className="stack">
          <span className="small muted">{t('af.linkPick')}</span>
          {needs.map((n) => (
            <label key={n.id} className="row gap6 small" data-testid="afl-need" data-need={n.id}>
              <span className="mono faint">{n.code}</span>
              <span>{noDots(clip(n.title, 60))}</span>
              <input type="checkbox" checked={selected.includes(n.id)} onChange={() => toggle(n.id)} />
            </label>
          ))}
        </div>
      )}
      <div className="row gap6 af-foot">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <Btn kind="primary" testId="afl-save" onClick={save}>
          {t('common.save')}
        </Btn>
      </div>
    </Modal>
  );
}
