import { useState } from 'react';
import { noDots, type Id } from '@meetless/core';
import type { PageProps } from '../app/pages';
import { useApp } from '../app/AppContext';
import { ExtractPanel } from './ExtractPanel';
import { importFile } from './importer';
import { InputList } from './InputList';
import { InputSheet } from './InputSheet';
import { MarkdownModal } from './MarkdownModal';
import { blockedFor, selectedInput, sharePrivateNeedIds, type BlockedShare } from './model';
import './inputs.css';

/**
 * Inputs: import files, write Markdown, and accept or ignore the rule-detected items (task 8
 * brief; contract §8). Selects `route.focusId` (`selectedInput`) and scrolls to `route.paraId`
 * inside the sheet (contract 12.21, ruling R13).
 *
 * The share-first state (fix round 1 Important 1, fix round 2 Important 1) is recorded as
 * `BlockedShare | null` — a refusal tagged with the input it belongs to — not as a plain
 * `Id[] | null` reset by an effect. A `useEffect` runs *after* commit, but the Shell renders
 * `InputsPage` without a key, so one render already shows a newly selected input with the
 * previous input's raw blocked state before any effect could clear it. `blockedFor(blocked,
 * input?.id)` derives the value shown *during* that same render, so there is no render — and so
 * no click on `in-share-needs-first` — where a mismatch could ever show.
 */
export function InputsPage({ composer }: PageProps) {
  const app = useApp();
  const { live, route, go, t, notify, errorText, submit } = app;
  const [mdOpen, setMdOpen] = useState(false);
  const [hotId, setHotId] = useState<Id | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<BlockedShare | null>(null);

  const input = route.view === 'inputs' ? selectedInput(live, route.projectId, route.focusId) : null;
  const blockedNeedIds = blockedFor(blocked, input?.id);

  if (route.view !== 'inputs') return null;
  const { projectId } = route;

  const onSelect = (inputId: Id) => go({ view: 'inputs', projectId, focusId: inputId });

  const importErrorText = (code: string) => (code === 'BAD_TYPE' ? t('in.badType') : code === 'EMPTY_FILE' ? t('in.emptyFile') : errorText(code));

  const onImportFile = (file: File, isPrivate: boolean) => {
    setImporting(file.name);
    notify('info', t('in.importing', { name: noDots(file.name) }));
    void (async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const r = await importFile(app, { projectId, name: file.name, bytes, from: null, private: isPrivate });
      setImporting(null);
      if (!r.ok) notify('error', importErrorText(r.code));
    })();
  };

  const onShare = async () => {
    if (!input) return;
    const inputId = input.id;
    const r = await submit('input.shared', { inputId });
    const needIds = sharePrivateNeedIds(r);
    setBlocked(needIds ? { inputId, needIds } : null);
  };

  // Fix round 1, Minor 6: stop at the first rejected need.shared — submit() already shows that
  // rejection's own notice, so continuing would chain unrelated error notices. Fix round 2: only
  // ever acts on the ids recorded for the *current* input; a mismatch (the race the review found)
  // is a no-op, not just unreachable through the UI.
  const onShareNeedsFirst = async () => {
    if (!input || !blocked || blocked.inputId !== input.id) return;
    const inputId = input.id;
    for (const needId of blocked.needIds) {
      const r = await submit('need.shared', { needId });
      if (r.kind === 'rejected') return;
    }
    const r = await submit('input.shared', { inputId });
    const needIds = sharePrivateNeedIds(r);
    setBlocked(needIds ? { inputId, needIds } : null);
  };

  return (
    <div className="withc" data-testid="page-inputs">
      <div className="withc-b three">
        <InputList projectId={projectId} selectedId={input?.id ?? null} onSelect={onSelect} onImportFile={onImportFile} onWrite={() => setMdOpen(true)} />
        {input ? (
          <InputSheet
            input={input}
            paraId={route.paraId}
            hotExtractId={hotId}
            onHoverExtract={setHotId}
            blockedNeedIds={blockedNeedIds}
            onShare={onShare}
            onShareNeedsFirst={onShareNeedsFirst}
          />
        ) : (
          <div className="pane-c">
            <div className="faint pad">{t('in.empty')}</div>
          </div>
        )}
        <ExtractPanel input={input} parsing={importing !== null} onHover={setHotId} blockingNeedIds={blockedNeedIds ?? []} />
      </div>
      {composer()}
      {mdOpen && <MarkdownModal projectId={projectId} onClose={() => setMdOpen(false)} />}
    </div>
  );
}
