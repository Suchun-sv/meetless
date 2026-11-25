import type { Result, SubmitResult } from '@meetless/client/bridge';
import type { ArtifactKind, EventPayloads, EventType, Id, IsoDate } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { fileKinds, uploadVersionFile } from './model';

/**
 * The artifact modals' submit flows and the copy-for-agent action, as plain async functions over
 * injected app calls, so the refusal paths are unit-tested without a DOM (final review I6, M5, M6).
 * `submit` is the app's own: it already shows the refusal notice (`errorText(code)`), so these
 * only decide whether to go on and whether the modal may close.
 */
export interface ActionDeps {
  submit<K extends EventType>(type: K, payload: EventPayloads[K]): Promise<SubmitResult>;
  uploadBlob(bytes: Uint8Array, mediaType: string): Promise<Result<{ hash: string; size: number }>>;
  notify(tone: 'error' | 'info', text: string): void;
  errorText(code: string): string;
}

type FileLike = { arrayBuffer(): Promise<ArrayBuffer> };

export interface NewArtifactInput {
  artifactId: Id;
  versionId: Id;
  projectId: Id;
  kind: ArtifactKind;
  title: string;
  where: string;
  url: string | null;
  needIds: Id[];
  isPrivate: boolean;
  file: FileLike | null;
  today: IsoDate;
  roundId: Id | null;
}

/**
 * Creates the artifact, then (for a file kind with a file) uploads it and adds it as `v1`.
 * Resolves `false` when `artifact.created` is refused: nothing is uploaded and no version is
 * submitted, so the modal stays open with what was typed. A failed upload still leaves the
 * artifact created (without a first version) and says why.
 */
export async function createArtifact(deps: ActionDeps, input: NewArtifactInput): Promise<boolean> {
  const created = await deps.submit('artifact.created', {
    artifactId: input.artifactId,
    projectId: input.projectId,
    kind: input.kind,
    title: input.title,
    where: input.where,
    url: input.url,
    needIds: input.needIds,
    private: input.isPrivate,
  });
  if (created.kind === 'rejected') return false;
  if (input.file && fileKinds.has(input.kind)) {
    const up = await uploadVersionFile(deps.uploadBlob, input.kind, input.file);
    if (!up.ok) {
      deps.notify('error', deps.errorText(up.code));
      return true;
    }
    await deps.submit('artifact.version_added', {
      artifactId: input.artifactId,
      versionId: input.versionId,
      label: 'v1',
      date: input.today,
      roundId: input.roundId,
      note: '',
      blobHash: up.blobHash,
      mediaType: up.mediaType,
      url: null,
    });
  }
  return true;
}

export interface NewVersionInput {
  artifactId: Id;
  versionId: Id;
  kind: ArtifactKind;
  label: string;
  note: string;
  url: string | null;
  file: FileLike | null;
  today: IsoDate;
  roundId: Id | null;
}

/**
 * Uploads the file (file kinds) and submits `artifact.version_added`. Resolves `false` when the
 * upload fails (with its notice) or the version is refused (M5), so the modal stays open.
 */
export async function addVersion(deps: ActionDeps, input: NewVersionInput): Promise<boolean> {
  let blobHash: string | null = null;
  let mediaType: string | null = null;
  if (fileKinds.has(input.kind) && input.file) {
    const up = await uploadVersionFile(deps.uploadBlob, input.kind, input.file);
    if (!up.ok) {
      deps.notify('error', deps.errorText(up.code));
      return false;
    }
    blobHash = up.blobHash;
    mediaType = up.mediaType;
  }
  const r = await deps.submit('artifact.version_added', {
    artifactId: input.artifactId,
    versionId: input.versionId,
    label: input.label,
    date: input.today,
    roundId: input.roundId,
    note: input.note,
    blobHash,
    mediaType,
    url: fileKinds.has(input.kind) ? null : input.url,
  });
  return r.kind !== 'rejected';
}

/**
 * Writes `text` to the clipboard and says "copied" only once the write succeeded (M6); a missing
 * clipboard or a refused write says it could not copy.
 */
export async function copyAgentPrompt(
  writeText: ((text: string) => Promise<void>) | undefined,
  text: string,
  notify: (tone: 'error' | 'info', text: string) => void,
  t: (key: MessageKey) => string,
): Promise<boolean> {
  try {
    if (!writeText) throw new Error('no clipboard');
    await writeText(text);
  } catch {
    notify('error', t('af.copyFailed'));
    return false;
  }
  notify('info', t('cp.copied'));
  return true;
}
