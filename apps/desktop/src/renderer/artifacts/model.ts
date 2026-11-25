import { NOTION_PAGE_URL, OVERLEAF_GIT_URL, type Result } from '@meetless/client/bridge';
import { isOpen, noDots, projectNeeds, SEP, type Artifact, type ArtifactKind, type ArtifactVersion, type Id, type Need, type State } from '@meetless/core';
import type { MessageKey, Params } from '@meetless/i18n';

/**
 * Artifacts page model (contract §8, task 5 brief). Pure helpers over `State`; no React. `shareState`
 * mirrors core's `artifact.shared` and `linkNeeds` refusal rules (`packages/core/src/reducer.ts`), so
 * the UI never offers a share the server would refuse.
 */

function rank(a: Artifact): number {
  return Math.max(a.seq, a.versions[0]?.seq ?? 0);
}

/** This project's artifacts, newest first by `max(a.seq, versions[0]?.seq)` (a new version bumps it). */
export function artifactList(s: State, projectId: Id): Artifact[] {
  return Object.values(s.artifacts)
    .filter((a) => a.projectId === projectId)
    .sort((a, b) => rank(b) - rank(a));
}

/** The focused artifact, else the first of `artifactList`. */
export function selectedArtifact(s: State, projectId: Id, focusId: Id | null | undefined): Artifact | null {
  const list = artifactList(s, projectId);
  if (focusId) {
    const found = list.find((a) => a.id === focusId);
    if (found) return found;
  }
  return list[0] ?? null;
}

/** The version `versionId` names, when it belongs to `a`; else the newest (`versions[0]`, newest first). */
export function selectedVersion(a: Artifact, versionId: Id | null | undefined): ArtifactVersion | null {
  if (versionId) {
    const found = a.versions.find((v) => v.id === versionId);
    if (found) return found;
  }
  return a.versions[0] ?? null;
}

export const DEFAULT_WHERE: Record<ArtifactKind, string> = {
  overleaf: 'Overleaf',
  code: 'GitHub',
  notion: 'Notion',
  pptx: 'PowerPoint',
  docx: 'Word',
  pdf: 'PDF',
};

const HTTP_URL = /^https?:\/\//;

/**
 * Overleaf must match the client's git-clone URL (or be an absolute path: the client host decides
 * that case); Notion must match its page-link pattern; other kinds accept empty or any http(s) URL.
 */
export function checkUrl(kind: ArtifactKind, url: string): 'ok' | 'bad_url' {
  const u = url.trim();
  if (kind === 'overleaf') return OVERLEAF_GIT_URL.test(u) || u.startsWith('/') ? 'ok' : 'bad_url';
  if (kind === 'notion') return NOTION_PAGE_URL.test(u) ? 'ok' : 'bad_url';
  return u === '' || HTTP_URL.test(u) ? 'ok' : 'bad_url';
}

/** The kinds that version through an uploaded file, rather than a URL. */
export const fileKinds: ReadonlySet<ArtifactKind> = new Set<ArtifactKind>(['pptx', 'docx', 'pdf']);

type FileKind = 'pptx' | 'docx' | 'pdf';

const MEDIA_TYPE: Record<FileKind, string> = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

const ACCEPT: Record<FileKind, string> = { pptx: '.pptx', docx: '.docx', pdf: '.pdf' };

export function mediaTypeFor(kind: ArtifactKind): string | null {
  return fileKinds.has(kind) ? MEDIA_TYPE[kind as FileKind] : null;
}

export function acceptFor(kind: ArtifactKind): string | null {
  return fileKinds.has(kind) ? ACCEPT[kind as FileKind] : null;
}

type T = (key: MessageKey, params?: Params) => string;
type FmtDay = (d: string) => string;

/** Label, date and round, joined with the no-dot separator (`SEP`). */
export function versionLine(t: T, fmtDay: FmtDay, s: State, v: ArtifactVersion): string {
  const round = v.roundId ? s.rounds[v.roundId] : null;
  const roundText = round ? t('round', { n: round.n }) : t('round.none');
  return [noDots(v.label), fmtDay(v.date), roundText].join(SEP);
}

/**
 * Whether `me` can share a private artifact: `shared` (already public), `ok` (mine, no private
 * linked need), `links_private` (mine, but a linked need is still private: share that first), or
 * `not_owner` (someone else's private artifact). Privacy scoping keeps `not_owner` unreachable from
 * a real view (a private artifact is invisible to everyone but its owner); the branch stays explicit
 * because `shareState` is also exercised directly, against hand-built state.
 */
export function shareState(s: State, me: Id, a: Artifact): 'shared' | 'ok' | 'not_owner' | 'links_private' {
  if (a.privateTo === null) return 'shared';
  if (a.createdBy !== me) return 'not_owner';
  if (a.needIds.some((id) => (s.needs[id]?.privateTo ?? null) !== null)) return 'links_private';
  return 'ok';
}

/**
 * The needs an artifact with this privacy may link, open ones first (I6). Core's `linkNeeds`
 * refuses a shared artifact that links a still-private need, so a shared artifact is offered
 * shared needs only; a private ("Only me") artifact may link my private needs too.
 */
export function linkableNeeds(s: State, projectId: Id, isPrivate: boolean): Need[] {
  return projectNeeds(s, projectId)
    .filter((n) => isPrivate || n.privateTo === null)
    .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)));
}

/** `ids` without the needs an artifact with this privacy may not link (unticking "Only me" drops my private needs). */
export function keepLinkable(s: State, ids: Id[], isPrivate: boolean): Id[] {
  return isPrivate ? ids : ids.filter((id) => (s.needs[id]?.privateTo ?? null) === null);
}

/** The prompt copied for an agent to fetch this artifact over MCP's `read_artifact`. */
export function agentPrompt(t: T, projectId: Id, a: Artifact): string {
  return t('af.agentPrompt', { title: noDots(a.title), projectId, artifactId: a.id });
}

/** The result of uploading a version's file: the blob hash and media type, or the bridge's refusal code. */
export type UploadResult = { ok: true; blobHash: string; mediaType: string } | { ok: false; code: string };

/**
 * Uploads a file-kind version's file through the bridge (contract §2: `uploadBlob` first). Only for
 * kinds in `fileKinds`. `ok: false` only when the upload itself fails (never a partial result): the
 * caller must show an error and submit no `artifact.version_added` in that case, never one with a
 * null content reference.
 */
export async function uploadVersionFile(
  uploadBlob: (bytes: Uint8Array, mediaType: string) => Promise<Result<{ hash: string; size: number }>>,
  kind: ArtifactKind,
  file: { arrayBuffer(): Promise<ArrayBuffer> },
): Promise<UploadResult> {
  const mediaType = mediaTypeFor(kind)!;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const up = await uploadBlob(bytes, mediaType);
  return up.ok ? { ok: true, blobHash: up.hash, mediaType } : { ok: false, code: up.code };
}
