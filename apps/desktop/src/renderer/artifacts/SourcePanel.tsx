import { useEffect, useMemo, useState } from 'react';
import type { CommitInfo } from '@meetless/client/bridge';
import { noDots, type Artifact, type Id } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { useApp, type AppApi } from '../app/AppContext';
import { DesktopOnly, isWeb } from '../ui/DesktopOnly';
import { Btn } from '../ui/primitives';
import { capErrorText, CaptureButton, createNotionReader, type NotionRead, type SourcePanelData } from './capture-ui';

/*
 * The source panel (task 7 brief; ported from needs/artifacts.jsx's code and Notion viewers,
 * now real reads instead of mocks). `SourceView` is presentational: it takes the row plus
 * handlers from `useSourcePanel` and renders them; it never calls the bridge itself. `NotionView`
 * is the one exception (brief): reading a Notion page is a live, never-stored call, triggered by
 * its own button, so it is self-contained.
 */

function CommitLog({ commits, t }: { commits: CommitInfo[]; t: AppApi['t'] }) {
  if (commits.length === 0) return null;
  return (
    <div className="stack">
      <span className="small muted">{t('af.commits')}</span>
      {commits.map((c) => (
        <div key={c.commit} className="small" data-testid="af-commit" data-sha={c.commit}>
          <span className="mono faint">{c.commit.slice(0, 7)}</span> {noDots(c.subject)}
        </div>
      ))}
    </div>
  );
}

/**
 * A Notion page read, presentational (I5): the read button (disabled with `af.notionReading` while
 * a read is in flight), then the paragraphs through `noDots`, or the reason the read failed.
 * Nothing shows before the first read, nor when the page has no paragraphs.
 */
export function NotionPage({ read, onRead }: { read: NotionRead; onRead: () => void }) {
  const { t, errorText } = useApp();
  const reading = read.phase === 'reading';
  return (
    <div className="stack">
      <Btn kind="sm" testId="af-notion-read" disabled={reading} onClick={onRead}>
        {reading ? t('af.notionReading') : t('af.notionRead')}
      </Btn>
      {read.phase === 'error' && (
        <p className="small tone-warning" data-testid="af-notion-error">
          {capErrorText(t, errorText, read.code)}
        </p>
      )}
      {read.phase === 'ready' && read.paragraphs.length > 0 && (
        <div className="notion-p" data-testid="af-notion-page">
          {read.paragraphs.map((p, i) => (
            <p key={i} className="small">
              {noDots(p)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Reads a Notion artifact's page live (never stored); a failed read refreshes the panel through `onFailed`. */
export function NotionView({ artifactId, onFailed }: { artifactId: Id; onFailed: () => void }) {
  const { bridge } = useApp();
  const [read, setRead] = useState<NotionRead>({ phase: 'idle' });
  const reader = useMemo(() => createNotionReader(bridge, artifactId, setRead, onFailed), [bridge, artifactId, onFailed]);
  useEffect(() => () => reader.destroy(), [reader]);
  return <NotionPage read={read} onRead={() => void reader.read()} />;
}

/**
 * One artifact's capture source (brief): a repo to bind and its commits, an Overleaf token and
 * sync, a Notion authorisation and live read, or (for an uploaded-version kind) a one-line note —
 * then, for every kind, the skip reason, the last run time, the capture tip and the capture
 * button. Presentational: `data` (from `useSourcePanel`) carries everything it needs.
 */
export function SourceView({ artifact, data }: { artifact: Artifact; data: SourcePanelData }) {
  const app = useApp();
  const { t, fmtDateTime } = app;
  const [token, setToken] = useState('');
  const { row } = data;

  // On the web, capture needs the local machine (design 2026-11-25 §6): a notice instead of its controls.
  if (isWeb(app)) {
    return (
      <div className="src" data-testid="af-source" data-kind={row.kind} data-ready="false">
        {row.kind === 'upload' ? <div className="small">{t('af.uploadSource')}</div> : <DesktopOnly />}
      </div>
    );
  }

  return (
    <div className="src" data-testid="af-source" data-kind={row.kind} data-ready={String(row.ready)}>
      {row.kind === 'repo' && (
        <div className="stack">
          <span className="small muted">{t('af.repo')}</span>
          <div className="row gap6 wrap">
            <span className="small">{row.repoName ? noDots(row.repoName) : t('af.noRepo')}</span>
            <span className="grow" />
            {row.repoName ? (
              <Btn kind="sm" testId="af-unbind" onClick={data.onUnbindRepo}>
                {t('af.unbind')}
              </Btn>
            ) : (
              <Btn kind="sm" testId="af-pick-repo" onClick={data.onPickRepo}>
                {t('af.pickRepo')}
              </Btn>
            )}
          </div>
          <CommitLog commits={data.commits} t={t} />
        </div>
      )}

      {row.kind === 'overleaf' && (
        <div className="stack">
          <span className="small muted">{t('af.olToken')}</span>
          <div className="small mono">{artifact.url ? noDots(artifact.url) : t('af.noRepo')}</div>
          {data.overleafToken ? (
            <div className="row gap6 wrap">
              <span className="small">{t('af.olTokenSaved')}</span>
              <span className="grow" />
              <Btn kind="sm" testId="af-ol-clear" onClick={data.onClearToken}>
                {t('af.olTokenClear')}
              </Btn>
            </div>
          ) : (
            <div className="row gap6 wrap">
              <input
                data-testid="af-ol-token"
                className="inp"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder={t('af.olTokenPh')}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <Btn
                kind="sm"
                testId="af-ol-save"
                onClick={() => {
                  data.onSaveToken(token);
                  setToken('');
                }}
              >
                {t('common.save')}
              </Btn>
            </div>
          )}
          <div className="row gap6 wrap">
            <Btn kind="sm" testId="af-ol-sync" disabled={data.syncing} onClick={data.onSync}>
              {data.syncing ? t('af.olSyncing') : t('af.olSync')}
            </Btn>
            {row.syncedAt && <span className="small faint">{t('af.olSynced', { t: fmtDateTime(row.syncedAt) })}</span>}
          </div>
          <CommitLog commits={data.commits} t={t} />
        </div>
      )}

      {row.kind === 'notion' && (
        <div className="stack">
          {data.notionConnected ? (
            <div className="row gap6 wrap">
              <span className="small">{t('af.notionConnected')}</span>
              <span className="grow" />
              <Btn kind="sm" testId="af-notion-disconnect" onClick={data.onDisconnectNotion}>
                {t('af.notionDisconnect')}
              </Btn>
            </div>
          ) : (
            <div className="stack">
              <p className="small tone-warning">{t('af.notionNeedAuth')}</p>
              <Btn kind="sm" testId="af-notion-connect" onClick={data.onConnectNotion}>
                {t('af.notionConnect')}
              </Btn>
              {data.notionWaiting && <span className="small faint">{t('af.notionWaiting')}</span>}
            </div>
          )}
          {data.notionConnected && <NotionView artifactId={artifact.id} onFailed={data.refresh} />}
        </div>
      )}

      {row.kind === 'upload' && <div className="small">{t('af.uploadSource')}</div>}

      {row.code && <p className="small tone-warning">{t(`cap.err.${row.code}` as MessageKey)}</p>}
      {row.lastRunAt && <p className="small faint">{t('cap.lastRun', { t: fmtDateTime(row.lastRunAt) })}</p>}
      <p className="small faint">{t('cap.tip')}</p>
      <CaptureButton projectId={artifact.projectId} artifactIds={[artifact.id]} testId="cap-run" />
    </div>
  );
}
