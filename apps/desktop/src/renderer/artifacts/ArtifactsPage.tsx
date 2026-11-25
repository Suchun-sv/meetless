import { useState } from 'react';
import { noDots, shareableView, type Id } from '@meetless/core';
import type { PageProps } from '../app/pages';
import { useApp } from '../app/AppContext';
import { Btn } from '../ui/primitives';
import { ArtifactList } from './ArtifactList';
import { ArtifactSide } from './ArtifactSide';
import { ArtifactViewer } from './ArtifactViewer';
import { copyAgentPrompt } from './actions';
import { agentPrompt, selectedArtifact, selectedVersion, shareState } from './model';
import { NewArtifactModal } from './NewArtifactModal';
import { NewVersionModal } from './NewVersionModal';
import { LinkNeedsModal } from './LinkNeedsModal';
import './artifacts.css';

type ModalKind = 'new' | 'version' | 'link';

/**
 * Artifacts: list, add, versions, linked needs and sharing (contract §8, task 5 brief). Selects
 * `route.focusId` (`selectedArtifact`) and, within it, `route.versionId` when it belongs to that
 * artifact, else the newest version (`selectedVersion`); `route.page` is only passed through, for
 * task 6's viewer (contract 12.21, ruling R13).
 */
export function ArtifactsPage({ composer }: PageProps) {
  const app = useApp();
  const { live, me, route, go, submit, notify, t } = app;
  const [modal, setModal] = useState<ModalKind | null>(null);
  if (route.view !== 'artifacts') return null;
  const { projectId } = route;

  const a = selectedArtifact(live, projectId, route.focusId);
  const v = a ? selectedVersion(a, route.versionId) : null;

  const openArtifact = (artifactId: Id) => go({ view: 'artifacts', projectId, focusId: artifactId });
  const openVersion = (versionId: Id) => a && go({ view: 'artifacts', projectId, focusId: a.id, versionId });

  const onShare = () => {
    if (a) void submit('artifact.shared', { artifactId: a.id });
  };
  const onCopyAgent = () => {
    if (!a) return;
    const pub = shareableView(live).artifacts[a.id];
    if (!pub) return;
    // "Copied" only once the write succeeded (M6).
    const write = typeof navigator !== 'undefined' && navigator.clipboard ? (text: string) => navigator.clipboard.writeText(text) : undefined;
    void copyAgentPrompt(write, agentPrompt(t, projectId, pub), notify, t);
  };
  const onOpen = () => {
    if (a?.url) window.open(a.url, '_blank', 'noopener');
  };

  const state = a ? shareState(live, me, a) : null;

  return (
    <div className="withc" data-testid="page-artifacts">
      <div className="withc-b three">
        <ArtifactList projectId={projectId} selectedId={a?.id ?? null} onSelect={openArtifact} onNew={() => setModal('new')} />
        <div className="pane-c">
          {a ? (
            <>
              <div className="row gap6 wrap af-h">
                <h2 className="grow">{noDots(a.title)}</h2>
                {a.privateTo !== null && <span className="small tone-muted">{t('pv.mine')}</span>}
                {a.privateTo === null && (
                  <Btn kind="sm" testId="af-copy" onClick={onCopyAgent}>
                    {t('af.copyAgent')}
                  </Btn>
                )}
                {a.url && (
                  <Btn kind="sm" testId="af-open" onClick={onOpen}>
                    {t('af.open', { w: noDots(a.where) })}
                  </Btn>
                )}
                {state === 'ok' && (
                  <Btn kind="sm" testId="af-share" onClick={onShare}>
                    {t('pv.publish')}
                  </Btn>
                )}
                {state === 'links_private' && <span className="small tone-warning">{t('af.shareBlocked')}</span>}
              </div>
              <ArtifactViewer artifact={a} version={v} page={route.page} />
            </>
          ) : (
            <div className="faint pad">{t('af.empty')}</div>
          )}
        </div>
        {a && (
          <ArtifactSide
            projectId={projectId}
            artifact={a}
            selectedVersion={v}
            onSelectVersion={openVersion}
            onAddVersion={() => setModal('version')}
            onLink={() => setModal('link')}
          />
        )}
      </div>
      {composer()}
      {modal === 'new' && (
        <NewArtifactModal projectId={projectId} onClose={() => setModal(null)} onCreated={openArtifact} />
      )}
      {modal === 'version' && a && <NewVersionModal artifact={a} onClose={() => setModal(null)} />}
      {modal === 'link' && a && <LinkNeedsModal artifact={a} onClose={() => setModal(null)} />}
    </div>
  );
}
