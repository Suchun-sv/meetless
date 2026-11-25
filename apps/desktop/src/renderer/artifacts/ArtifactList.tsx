import { noDots, SEP, type Id } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { Btn, FileKind } from '../ui/primitives';
import { artifactList } from './model';

/** Pane-l: the project's artifacts, newest first, plus the "add artifact" action. */
export function ArtifactList({
  projectId,
  selectedId,
  onSelect,
  onNew,
}: {
  projectId: Id;
  selectedId: Id | null;
  onSelect: (artifactId: Id) => void;
  onNew: () => void;
}) {
  const { live, t, fmtDay } = useApp();
  const list = artifactList(live, projectId);
  return (
    <div className="pane-l">
      <div className="row gap6 wrap">
        <Btn kind="primary" testId="af-new" onClick={onNew}>
          {t('af.new')}
        </Btn>
      </div>
      {list.length === 0 ? (
        <div className="faint small pad">{t('af.empty')}</div>
      ) : (
        list.map((a) => {
          const v0 = a.versions[0];
          const fact = [noDots(a.where), v0 ? fmtDay(v0.date) : null].filter((x): x is string => !!x).join(SEP);
          return (
            <button
              key={a.id}
              type="button"
              className={`li${a.id === selectedId ? ' on' : ''}`}
              data-testid="af-item"
              data-artifact={a.id}
              onClick={() => onSelect(a.id)}
            >
              <div className="row gap6">
                <FileKind kind={a.kind} />
                <span className="li-t">{noDots(a.title)}</span>
              </div>
              <div className="small faint">{fact}</div>
            </button>
          );
        })
      )}
    </div>
  );
}
