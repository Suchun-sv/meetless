import type {
  AgentReply,
  ArtifactKind,
  Id,
  InputKind,
  IsoDate,
  IsoTime,
  NeedContext,
  NeedKind,
  NeedStatus,
  Requester,
  Scene,
  SearchHit,
  Seq,
  WorkEffect,
} from '@meetless/core';
import type { McpToolName } from './mcp';

export interface UserInfo {
  id: Id;
  displayName: string;
  locale: string;
}

/** `me`'s response (contract §3 doesn't name it; the controller ruling does). */
export interface MeRes {
  user: UserInfo;
  devAuth: boolean;
  /** Whether free questions to the project agent go to a model (server-side key), and which. */
  ai: { enabled: boolean; provider: 'deepseek' | null };
}

export interface InviteInfo {
  id: Id;
  projectId: Id | null;
  roleId: Id | null;
  createdBy: Id | null;
  createdAt: IsoTime;
  usedBy: Id | null;
  usedAt: IsoTime | null;
  revokedAt: IsoTime | null;
}

export interface AgentTokenInfo {
  id: Id;
  label: string;
  createdAt: IsoTime;
  lastUsedAt: IsoTime | null;
  revokedAt: IsoTime | null;
}

export interface AgentCall {
  id: Id;
  at: IsoTime;
  tokenId: Id;
  client: string | null;
  tool: McpToolName;
  projectId: Id | null;
  needCode: string | null;
  ok: boolean;
  code: string | null;
}

export interface NeedSummary {
  projectId: Id;
  code: string;
  kind: NeedKind;
  title: string;
  status: NeedStatus;
  round: number | null;
  owner: string | null;
  version: number;
  link: string;
}

export interface ArtifactRead {
  artifact: {
    id: Id;
    projectId: Id;
    kind: ArtifactKind;
    title: string;
    where: string;
    url: string | null;
    needCodes: string[];
  };
  version: { id: Id; label: string; date: IsoDate; note: string; url: string | null; mediaType: string | null } | null;
  text: string[];
}

type OfficeConfigRes =
  | { available: true; documentServerUrl: string; config: Record<string, unknown> }
  | { available: false; reason: 'not_configured' | 'unsupported_kind' | 'no_file' | 'unavailable' };

/**
 * The HTTP route contract. Keyed by `ApiName`; each entry is the request shape
 * (path params are fields of `req`, see `requestParts` in routes.ts) and the response shape.
 */
