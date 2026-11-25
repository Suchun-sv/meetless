/**
 * The narrow, typed contract between the renderer and the process that owns
 * sync + local storage (Electron main via IPC; in dev/tests the bridge host
 * over loopback HTTP). Renderer-safe: no Node imports. Every method returns a
 * plain result object instead of throwing, because IPC does not preserve
 * error classes.
 */
import type { DomainEvent, EventPayloads, EventType, Id, IsoTime, Seq } from '@meetless/core';
import type { ApiRequest, ApiResponse, AppApiName } from '@meetless/api';

export interface Session {
  serverUrl: string;
  userId: Id;
  displayName: string;
}

export type SyncState = 'signed_out' | 'connecting' | 'online' | 'offline';

export interface SyncStatus {
  state: SyncState;
  /** Last time the client was confirmed caught up with the server. */
  lastSyncedAt: IsoTime | null;
  /** Global server seq the local cache is complete up to (resume point). */
  cursor: Seq;
  lastError: string | null;
}

export interface CommandInput<K extends EventType = EventType> {
  /** Client-generated unique id; resubmitting the same id is idempotent. */
  id: Id;
  type: K;
  payload: EventPayloads[K];
  occurredAt?: IsoTime;
}

export interface OutboxItem {
  id: Id;
  type: EventType;
  payload: unknown;
  occurredAt?: IsoTime;
  queuedAt: IsoTime;
  /** queued = saved locally, not yet effective for the team; rejected = the service refused it on reconnect. */
  status: 'queued' | 'rejected';
  error: { code: string; details?: unknown } | null;
}

export type SubmitResult =
  | { kind: 'accepted' | 'duplicate'; seq: Seq }
  | { kind: 'rejected'; code: string; details?: unknown }
  /** Offline: stored in the outbox, NOT effective for the team until the service accepts it. */
  | { kind: 'queued' };

export type Result<T> = ({ ok: true } & T) | { ok: false; code: string; details?: unknown };

export interface ClientSnapshot {
  session: Session | null;
  /** Server-accepted events visible to this user, in seq order. Never contains local-only changes. */
  events: DomainEvent[];
  status: SyncStatus;
  outbox: OutboxItem[];
  /** Persisted UI locale for the signed-in user (or last used before sign-in); null = not chosen yet. */
  locale: string | null;
  /** OS preference list, for the initial locale choice. */
  systemLocales: string[];
  /** Which local store holds the cache ("sqlite"). */
  cacheKind: string;
  /** Identifies how the renderer is connected: "electron" or "dev-bridge" (test/dev only). */
  host: 'electron' | 'dev-bridge';
}

export type BridgeEvent =
  | { type: 'events'; events: DomainEvent[] }
  /** Cache was replaced (access changed or different server log): drop everything and use `events`. */
  | { type: 'reset'; events: DomainEvent[] }
  | { type: 'status'; status: SyncStatus }
  | { type: 'outbox'; outbox: OutboxItem[] }
  | { type: 'session'; session: Session | null; locale: string | null }
  /** The app's own update state changed (Electron only): a check finished or an install moved on. */
  | { type: 'update'; update: UpdateState };

/**
 * The desktop app's own updates (Electron main, src/main/release-updater.ts). `install: 'manual'`
 * means this install type cannot replace itself (a .deb, an unpacked dir, a dev run): the UI
 * links to `releasesUrl` instead. `error` is an `UPDATE_*` code when `phase` is `failed`.
 */
export interface UpdateState {
  current: string;
  available: { version: string; notes: string[] } | null;
  install: 'self' | 'manual';
  releasesUrl: string;
  phase: 'idle' | 'downloading' | 'installing' | 'restarting' | 'failed';
  /** Download progress 0-100, when known. */
  percent: number | null;
  error: string | null;
}

/** A local git repository the user chose. Never carries the local path. */
export interface RepoInfo {
  id: string;
  /** Remote URL without credentials, or the folder name. */
  name: string;
  head: string | null;
  branch: string | null;
}

export interface CommitInfo {
  commit: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
}

