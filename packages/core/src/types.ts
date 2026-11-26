/**
 * Meetless domain model (v3): needs, rounds, inputs, work, handoffs and
 * dashboards. Language-independent: user content is stored as entered; all
 * UI text lives in @meetless/i18n.
 *
 * The loop is needs -> work -> delivery -> feedback -> new needs. One delivery
 * is one round (a hard deadline or a regular check-in).
 */

import type { AgentReply } from './agent';

export type Id = string;
/** ISO 8601 instant, e.g. 2026-11-24T09:00:00.000Z. */
export type IsoTime = string;
/** Calendar date YYYY-MM-DD (business dates: due dates, when something was said). */
export type IsoDate = string;
export type Seq = number;
export type LanguageTag = string;

export interface User {
  id: Id;
  displayName: string;
  locale: LanguageTag;
}

export interface Project {
  id: Id;
  name: string;
  description: string;
  createdBy: Id;
  createdSeq: Seq;
  memberIds: Id[];
  /** Loaded by the sample-data dev command; labelled "Sample data" in the UI. */
  sample: boolean;
  /** Next public need number per kind (N1, N2 / H1, H2). Only public needs consume numbers. */
  nextCode: { ext: number; hyp: number };
  /** Every `project.renamed`, oldest first; Activity shows each as a system line. */
  renames: ProjectRename[];
}

/** One `project.renamed`: the name before and after (cleaned), who renamed it, and when. */
export interface ProjectRename {
  from: string;
  to: string;
  by: Id;
  at: IsoTime;
  seq: Seq;
}

export interface Role {
  id: Id;
  projectId: Id;
  name: string;
  memberIds: Id[];
  createdSeq: Seq;
}

export type RoundKind = 'hard' | 'cadence';
export type RoundStatus = 'planned' | 'current' | 'delivered';

export interface DeliveryAccount {
  needId: Id;
  status: NeedStatus;
  note: string;
}

export interface Delivery {
  items: string[];
  account: DeliveryAccount[];
  date: IsoDate;
  by: Id;
  seq: Seq;
}

export interface Round {
  id: Id;
  projectId: Id;
  /** 1-based, in creation order within the project. */
  n: number;
  title: string;
  kind: RoundKind;
  start: IsoDate;
  due: IsoDate;
  status: RoundStatus;
  /** Planned delivery items while not delivered (draft); frozen on delivery. */
  items: string[];
  delivery: Delivery | null;
}

export type NeedKind = 'ext' | 'hyp';
export const EXT_STATUSES = ['todo', 'doing', 'met', 'partial', 'moved', 'dropped'] as const;
export const HYP_STATUSES = ['untested', 'testing', 'held', 'refuted', 'parked'] as const;
export type ExtStatus = (typeof EXT_STATUSES)[number];
export type HypStatus = (typeof HYP_STATUSES)[number];
export type NeedStatus = ExtStatus | HypStatus;
/** Statuses that count as finished (not open work). */
export const CLOSED_STATUSES: ReadonlySet<NeedStatus> = new Set<NeedStatus>(['met', 'held', 'refuted', 'dropped', 'moved']);