export interface ApiSpec {
  me: { req: Record<string, never>; res: MeRes };
  'invites.create': { req: { projectId: Id; roleId: Id | null }; res: { code: string; invite: InviteInfo } };
  'invites.list': { req: { projectId: Id }; res: { invites: InviteInfo[] } };
  'invites.revoke': { req: { projectId: Id; inviteId: Id }; res: { revoked: true } };
  'invites.redeem': {
    req: { code: string; displayName: string; locale: string };
    res: { token: string; user: UserInfo; projectId: Id | null };
  };
  'tokens.create': { req: { label: string }; res: { token: string; info: AgentTokenInfo } };
  'tokens.list': { req: Record<string, never>; res: { tokens: AgentTokenInfo[] } };
  'tokens.revoke': { req: { tokenId: Id }; res: { revoked: true } };
  'agentCalls.list': { req: { limit?: number }; res: { calls: AgentCall[] } };
  'agentSetup.get': {
    req: Record<string, never>;
    res: { serverUrl: string; mcpUrl: string; claudeCommand: string; codexToml: string; guidePath: string };
  };
  /** Token-agnostic setup instructions (the Agents page's own text); `<TOKEN>` is a placeholder. */
  'agent.guide': { req: Record<string, never>; res: { markdown: string } };
  /** One question to the project agent, answered from the caller's own view (generated, or the rule answer as fallback). */
  /**
   * Content to add (需要：1. ... 2. ...) is imported as the input `in-<messageId>` (private with
   * `private: true`, the composer's 「仅自己」) and answered with intent `added`.
   */
  'agent.ask': { req: { projectId: Id | 'home'; question: string; threadId?: Id; messageId?: Id; private?: boolean }; res: { reply: AgentReply } };
  'inputs.import': {
    req: {
      projectId: Id;
      inputId: Id;
      title: string;
      kind: InputKind;
      blobHash: string | null;
      text: string | null;
      from: Requester | null;
      date: IsoDate;
      private: boolean;
      /** The scene when the text shows none (detected otherwise): the composer sends `agent`; default `doc`. */
      scene?: Scene;
    };
    res: { inputId: Id; seq: Seq; extracts: number };
  };
  'office.config': { req: { projectId: Id; artifactId: Id; versionId: Id }; res: OfficeConfigRes };
  'context.get': {
    req: { projectId: Id; code: string; locale?: 'zh-CN' | 'en' };
    res: NeedContext & { recordedFetch: boolean };
  };
  'projects.list': { req: Record<string, never>; res: { projects: { id: Id; name: string; sample: boolean }[] } };
  'needs.list': {
    req: { projectId: Id; kind?: NeedKind; status?: NeedStatus; round?: 'current' | number };
    res: { needs: NeedSummary[] };
  };
  search: {
    req: { q: string; projectId?: Id; limit?: number };
    res: { hits: (SearchHit & { needCode: string | null })[] };
  };
  'artifacts.read': { req: { projectId: Id; artifactId: Id; versionId?: Id }; res: ArtifactRead };
  'work.record': {
    req: { projectId: Id; code: string; text: string; why?: string | null; effect?: WorkEffect | null; date?: IsoDate };
    res: { workId: Id; seq: Seq };
  };
  'needs.propose': {
    req: {
      projectId: Id;
      kind: NeedKind;
      title: string;
      accept?: string;
      expect?: string;
      verify?: string;
      why?: string;
      parentCode?: string;
    };
    res: { proposalId: Id; seq: Seq };
  };
  'needs.verdict': {
    req: { projectId: Id; code: string; status: 'testing' | 'held' | 'refuted' | 'parked'; verdict: string };
    res: { seq: Seq };
  };
  /** Coordinator ruling: `session.revoke`. S implements it; the client's `signOut()` calls it. */
  'session.revoke': { req: Record<string, never>; res: { revoked: true } };
  // --- A project's Claude Code session (cc.*): members read, the owner (project creator) acts.
  'cc.status': { req: { projectId: Id }; res: CcStatus };
  'cc.history': { req: { projectId: Id; before?: string; limit?: number }; res: { items: CcItem[]; before: string | null } };
  /** Starts a turn: the first one mints the project's agent token, writes its folder and creates the session. */
  'cc.turn': { req: { projectId: Id; text: string }; res: { turnId: string; next: number } };
  /** Long-poll (up to 20 s) for a turn's events after `after`; without `turnId`, the latest turn. */
  'cc.events': { req: { projectId: Id; turnId?: string; after?: number }; res: { events: CcEvent[]; next: number; done: boolean } };
  'cc.cancel': { req: { projectId: Id }; res: { cancelled: boolean } };
  'cc.approve': { req: { projectId: Id; approvalId: string; allow: boolean }; res: { ok: true } };
  'cc.handoff': { req: { projectId: Id }; res: { commands: CcHandoffCommand[] } };
  /** The read-only code repo (a path on the server machine), kept server-side, not as an event. */
  'cc.repo': { req: { projectId: Id; repoPath: string | null }; res: { repoPath: string | null } };
  // --- The 「需求」 inbox: materials with no project yet, the caller's own (server-side rows, not events).
  'inbox.list': { req: Record<string, never>; res: { pending: InboxCard[]; recent: InboxCard[]; older: number; badge: number } };
  /** A file or image is uploaded first (`bridge.uploadBlob`); its hash comes here. */
  'inbox.add': { req: InboxAddReq; res: { id: string; rev: number; existing: boolean } };
  /** With `rev`, waits (up to 20 s) while the material is analysing and still at that revision. */
  'inbox.get': { req: { materialId: string; rev?: number }; res: InboxMaterial };
  'inbox.commit': { req: { materialId: string } & InboxCommitReq; res: InboxCommitRes };
  'inbox.undo': { req: { materialId: string }; res: { ok: true } };
  'inbox.retry': { req: { materialId: string }; res: { rev: number } };
  'inbox.remove': { req: { materialId: string }; res: { ok: true } };
}

export type InboxKind = 'text' | 'pdf' | 'docx' | 'image' | 'mail' | 'chat' | 'proposal';
export type InboxStatus = 'analyzing' | 'ready' | 'committed' | 'empty' | 'failed';
export type InboxStage = 'reading' | 'extracting' | 'routing' | 'checking' | 'done';
export type InboxSource = 'paste' | 'file' | 'camera' | 'album' | 'drop' | 'share' | 'agent' | 'project';

export interface InboxAddReq {
  source: InboxSource;
  text?: string;
  blobHash?: string;
  mediaType?: string;
  fileName?: string;
  /** Text the device already recognised in the image (iOS Vision); the server OCRs when absent. */
  ocrText?: string;
}

export interface InboxItem {
  id: string;
  type: 'need' | 'hyp' | 'rev';
  text: string;
  due: IsoDate | null;
  /** The sentence it came from, and where (「第 2 页」). */
  quote: string | null;
  page: number | null;
  /** The suggested project; null = the suggested new project. */
  projectId: Id | null;
  /** The same thing as this existing need: 合并到. */
  duplicateOf?: Id;
  /** Contradicts an existing need (its deadline). */
  conflict?: { needId: Id; field: 'due'; old: IsoDate | null; new: IsoDate };
  /** The existing need a revision changes. */
  revNeedId?: Id;
}

