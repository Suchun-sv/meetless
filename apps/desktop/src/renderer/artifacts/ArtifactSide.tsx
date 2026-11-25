import { noDots, type Artifact, type ArtifactVersion, type Id } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { Btn, NeedChip } from '../ui/primitives';
import { useSourcePanel } from './capture-ui';
import { versionLine } from './model';
import { SourceView } from './SourcePanel';
import { usesSource } from './source-model';

/**
 * The side pane's "Source" section, as its own component so the hook (and so the `captureStatus`
 * fetch behind it) only ever mounts when this is the *one* place the live source panel shows for
 * `artifact` (fix round 1): when `artifact` reads from its capture source in the centre viewer
 * instead of a rendered document (`usesSource`, task 7), `ArtifactSide` renders nothing here at
 * all, rather than calling the hook and hiding its result — a conditionally-called hook inside the
 * one `ArtifactSide` instance (which persists across artifact selection, unkeyed by `ArtifactsPage`)
 * would violate the rules of hooks, and calling it anyway would still fetch, doubling the IPC call
 * and reintroducing a second (merely hidden) `cap-run`.
 */
function ArtifactSideSource({ artifact }: { artifact: Artifact }) {
  const { t } = useApp();
  const data = useSourcePanel(artifact);
  return (
    <>
      <h3>{t('af.source')}</h3>
      <SourceView artifact={artifact} data={data} />
    </>
  );
}

/** Pane-r: this version's changes, the artifact's linked needs, and its versions. */
export function ArtifactSide({
  projectId,
  artifact,
  selectedVersion,
  onSelectVersion,
  onAddVersion,
  onLink,
}: {
  projectId: Id;
  artifact: Artifact;
  selectedVersion: ArtifactVersion | null;
  onSelectVersion: (versionId: Id) => void;
  onAddVersion: () => void;
  onLink: () => void;
}) {
  const { live, t, fmtDay } = useApp();
  return (
    <div className="pane-r">
      <h3>{t('af.changes')}</h3>
      <div className="small">{selectedVersion ? noDots(selectedVersion.note) : t('af.noVersions')}</div>

      {/* The centre viewer already shows the live source panel for a code, Notion, or
          Overleaf-with-no-file-yet artifact; showing it again here would duplicate the capture
          button and every af-* control (review finding, fix round 1). */}
      {!usesSource(artifact, selectedVersion) && <ArtifactSideSource artifact={artifact} />}

      <div className="row gap6 wrap">
        <h3 className="grow">{t('af.needs')}</h3>
        <Btn kind="sm" testId="af-link" onClick={onLink}>
          {t('af.link')}
        </Btn>
      </div>
      {artifact.needIds.length === 0 ? (
        <div className="faint small">{t('af.needsNone')}</div>
      ) : (
        <div className="stack">
          {artifact.needIds.map((id) => (
            <NeedChip key={id} projectId={projectId} needId={id} />
          ))}
        </div>
      )}

      <div className="row gap6 wrap">
        <h3 className="grow">{t('af.versions')}</h3>
        <Btn kind="sm" testId="af-add-version" onClick={onAddVersion}>
          {t('af.addVersion')}
        </Btn>
      </div>
      {artifact.versions.length === 0 ? (
        <div className="faint small">{t('af.noVersions')}</div>
      ) : (
        <div className="stack">
          {artifact.versions.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`ver${selectedVersion?.id === v.id ? ' on' : ''}`}
              data-testid="af-version"
              data-version={v.id}
              title={versionLine(t, fmtDay, live, v)}
              onClick={() => onSelectVersion(v.id)}
            >
              <span className="mono">{noDots(v.label)}</span>
              <span className="faint small">{fmtDay(v.date)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
