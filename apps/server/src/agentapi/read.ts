import { DomainError, search as coreSearch } from '@meetless/core';
import type { Artifact, ArtifactVersion, Id, State } from '@meetless/core';
import type { ApiRequest, ApiResponse, ArtifactRead } from '@meetless/api';
import { ApiError, type ApiDeps } from '../api/frame';
import { optInt, optString, reqString } from '../api/fields';
import { extractText, MAX_IMPORT_BYTES } from '../imports/extract';
import { capTexts } from '../office/pdf-text';
import type { SyncService } from '../service';

/** `search`'s default and ceiling (task brief: "limit default 20, maximum 50"). */
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
/** `artifacts.read`'s response text cap (task brief): total characters across the array. */
const MAX_ARTIFACT_READ_CHARS = 100_000;

/**
 * `search` (contract §3, §12.21, §12.22): core's keyword retrieval over `view`, with each
 * hit's `needId`/`needCode` re-checked against `view.needs` — never trusted from the hit
 * alone — so a hit whose cited need is not in the viewer's view (another user's private
 * need, carried as an id by a shared item, contract §12.22) names no need at all: both
 * `needId` and `needCode` come back `null`, not just `needCode`.
 */
export function searchHits(view: State, req: ApiRequest<'search'>): ApiResponse<'search'>['hits'] {
  const q = reqString(req.q, 'q');
  const projectId = optString(req.projectId, 'projectId');
  const n = optInt(req.limit, 'limit') ?? DEFAULT_SEARCH_LIMIT;
  const limit = Math.min(Math.max(1, n), MAX_SEARCH_LIMIT);
  const hits = coreSearch(view, { text: q, projectId, limit });
  return hits.map((h) => {
    const visible = h.needId !== null && Boolean(view.needs[h.needId]);
    return { ...h, needId: visible ? h.needId : null, needCode: visible ? view.needs[h.needId!]!.code : null };
  });
}

function latestVersion(artifact: Artifact): ArtifactVersion | null {
  return [...artifact.versions].sort((a, b) => b.seq - a.seq)[0] ?? null;
}

/** Drops a trailing empty block left by splitting joined page text on blank lines (e.g. a last page that was itself blank, or a trailing newline at the join). Only the final one; an empty block in the middle is a real (blank) page. */
function dropTrailingEmptyBlock(blocks: string[]): string[] {
  return blocks.length > 0 && blocks[blocks.length - 1] === '' ? blocks.slice(0, -1) : blocks;
}

/** True for the two ways a pdf fallback extraction legitimately comes up empty: the blob file is missing (`ENOENT`), or `extractText` itself refused the bytes (`EXTRACT_FAILED`). Anything else is a real bug and must not be swallowed. */
function isBenignExtractFailure(e: unknown): boolean {
  if (e instanceof ApiError && e.code === 'EXTRACT_FAILED') return true;
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'ENOENT';
}

/** The read-time parse in flight for each pdf version, per service: concurrent reads of one version share a single parse. */
const fallbackParses = new WeakMap<SyncService, Map<Id, Promise<string[]>>>();

/**
 * The read-time text of a pdf version whose `derived` is still null, used only while the PDF
 * text worker is off (with it on, the worker fills `derived`). A blob over `MAX_IMPORT_BYTES`
 * (or with no meta) is `[]` before any byte is read. One parse per version at a time: a read
 * arriving while one is in flight awaits that same parse. A missing file or a failed extraction
 * is `[]`; any other error propagates.
 */
async function fallbackText(deps: ApiDeps, versionId: Id, blobHash: string): Promise<string[]> {
  let byVersion = fallbackParses.get(deps.service);
  if (!byVersion) {
    byVersion = new Map();
    fallbackParses.set(deps.service, byVersion);
  }
  let parse = byVersion.get(versionId);
  if (!parse) {
    const mine = (async () => {
      const meta = await deps.service.blobMeta.get(blobHash);
      if (!meta || meta.size > MAX_IMPORT_BYTES) return [];
      const bytes = await deps.service.blobFiles.readBytes(blobHash);
      return dropTrailingEmptyBlock((await extractText('pdf', bytes)).split(/\n{2,}/));
    })();
    const done = () => {
      if (byVersion.get(versionId) === mine) byVersion.delete(versionId);
    };
    mine.then(done, done);
    byVersion.set(versionId, mine);
    parse = mine;
  }
  try {
    return await parse;
  } catch (e) {
    if (!isBenignExtractFailure(e)) throw e;
    return [];
  }
}

/**
 * `artifacts.read` (contract §3; amendments "Task 6 amendments", R37): the artifact and one
 * of its versions, as visible in `view`.
 *
 * - An artifact not in `view.artifacts` (unknown, another project's, or private to someone
 *   else) is `NOT_FOUND`; so is a `versionId` that does not name a version of it.
 * - Without `versionId`, the version is the latest by `seq` (an artifact with no version
 *   yet answers `version: null`, not `NOT_FOUND`).
 * - `text`: `derived.texts` when `derived` is ready or partial (Task 5b fills these for pdf
 *   versions). For a pdf version with a blob whose `derived` is still null: `[]` while the PDF
 *   text worker is on (it will fill `derived`); with the worker off (`MEETLESS_PDF_TEXT=off`),
 *   extracted on read (`fallbackText`: size-capped, one parse per version at a time, split on
 *   blank lines, trailing empty block dropped). `[]` otherwise (no file, a non-pdf kind, or a
 *   `derived` that failed). A missing blob or a failed extraction during the fallback also
 *   gives `[]`; any other error propagates (it is not this route's job to hide a real bug as
 *   empty text).
 *   Capped at 100 000 characters in total (`capTexts`, the same boundary-truncating cap
 *   Task 5b's worker uses for storage, reused here for the response).
 * - `needCodes` lists only the artifact's linked needs that are present in `view` (never
 *   another user's private need carried by `needIds`).
 */
export async function readArtifact(deps: ApiDeps, view: State, req: ApiRequest<'artifacts.read'>): Promise<ArtifactRead> {
  const versionId = optString(req.versionId, 'versionId');
  const artifact = view.artifacts[req.artifactId];
  if (!artifact || artifact.projectId !== req.projectId) {
    throw new DomainError('NOT_FOUND', 'artifact not found', { what: 'artifact', projectId: req.projectId, artifactId: req.artifactId });
  }
  const version = versionId ? artifact.versions.find((v) => v.id === versionId) ?? null : latestVersion(artifact);
  if (versionId && !version) {
    throw new DomainError('NOT_FOUND', 'artifact version not found', {
      what: 'artifactVersion',
      projectId: req.projectId,
      artifactId: req.artifactId,
      versionId,
    });
  }

  let text: string[] = [];
  if (version) {
    const d = version.derived;
    if (d && (d.status === 'ready' || d.status === 'partial')) {
      text = d.texts;
    } else if (d === null && artifact.kind === 'pdf' && version.blobHash && deps.cfg.workers?.pdfText === false) {
      text = await fallbackText(deps, version.id, version.blobHash);
    }
  }
  text = capTexts(text, MAX_ARTIFACT_READ_CHARS);

  const needCodes = artifact.needIds.filter((id) => view.needs[id]).map((id) => view.needs[id]!.code);

  return {
    artifact: {
      id: artifact.id,
      projectId: artifact.projectId,
      kind: artifact.kind,
      title: artifact.title,
      where: artifact.where,
      url: artifact.url,
      needCodes,
    },
    version: version ? { id: version.id, label: version.label, date: version.date, note: version.note, url: version.url, mediaType: version.mediaType } : null,
    text,
  };
}