export interface InboxRouting {
  /** [0] is the suggestion; the rest are 也可能是. Empty with `newProject` = suggest a new project. */
  candidates: { projectId: Id; reason: string; reasonBold?: string[]; roundId?: Id }[];
  newProject?: { name: string; reason: string; firstRound: { title: string; due: IsoDate | null; quote: string | null } | null; template: 'activity' | 'paper' | 'course' | null };
}

export interface InboxCommitSummary {
  batchId: string;
  projectIds: Id[];
  created: number;
  merged: number;
  changedDue: number;
  /** Existing needs revised by the material. */
  revised: number;
  undoUntil: IsoTime;
}

export interface InboxMaterial {
  id: string;
  rev: number;
  kind: InboxKind;
  title: string;
  source: InboxSource;
  addedAt: IsoTime;
  status: InboxStatus;
  stage: InboxStage;
  /** Pages read so far; null = no pages (pasted text, chat): an indeterminate bar. */
  progress: { page: number; pages: number } | null;
  pages?: number;
  size?: number;
  mediaType?: string;
  summary: string | null;
  due?: { date: IsoDate; quote: string | null };
  items: InboxItem[];
  routing: InboxRouting | null;
  error?: { code: 'NO_TEXT' | 'TOO_LARGE' | 'UNREADABLE' | 'OCR_FAILED' | 'AI_FAILED' | 'TIMEOUT'; message: string };
  committed?: (InboxCommitSummary & { at: IsoTime }) | null;
}

export interface InboxCard {
  id: string;
  kind: InboxKind;
  title: string;
  source: InboxSource;
  addedAt: IsoTime;
  status: InboxStatus;
  stage?: InboxStage;
  progress?: { page: number; pages: number } | null;
  counts: { items: number; projects: number; duplicates: number; conflicts: number };
  projectIds: Id[];
  committed?: { projectIds: Id[]; count: number };
  error?: { code: string; message: string };
}

export interface InboxCommitReq {
  items: {
    itemId: string;
    action: 'accept' | 'merge' | 'skip';
    target: { projectId: Id } | { newProject: true };
    due?: IsoDate | null;
    mergeInto?: Id;
    /** A due conflict: keep the existing need's deadline, or apply the new one. */
    conflict?: 'keep' | 'apply';
  }[];
  newProject?: { name: string; firstRound: { title: string; due: IsoDate | null } | null; template: 'activity' | 'paper' | 'course' | null };
}

export type InboxCommitRes = InboxCommitSummary;

export type CcState = 'idle' | 'running_here' | 'in_use_elsewhere';

export interface CcStatus {
  /** False when this server runs no Claude Code sessions (MEETLESS_CC_HOME unset). */
  available: boolean;
  state: CcState;
  detail?: string;
  /** The caller is the project's owner (its creator): only they talk to the session. */
  owner: boolean;
  /** Null until the first turn. */
  session: { id: string; name: string } | null;
  repoPath: string | null;
  /** The turn running here, to reattach `cc.events` after a reload. */
  turn: { id: string; startedAt: IsoTime } | null;
}

export type CcItem =
  | { kind: 'user'; id: string; text: string; at: IsoTime }
  | { kind: 'assistant'; id: string; text: string; at: IsoTime }
  | { kind: 'tool'; id: string; name: string; summary: string; ok: boolean | null; at: IsoTime }
  | { kind: 'result'; id: string; costUsd?: number; at: IsoTime };

export type CcEvent = { seq: number } & (
  | { type: 'session'; sessionId: string }
  | { type: 'user'; id: string; text: string }
  /** Assistant text; the same `id` continues the same message. */
  | { type: 'text'; id: string; delta: string }
  | { type: 'tool'; id: string; name: string; summary: string }
  | { type: 'tool_result'; id: string; ok: boolean }
  | { type: 'permission'; approvalId: string; tool: string; input: string; expiresAt: IsoTime }
  | { type: 'permission_done'; approvalId: string; behavior: 'allow' | 'deny' }
  | { type: 'result'; costUsd?: number; durationMs?: number }
  | { type: 'error'; code: string; message: string }
);

export interface CcHandoffCommand {
  kind: 'terminal' | 'remote' | 'desktop';
  command: string;
  note: string;
}

export type ApiName = keyof ApiSpec;
export type ApiRequest<K extends ApiName> = ApiSpec[K]['req'];
export type ApiResponse<K extends ApiName> = ApiSpec[K]['res'];
