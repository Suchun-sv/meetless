import { useRef, useState, type ChangeEvent } from 'react';
import { inputStatus, noDots, pendingExtracts, SEP, type Id, type Input } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { Btn, FileKind } from '../ui/primitives';
import { inputGroups, requesterLabel } from './model';

/** Pane-l: import a file, write Markdown, the project / only-me toggle for the next file import, and the groups. */
export function InputList({
  projectId,
  selectedId,
  onSelect,
  onImportFile,
  onWrite,
}: {
  projectId: Id;
  selectedId: Id | null;
  onSelect: (inputId: Id) => void;
  onImportFile: (file: File, isPrivate: boolean) => void;
  onWrite: () => void;
}) {
  const { live, me, t, fmtDay } = useApp();
  const [isPrivate, setIsPrivate] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { pending, done } = inputGroups(live, projectId);

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onImportFile(file, isPrivate);
  };

  const row = (i: Input) => {
    const open = pendingExtracts(i);
    const fact = [requesterLabel(live, i.from), fmtDay(i.date)].filter((x): x is string => !!x).join(SEP);
    return (
      <button
        key={i.id}
        type="button"
        className={`li${i.id === selectedId ? ' on' : ''}`}
        data-testid="in-item"
        data-input={i.id}
        data-status={inputStatus(i)}
        onClick={() => onSelect(i.id)}
      >
        <div className="row gap6">
          <FileKind kind={i.kind} />
          <span className="li-t">{noDots(i.title)}</span>
        </div>
        <div className="small faint row gap6">
          <span>{fact}</span>
          {open > 0 && <span className="nav-n">{open}</span>}
          {i.privateTo === me && <span className="tone-muted">{t('pv.mine')}</span>}
        </div>
      </button>
    );
  };

  return (
    <div className="pane-l">
      <div className="row gap6 wrap">
        <Btn kind="primary" testId="in-import" onClick={() => fileRef.current?.click()}>
          {t('in.import')}
        </Btn>
        <Btn testId="in-write" onClick={onWrite}>
          {t('in.write')}
        </Btn>
        <input ref={fileRef} type="file" data-testid="in-file" accept=".pdf,.docx,.txt,.md,.markdown" className="in-hidden-file" onChange={onFileChange} />
      </div>
      <div className="faint small">{t('in.types')}</div>
      <div className="stack">
        <span className="small muted">{t('in.privacy')}</span>
        <div className="seg" role="group" aria-label={t('in.privacy')}>
          <button type="button" data-testid="in-priv-project" className={!isPrivate ? 'on' : undefined} onClick={() => setIsPrivate(false)}>
            {t('pv.project')}
          </button>
          <button type="button" data-testid="in-priv-only" className={isPrivate ? 'on' : undefined} onClick={() => setIsPrivate(true)}>
            {t('pv.only')}
          </button>
        </div>
      </div>
      {pending.length === 0 && done.length === 0 ? (
        <div className="faint small pad">{t('in.empty')}</div>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="stack">
              <div className="side-label">{t('in.pending', { n: pending.length })}</div>
              {pending.map(row)}
            </div>
          )}
          {done.length > 0 && (
            <div className="stack">
              <div className="side-label">{t('in.done', { n: done.length })}</div>
              {done.map(row)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
