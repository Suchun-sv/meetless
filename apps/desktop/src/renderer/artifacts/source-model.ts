import type { Artifact, ArtifactKind, ArtifactVersion, IsoTime } from '@meetless/core';
import type { CaptureCode, CaptureSourceKind, CaptureStatus } from '@meetless/client/bridge';

/**
 * Capture source model (task 7 brief). Pure helpers over the bridge's `CaptureStatus`; no React.
 * `SOURCE_KIND` mirrors the capture service's own split (design §8.8): `code` reads a local repo,
 * `overleaf` reads the Overleaf git clone once synced, `notion` reads the Notion page live,
 * everything else reads the artifact's own uploaded versions.
 */
const SOURCE_KIND: Record<ArtifactKind, CaptureSourceKind> = {
  code: 'repo',
  overleaf: 'overleaf',
  notion: 'notion',
  pptx: 'upload',
  docx: 'upload',
  pdf: 'upload',
};

export interface SourceRow {
  kind: CaptureSourceKind;
  ready: boolean;
  code: CaptureCode | null;
  repoName: string | null;
  syncedAt: IsoTime | null;
  lastRunAt: IsoTime | null;
}

/**
 * Maps an artifact to its capture source row: the kind by the artifact's own kind (always known),
 * and readiness by `st.sources` (unknown, so not ready and no reason, until `captureStatus` answers).
 */
export function sourceRow(a: Artifact, st: CaptureStatus | null): SourceRow {
  const src = st?.sources.find((s) => s.artifactId === a.id) ?? null;
  return {
    kind: SOURCE_KIND[a.kind],
    ready: src?.ready ?? false,
    code: src?.code ?? null,
    repoName: src?.repo?.name ?? null,
    syncedAt: src?.syncedAt ?? null,
    lastRunAt: src?.lastRunAt ?? null,
  };
}

/**
 * Whether `artifact` (with its current `version`, which may be null) has no document to preview,
 * so it is read from its capture source instead of a rendered version (task 7 fix round 1: the
 * single source of truth for where the live source panel lives, shared by `ArtifactViewer`, which
 * shows it, and `ArtifactSide`, which must not show a second copy of it there).
 */
export function usesSource(artifact: Artifact, version: ArtifactVersion | null): boolean {
  if (artifact.kind === 'code' || artifact.kind === 'notion') return true;
  return artifact.kind === 'overleaf' && !version?.blobHash;
}
