import { useCallback, useEffect, useReducer, useRef } from 'react';
import { noDots, type Artifact, type ArtifactVersion } from '@meetless/core';
import { useApp, type AppApi } from '../app/AppContext';
import { Btn } from '../ui/primitives';
import { downloadBlob, useBlobUrls } from './blobs';
import { useSourcePanel } from './capture-ui';
import { acceptFor, fileKinds } from './model';
import { officeStep, type OfficeEvent, type OfficeState } from './office';
import { OnlyOfficeFrame } from './OnlyOfficeFrame';
import { PagesPreview } from './PagesPreview';
import { SourceView } from './SourcePanel';
import { usesSource } from './source-model';

const CONFIG_STATE: OfficeState = { phase: 'config' };

const EXT_BY_MEDIA: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

/** The original file's download name: the title, plus the extension its media type (else its kind) implies. */
export function originalFileName(artifact: Artifact, version: ArtifactVersion): string {
  const ext = (version.mediaType ? EXT_BY_MEDIA[version.mediaType] : undefined) ?? acceptFor(artifact.kind) ?? '';
  return `${noDots(artifact.title)}${ext}`;
}

/** A file kind, or an Overleaf version with a file, opens in OnlyOffice (task 6 brief). */
function usesOffice(artifact: Artifact, version: ArtifactVersion): boolean {
  return fileKinds.has(artifact.kind) || (artifact.kind === 'overleaf' && !!version.blobHash);
}

/**
 * Drives the office state machine: calls `office.config` for `version` once (and again whenever
 * `version` changes, because the caller keys this subtree on `version.id`), and folds its result
 * (or a later editor event) through `officeStep`. `api` is read through a ref, not as an effect
 * dependency: `AppApi.api` is a fresh function on every `AppProvider` render, and depending on it
 * directly would re-fetch (and so flicker the embedded editor back to `loading`) on every
 * unrelated app re-render, not just on an artifact or version change.
 */
function useOfficeState(api: AppApi['api'], artifact: Artifact, version: ArtifactVersion): { state: OfficeState; onEvent: (e: OfficeEvent) => void } {
  const [state, dispatch] = useReducer(officeStep, CONFIG_STATE);
  const onEvent = useCallback((e: OfficeEvent) => dispatch(e), []);
  const apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    let cancelled = false;
    void apiRef.current('office.config', { projectId: artifact.projectId, artifactId: artifact.id, versionId: version.id }).then((result) => {
      if (!cancelled) dispatch({ type: 'config', result });
    });
    return () => {
      cancelled = true;
    };
  }, [artifact.projectId, artifact.id, version.id]);
  return { state, onEvent };
}

/**
 * The office-path body (task 6 brief): given an already-resolved `state`, renders the read-only
 * bar and the OnlyOffice frame (`loading`/`ready`), or the named-reason fallback (`fallback`): the
 * reason line, then `PagesPreview` for pptx/docx or `af.pdfFallback` for a pdf (or an Overleaf
 * file whose media type is a pdf), with the original-file download for any version with a file. Exported (like `signInError` next to `SignIn`) so
 * tests can render each state directly, without needing the real async `office.config` round trip.
 */
