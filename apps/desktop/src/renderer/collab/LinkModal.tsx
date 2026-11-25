import type { Overlay } from '../app/overlays';
import { useApp } from '../app/AppContext';
import { Modal } from '../ui/Modal';
import { PromptBox } from './PromptBox';
import './collab.css';

/**
 * The link-for-agent modal (needs3/collab.jsx `LinkModal`): title, close, and the prompt box
 * for this need. A need not in `live` at all (unknown id, or a projectId mismatch) renders
 * `dr.missing` and the close only, like `NeedDrawer`'s placeholder — `PromptBox` is never
 * asked to render a need it cannot find. A need that is in `live` but has no shareable
 * context (private, or invisible to this viewer) still renders `PromptBox`, which itself
 * falls back to `lk.privateFirst`.
 */
export function LinkModal({ overlay }: { overlay: Extract<Overlay, { kind: 'link' }> }) {
  const { t, live, closeOverlay } = useApp();
  const n = live.needs[overlay.needId];
  const found = n && n.projectId === overlay.projectId;
  return (
    <Modal onClose={closeOverlay} wide testId="overlay-link">
      <div className="row gap6">
        <h2 className="grow">{t('lk.btn')}</h2>
        <button type="button" className="x" aria-label={t('close')} title={t('close')} onClick={closeOverlay}>
          {'×'}
        </button>
      </div>
      {found ? <PromptBox projectId={overlay.projectId} needId={overlay.needId} /> : <p className="faint small">{t('dr.missing')}</p>}
    </Modal>
  );
}
