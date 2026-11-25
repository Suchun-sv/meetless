import { useState } from 'react';
import { SEP, userName } from '@meetless/core';
import type { Overlay } from '../app/overlays';
import { useApp } from '../app/AppContext';
import { Modal } from '../ui/Modal';
import { confirmItems, waitingConflicts, type ConfirmItem } from './confirm';
import { ConflictItem, ExtractItem, ProposalItem, QuestionItem } from './ConfirmItems';
import './collab.css';

export interface DoneEntry {
  id: string;
  label: string;
}

/** The items answered in this session, greyed: `✓ ask.answered`, `SEP`, then what was done. */
export function DoneRows({ done }: { done: readonly DoneEntry[] }) {
  const { t } = useApp();
  return (
    <>
      {done.map((d) => (
        <div key={d.id} className="q done" data-testid="ask-done">
          <div className="small ok">{`✓ ${t('ask.answered')}${SEP}${d.label}`}</div>
        </div>
      ))}
    </>
  );
}

function Item({ item, projectId, onDone }: { item: ConfirmItem; projectId: string; onDone(label: string): void }) {
  switch (item.kind) {
    case 'conflict':
      return <ConflictItem item={item} projectId={projectId} onDone={onDone} />;
    case 'question':
      return <QuestionItem item={item} projectId={projectId} onDone={onDone} />;
    case 'extract':
      return <ExtractItem item={item} projectId={projectId} onDone={onDone} />;
    case 'proposal':
      return <ProposalItem item={item} projectId={projectId} onDone={onDone} />;
  }
}

/**
 * 「待确认」 (needs3/collab.jsx `AskPanel`): title and sub, then my items (conflicts, questions,
 * detected extracts, agent proposals; `ask.empty` when there are none), then the conflicts
 * waiting on someone else (muted, no buttons), then what I answered in this session. An item
 * answered here leaves the list at once, even while its command is only queued.
 */
export function ConfirmPanel({ overlay }: { overlay: Extract<Overlay, { kind: 'confirm' }> }) {
  const { t, live, me, today, closeOverlay } = useApp();
  const [done, setDone] = useState<DoneEntry[]>([]);
  const answered = new Set(done.map((d) => d.id));
  const items = confirmItems(live, me, overlay.projectId, today).filter((i) => !answered.has(i.id));
  const waiting = waitingConflicts(live, me, overlay.projectId);

  return (
    <Modal onClose={closeOverlay} testId="overlay-confirm" wide>
      <div className="row gap6">
        <h2 className="grow">{t('ask.title')}</h2>
        <button type="button" className="x" aria-label={t('close')} title={t('close')} onClick={closeOverlay}>
          {'×'}
        </button>
      </div>
      <p className="muted small">{t('ask.sub')}</p>
      {items.length === 0 && <div className="empty-ask">{t('ask.empty')}</div>}
      {items.map((i) => (
        <Item key={i.id} item={i} projectId={overlay.projectId} onDone={(label) => setDone((d) => [...d, { id: i.id, label }])} />
      ))}
      {waiting.map(({ conflict: c, deciderId }) => (
        <div key={c.id} className="q done" data-testid="ask-waiting" data-id={c.id}>
          <div className="small">{t('cf.q', { need: live.needs[c.needId]?.code ?? t('common.missingText') })}</div>
          <div className="small muted">{t('ask.waiting', { who: userName(live, deciderId) })}</div>
        </div>
      ))}
      <DoneRows done={done} />
    </Modal>
  );
}
