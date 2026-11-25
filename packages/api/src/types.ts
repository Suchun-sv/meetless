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
}

export type ApiName = keyof ApiSpec;
export type ApiRequest<K extends ApiName> = ApiSpec[K]['req'];
export type ApiResponse<K extends ApiName> = ApiSpec[K]['res'];
