/**
 * U3-owned. Shapes shared by the capture service and the bridge. Re-exported
 * from `bridge.ts`'s `// --- U3 capture` section so the renderer can import
 * them from `@meetless/client/bridge` without reaching into `capture/*`.
 */
import type { Id, IsoTime } from '@meetless/core';
import type { RepoInfo } from '../bridge';

/** Why a capture source is not ready, or why a run skipped an artifact. */
export const CAPTURE_CODES = [
  'not_signed_in',
  'not_found',
  'no_repo',
  'no_url',
  'bad_url',
  'no_token',
  'auth_failed',
  'git_failed',
  'notion_not_connected',
  'notion_failed',
  'no_versions',
] as const;
export type CaptureCode = (typeof CAPTURE_CODES)[number];

/** `code` artifacts read from a local repo; `pptx`/`docx`/`pdf` read from their uploaded versions. */
export type CaptureSourceKind = 'repo' | 'overleaf' | 'notion' | 'upload';

export interface CaptureSource {
  artifactId: Id;
  kind: CaptureSourceKind;
  ready: boolean;
  code: CaptureCode | null;
  repo: RepoInfo | null;
  syncedAt: IsoTime | null;
  lastRunAt: IsoTime | null;
}

export interface CaptureStatus {
  sources: CaptureSource[];
  overleafToken: boolean;
  notion: 'connected' | 'disconnected';
}

export interface CaptureRunRequest {
  projectId: Id;
  artifactIds?: Id[];
  needId?: Id | null;
}

export interface CaptureRunResult {
  read: number;
  /** Accepted by the server now. */
  recorded: number;
  /** Already recorded (another run got there first): not new, so never counted as captured. */
  duplicate: number;
  queued: number;
  rejected: { workId: Id; code: string }[];
  skipped: { artifactId: Id; code: CaptureCode }[];
}

export const OVERLEAF_GIT_URL = /^https:\/\/(?:git@)?git\.overleaf\.com\/[A-Za-z0-9]+\/?$/;
export const NOTION_PAGE_URL = /^https:\/\/(?:www\.)?(?:notion\.so|[a-z0-9-]+\.notion\.site)\/\S+$/;

/** Hard cap on `work.recorded` commands produced by one `run`, per `planCapture` call. */
export const MAX_CAPTURES_PER_RUN = 30;
/** How many commits `repoRecords` reads from a bound repo's `HEAD`. */
export const CAPTURE_LOG_LIMIT = 50;