export interface DiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface MeetlessBridge {
  snapshot(): Promise<ClientSnapshot>;
  signIn(serverUrl: string, token: string): Promise<Result<{ session: Session }>>;
  signOut(): Promise<void>;
  submit(cmd: CommandInput): Promise<SubmitResult>;
  dismissOutbox(id: Id): Promise<void>;
  uploadBlob(bytes: Uint8Array, mediaType: string): Promise<Result<{ hash: string; size: number }>>;
  readBlob(hash: string): Promise<Result<{ bytes: Uint8Array }>>;
  /** Calls a Meetless API route reachable from the app. A route not reachable from the app refuses with `NOT_AVAILABLE` and makes no request. */
  api<K extends AppApiName>(name: K, input: ApiRequest<K>): Promise<Result<{ data: ApiResponse<K> }>>;
  /** Redeems an invite code on a server the caller may not be signed into yet, then signs in with the token it returns. */
  redeemInvite(serverUrl: string, code: string, displayName: string): Promise<Result<{ session: Session }>>;
  /** Opens the folder holding the diagnostics log (Electron). */
  openLogs(): Promise<Result<{ opened: boolean }>>;
  setLocale(locale: string): Promise<void>;
  /** Lets the user choose a local repository (Electron: folder dialog). */
  pickRepo(hint?: string): Promise<Result<{ repo: RepoInfo }>>;
  listRepos(): Promise<RepoInfo[]>;
  repoLog(repoId: string, ref?: string, limit?: number): Promise<Result<{ commits: CommitInfo[] }>>;
  repoDiff(repoId: string, base: string | null, head: string): Promise<Result<{ files: DiffFile[] }>>;
  repoPatch(repoId: string, base: string | null, head: string, path: string): Promise<Result<{ patch: string; truncated: boolean }>>;
  /** Builds the code snapshot in the main process and uploads it; the renderer gets only its hash and summary. */
  repoSnapshot(
    repoId: string,
    commit: string,
    base?: string | null,
    paths?: string[],
  ): Promise<Result<{ hash: string; size: number; commit: string; branch: string | null; baseCommit: string | null; repo: string; files: number; truncated: boolean }>>;

  // --- U3 capture
  /** One capture source per visible artifact of the project, with its readiness. */
  captureStatus(projectId: Id): Promise<Result<{ status: import('./capture/types').CaptureStatus }>>;
  /** Binds (or unbinds, with `repoId: null`) the local repo a code artifact captures commits from. */
  captureBindRepo(artifactId: Id, repoId: string | null): Promise<Result<{ bound: boolean }>>;
  /** Runs capture (local repos, uploaded versions, Overleaf git projects, Notion pages) and submits what it finds. */
  captureRun(req: import('./capture/types').CaptureRunRequest): Promise<Result<{ runId: Id; result: import('./capture/types').CaptureRunResult }>>;
  /** Stores (or, with `null`/`''`, clears) the Overleaf git token. Kept on this machine only, in `capture/secrets.json`; never sent to the server. */
  overleafSetToken(token: string | null): Promise<Result<{ saved: boolean }>>;
  /** Clones (first run) or pulls (later runs) an Overleaf artifact's git project; the clone's repo info, never the token. */
  overleafSync(artifactId: Id): Promise<Result<{ repo: RepoInfo; syncedAt: IsoTime }>>;
  /** Starts the user's own Notion OAuth; the caller opens `authorizeUrl` in the browser. Tokens stay on this machine, in `capture/notion-oauth.json`. */
  notionConnect(): Promise<Result<{ authorizeUrl: string }>>;
  /** Forgets the stored Notion tokens on this machine. */
  notionDisconnect(): Promise<Result<{ disconnected: true }>>;
  /** A Notion artifact's page through the Notion MCP, read live and never stored. `notion_not_connected` without a connection, never old content. */
  notionPage(artifactId: Id): Promise<Result<{ paragraphs: string[]; fetchedAt: IsoTime }>>;

  // --- app updates (Electron only; other hosts answer NOT_AVAILABLE)
  /** Checks for a newer release now and returns the update state. */
  updatesCheck(): Promise<Result<{ update: UpdateState }>>;
  /** Installs the release found by the last check; progress arrives as `update` events. Only on the user's click. */
  updatesInstall(): Promise<Result<object>>;

  subscribe(cb: (e: BridgeEvent) => void): () => void;
}

// --- U3 capture
export {
  CAPTURE_CODES,
  CAPTURE_LOG_LIMIT,
  MAX_CAPTURES_PER_RUN,
  NOTION_PAGE_URL,
  OVERLEAF_GIT_URL,
  type CaptureCode,
  type CaptureRunRequest,
  type CaptureRunResult,
  type CaptureSource,
  type CaptureSourceKind,
  type CaptureStatus,
} from './capture/types';

/** Method names callable over the bridge transport (IPC channel / dev RPC). */
export const BRIDGE_METHODS = [
  'snapshot',
  'signIn',
  'signOut',
  'submit',
  'dismissOutbox',
  'uploadBlob',
  'readBlob',
  'api',
  'redeemInvite',
  'openLogs',
  'setLocale',
  'pickRepo',
  'listRepos',
  'repoLog',
  'repoDiff',
  'repoPatch',
  'repoSnapshot',
  // --- U3 capture
  'captureStatus',
  'captureBindRepo',
  'captureRun',
  'overleafSetToken',
  'overleafSync',
  'notionConnect',
  'notionDisconnect',
  'notionPage',
  // --- app updates
  'updatesCheck',
  'updatesInstall',
] as const satisfies readonly (keyof MeetlessBridge)[];
export type BridgeMethod = (typeof BRIDGE_METHODS)[number];