export const SOURCE_KINDS = ['commit', 'exp', 'doc', 'meeting', 'chat', 'mail', 'file', 'agent'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Who asked. Members are referenced by id; people outside the project (clients, venues) by name. */
export interface Requester {
  userId?: Id;
  name?: string;
}

export interface NeedSource {
  src: SourceKind;
  date: IsoDate;
  /** The original words. */
  quote: string;
  /** Where it came from (document title, meeting, chat). */
  ref: string;
  inputId?: Id;
  extractId?: Id;
  proposalId?: Id;
}

export interface Revision {
  id: Id;
  date: IsoDate;
  text: string;
  why: string;
  by: Id;
  seq: Seq;
  /** Context version this revision produced (2 for the first revision). */
  version: number;
  inputId?: Id;
}

export interface Need {
  id: Id;
  projectId: Id;
  /** N1 / H1 for shared needs; Np1 / Hp1 for private ones (renumbered when shared). */
  code: string;
  kind: NeedKind;
  title: string;
  status: NeedStatus;
  roundId: Id | null;
  parentId: Id | null;
  /** The delivered round whose feedback produced this need (lineage). */
  fromRoundId: Id | null;
  ownerId: Id | null;
  requester: Requester | null;
  /** External needs: acceptance criteria ("done when"). */
  accept: string | null;
  /** Hypotheses: expected effect and how to test; verdict once tested. */
  expect: string | null;
  verify: string | null;
  verdict: string | null;
  source: NeedSource;
  revisions: Revision[];
  /** Set = only this user can see it ("Only me"). */
  privateTo: Id | null;
  /** True only while the round was filled in by the rule (extract.accepted with no roundId); cleared by need.updated with a roundId. Drives the drawer's "规则生成 改" mark. */
  autoRound: boolean;
  createdBy: Id;
  createdSeq: Seq;
  updatedSeq: Seq;
}

export const WORK_EFFECTS = ['done', 'advance', 'revise', 'spawn', 'refute', 'hold', 'extract', 'move'] as const;
export type WorkEffect = (typeof WORK_EFFECTS)[number];

/** Set by the service when a person's agent reported over MCP. */
export interface AgentVia {
  /** 'claude-code' | 'codex' | another client label. */
  client: string;
  tokenId: Id;
}

export interface WorkItem {
  id: Id;
  projectId: Id;
  needId: Id | null;
  alsoNeedId: Id | null;
  src: SourceKind;
  text: string;
  why: string | null;
  effect: WorkEffect | null;
  result: 'keep' | 'revert' | null;
  date: IsoDate;
  by: Id;
  via: AgentVia | null;
  /** Project-agent capture of repos/docs: reference only, never counts as progress. */
  capture: boolean;
  /** Set by work.ignored: not progress, dropped from the activity card; final. */
  ignored: boolean;
  /** Set when the need link came from the rule's code/keyword match, not a person; work.linked clears it. */
  autoLinked: boolean;
  privateTo: Id | null;
  seq: Seq;
  recordedAt: IsoTime;
}

export const INPUT_KINDS = ['md', 'txt', 'docx', 'pdf'] as const;
export type InputKind = (typeof INPUT_KINDS)[number];
export type ExtractType = 'new' | 'hyp' | 'rev' | 'action';
export type ExtractState = 'accepted' | 'ignored';

export interface InputPara {
  id: Id;
  text: string;
}

export interface Extract {
  id: Id;
  type: ExtractType;
  text: string;
  paraId: Id | null;
  /** For revisions: the need being revised. */
  needId: Id | null;
  accept: string | null;
  expect: string | null;
  verify: string | null;
  /** The paragraph contradicts the target need: decided in "To confirm", not here. */
  conflict: boolean;
  state: ExtractState | null;
  decidedBy: Id | null;
  /** Need created or revised by accepting. */
  resultNeedId: Id | null;
}

/** The occasion an input records (its scene), shown in the lineage: a meeting or voice note, an email, a chat, an agent conversation, a document, handwriting. */
export const SCENES = ['meeting', 'mail', 'chat', 'agent', 'doc', 'handwritten'] as const;
export type Scene = (typeof SCENES)[number];

export interface Input {
  id: Id;
  projectId: Id;
  kind: InputKind;
  /** Set on import (detected from the text) and changeable later (`input.scene_set`); null for inputs from before it existed. */
  scene: Scene | null;
  /** A one-line summary written on import when AI is on; null otherwise (the lineage shows the first paragraph then). */
  summary: string | null;
  title: string;
  from: Requester | null;
  date: IsoDate;
  blobHash: string | null;
  body: InputPara[];
  extracts: Extract[];
  /** Which detector produced the extracts ("rules/1" = rule-based, simulated). */
  detector: string;
  importedBy: Id;
  privateTo: Id | null;
  seq: Seq;
}

export type ConflictStatus = 'open' | 'delegated' | 'resolved';
export type ConflictResolution =
  | { kind: 'revise'; by: Id; seq: Seq }
  | { kind: 'park'; by: Id; seq: Seq; needId: Id }
  | { kind: 'handoff'; by: Id; seq: Seq; handoffId: Id; toId: Id };

export interface Conflict {
  id: Id;
  projectId: Id;
  needId: Id;
  inputId: Id;
  extractId: Id;
  /** The current wording of the need when the conflict opened. */
  old: string;
  /** The new input's words. */
  neu: string;
  /** Input title. */
  src: string;
  status: ConflictStatus;
  /** Who decides: the importer, or the person it was handed to. */
  deciderId: Id;
  resolution: ConflictResolution | null;
  openedSeq: Seq;
}

export const HANDOFF_STATES = ['sent', 'accepted', 'asked', 'declined', 'doing', 'returned', 'done'] as const;
export type HandoffState = (typeof HANDOFF_STATES)[number];

export interface HandoffFetch {
  version: number;
  seq: Seq;
  at: IsoTime;
  client: string | null;
}

export interface Handoff {
  id: Id;
  projectId: Id;
  needId: Id;
  fromId: Id;
  toId: Id;
  ask: string;
  due: IsoDate | null;
  state: HandoffState;
  history: { state: HandoffState; by: Id; seq: Seq; at: IsoTime; note: string | null }[];
  /** Every context fetch by the recipient's agent (MCP get_need_context). */
  fetches: HandoffFetch[];
  /** The sender asked the recipient to refresh, at this context version. */
  refreshRequested: { version: number; seq: Seq } | null;
  conflictId: Id | null;
  createdSeq: Seq;
}

export type ProposalStatus = 'open' | 'accepted' | 'rejected';
export interface Proposal {
  id: Id;
  projectId: Id;
  kind: NeedKind;
  title: string;
  accept: string | null;
  expect: string | null;
  verify: string | null;
  why: string | null;
  parentId: Id | null;
  by: Id;
  via: AgentVia | null;
  status: ProposalStatus;
  needId: Id | null;
  decidedBy: Id | null;
  seq: Seq;
}

export const ARTIFACT_KINDS = ['overleaf', 'code', 'notion', 'pptx', 'docx', 'pdf'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface DerivedPreview {
  status: 'ready' | 'partial' | 'failed';
  /** One PNG blob per page/slide. */
  pageHashes: string[];
  /** Extracted text per page/slide/paragraph block. */
  texts: string[];
  error: string | null;
  converter: string | null;
}

export interface ArtifactVersion {
  id: Id;
  label: string;
  date: IsoDate;
  roundId: Id | null;
  note: string;
  blobHash: string | null;
  mediaType: string | null;
  url: string | null;
  by: Id;
  seq: Seq;
  derived: DerivedPreview | null;
}

export interface Artifact {
  id: Id;
  projectId: Id;
  kind: ArtifactKind;
  title: string;
  /** Where the source lives (Overleaf, GitHub, Notion, Word...). */
  where: string;
  url: string | null;
  needIds: Id[];
  /** Newest first. */
  versions: ArtifactVersion[];
  privateTo: Id | null;
  createdBy: Id;
  seq: Seq;
}

export const PROJECT_CARDS = ['timeline', 'progress', 'risks', 'members', 'delivery', 'hyps', 'activity', 'sources', 'weekly'] as const;
export const HOME_CARDS = ['timeline', 'projects', 'toMe', 'confirm', 'byMe', 'mine', 'due', 'allRisks'] as const;
export type ProjectCard = (typeof PROJECT_CARDS)[number];
export type HomeCard = (typeof HOME_CARDS)[number];
export type CardId = ProjectCard | HomeCard;
export const DEFAULT_PROJECT_CARDS: readonly ProjectCard[] = ['timeline', 'progress', 'risks', 'members', 'delivery', 'hyps', 'activity'];
export const DEFAULT_HOME_CARDS: readonly HomeCard[] = ['timeline', 'projects', 'toMe', 'confirm', 'byMe', 'mine', 'due'];
/** Cards that take the full width. */
export const WIDE_CARDS: ReadonlySet<CardId> = new Set<CardId>(['timeline', 'members', 'activity', 'projects']);

/** One user's card set for one scope ('home' or a project id). Always private to that user. */
export interface DashboardConfig {
  userId: Id;
  scope: Id;
  cards: CardId[];
  /** Last refresh per card (the card shows "updated HH:MM"). */
  refreshed: Record<string, IsoTime>;
  seq: Seq;
}

/** One question asked of the project agent and its reply. */
export interface ChatMessage {
  id: Id;
  text: string;
  reply: AgentReply;
  at: IsoTime;
  seq: Seq;
}

/**
 * One user's private conversation with the project agent for a scope ('home'
 * or a project id). Never seen by anyone but that user (design §8.8).
 */
export interface ChatThread {
  userId: Id;
  scope: Id;
  messages: ChatMessage[];
  /** Messages with seq <= clearedSeq are hidden (kept, not deleted). */
  clearedSeq: Seq;
}

export interface State {
  lastSeq: Seq;
  lastRecordedAt: IsoTime | null;
  /** event id -> seq; duplicates are ignored (idempotent retries). */
  seenEventIds: Record<Id, Seq>;
  users: Record<Id, User>;
  projects: Record<Id, Project>;
  roles: Record<Id, Role>;
  rounds: Record<Id, Round>;
  needs: Record<Id, Need>;
  work: Record<Id, WorkItem>;
  inputs: Record<Id, Input>;
  conflicts: Record<Id, Conflict>;
  handoffs: Record<Id, Handoff>;
  proposals: Record<Id, Proposal>;
  artifacts: Record<Id, Artifact>;
  /** key `${userId}|${scope}` */
  dashboards: Record<string, DashboardConfig>;
  /** key `${userId}|${scope}`; always private to that user. */
  chats: Record<string, ChatThread>;
  /** Next private need number per `${projectId}|${userId}|${kind}`. */
  privateCodes: Record<string, number>;
}

export function emptyState(): State {
  return {
    lastSeq: 0,
    lastRecordedAt: null,
    seenEventIds: {},
    users: {},
    projects: {},
    roles: {},
    rounds: {},
    needs: {},
    work: {},
    inputs: {},
    conflicts: {},
    handoffs: {},
    proposals: {},
    artifacts: {},
    dashboards: {},
    chats: {},
    privateCodes: {},
  };
}

export const dashboardKey = (userId: Id, scope: Id) => `${userId}|${scope}`;