export function OfficeView({
  state,
  artifact,
  version,
  page,
  onEvent,
}: {
  state: OfficeState;
  artifact: Artifact;
  version: ArtifactVersion;
  page?: number;
  onEvent: (e: OfficeEvent) => void;
}) {
  const { t, tr, locale, bridge, notify, errorText } = useApp();
  const isPdf = artifact.kind === 'pdf' || version.mediaType === 'application/pdf';
  const hasFile = !!version.blobHash;
  const derived = state.phase === 'fallback' && !isPdf && hasFile ? version.derived : null;
  const urls = useBlobUrls(derived?.pageHashes ?? []);

  if (state.phase === 'config') {
    return (
      <div className="faint small pad" data-testid="af-office-loading">
        {t('af.loadingViewer')}
      </div>
    );
  }

  if (state.phase === 'fallback') {
    const reason = tr.tDynamic(`af.reason.${state.reason}`);
    // I8: the reason on its own line; the LibreOffice sentence only above pages actually shown; the
    // original file whenever there is one, for every kind (also while the preview is pending or
    // failed, which is the common case with no office worker). A version with no file has nothing
    // to preview or download, so the reason is all it shows.
    const pagesShown = !!derived && derived.status !== 'failed' && derived.pageHashes.length > 0;
    const original = hasFile && (
      <Btn
        kind="sm"
        testId="af-original"
        onClick={() =>
          void downloadBlob(bridge, version.blobHash!, originalFileName(artifact, version), version.mediaType ?? 'application/octet-stream').then((r) => {
            if (!r.ok) notify('error', errorText(r.code));
          })
        }
      >
        {t('af.original')}
      </Btn>
    );
    return (
      <div data-testid="af-fallback" data-reason={state.reason}>
        <p className="small tone-warning">{t('af.fallbackReason', { reason })}</p>
        {isPdf ? (
          hasFile && (
            <div className="row gap6 wrap">
              <span className="small">{t('af.pdfFallback')}</span>
              {original}
            </div>
          )
        ) : (
          <>
            {hasFile && (
              <div className="row gap6 wrap">
                {pagesShown && <span className="small">{t('af.fallbackPages')}</span>}
                <span className="grow" />
                {original}
              </div>
            )}
            {hasFile && <PagesPreview kind={artifact.kind} derived={derived} urls={urls} page={page} />}
          </>
        )}
      </div>
    );
  }

  // 'loading' or 'ready'.
  return (
    <div className="oo">
      <div className="oo-bar row gap6">
        <span className="oo-name">{t('af.viewer')}</span>
        <span className="faint small">{t('af.readonly')}</span>
        <span className="grow" />
        {state.phase === 'ready' && page != null && (
          <span className="faint small" data-testid="af-page-hint">
            {t('af.pageHint', { n: page + 1 })}
          </span>
        )}
      </div>
      <OnlyOfficeFrame state={state} locale={locale} onEvent={onEvent} />
    </div>
  );
}

/** Wires the real `office.config` call for `artifact`/`version` and renders `OfficeView` over its result. */
function OfficeArtifactViewer({ artifact, version, page }: { artifact: Artifact; version: ArtifactVersion; page?: number }) {
  const { api } = useApp();
  const { state, onEvent } = useOfficeState(api, artifact, version);
  return (
    <div data-testid="af-viewer" data-kind={artifact.kind} data-page={page} data-office-phase={state.phase}>
      <OfficeView state={state} artifact={artifact} version={version} page={page} onEvent={onEvent} />
    </div>
  );
}

/**
 * A code artifact (its commits are the content), a Notion page, or an Overleaf project with no
 * file yet have no document to preview: the viewer is their capture source (task 7 brief). This
 * is the *only* place that source panel renders for these three kinds (fix round 1): `ArtifactSide`
 * checks the same `usesSource` and skips its own copy, so there is exactly one `cap-run` and one
 * `captureStatus` fetch per selected artifact, never two independently-guarded capture buttons.
 */
function SourceArtifactViewer({ artifact }: { artifact: Artifact }) {
  const data = useSourcePanel(artifact);
  return (
    <div data-testid="af-viewer" data-kind={artifact.kind}>
      <SourceView artifact={artifact} data={data} />
    </div>
  );
}

/**
 * The artifact viewer (task 6 brief; design §8.5). A file kind, or an Overleaf version with a
 * file, opens read-only in OnlyOffice, with the LibreOffice page-image fallback when it is
 * unavailable. Code, Notion, and an Overleaf artifact with no file yet have no document to show,
 * so they read instead from their capture source (task 7 brief: `SourceView` / `NotionView`), in
 * every version state, not only when there is no version at all.
 */
export function ArtifactViewer({ artifact, version, page }: { artifact: Artifact; version: ArtifactVersion | null; page?: number }) {
  const { t } = useApp();
  if (usesSource(artifact, version)) {
    return <SourceArtifactViewer artifact={artifact} />;
  }
  if (!version) {
    return (
      <div data-testid="af-viewer" data-kind={artifact.kind}>
        <div className="faint small pad">{t('af.noVersions')}</div>
      </div>
    );
  }
  if (usesOffice(artifact, version)) {
    return <OfficeArtifactViewer key={version.id} artifact={artifact} version={version} page={page} />;
  }
  return (
    <div data-testid="af-viewer" data-kind={artifact.kind} data-page={page}>
      <div className="mono">{noDots(version.label)}</div>
      <div className="small">{noDots(version.note)}</div>
    </div>
  );
}
