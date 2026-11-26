import type { AgentReply } from './agent';
import type {
  AgentVia,
  Artifact,
  ArtifactKind,
  CardId,
  DeliveryAccount,
  ExtractType,
  Id,
  InputKind,
  IsoDate,
  IsoTime,
  LanguageTag,
  Need,
  NeedKind,
  NeedSource,
  NeedStatus,
  Requester,
  RoundKind,
  Seq,
  SourceKind,
  WorkEffect,
  WorkItem,
  Input,
  Scene,
} from './types';

export interface ExtractInput {
  id: Id;
  type: ExtractType;
  text: string;
  paraId: Id | null;
  needId?: Id | null;
  accept?: string | null;
  expect?: string | null;
  verify?: string | null;
  conflict?: boolean;
}

/**
 * Every state change, keyed by event type. Ids of objects an event creates are
 * carried in the payload so reducers stay deterministic.
 */
export interface EventPayloads {
  /** Service-only. */
  'user.registered': { userId: Id; displayName: string; locale: LanguageTag };
  'user.locale_changed': { userId: Id; locale: LanguageTag };

  'project.created': { projectId: Id; name: string; description?: string; sample?: boolean };
  'project.member_added': { projectId: Id; userId: Id };
  /** Any member renames the project. The name is cleaned with `noDots`, trimmed, and must be 1 to 80 characters (code points). */
  'project.renamed': { projectId: Id; name: string };
  'role.created': { roleId: Id; projectId: Id; name: string };
  'role.member_assigned': { roleId: Id; userId: Id };
  'role.member_removed': { roleId: Id; userId: Id };

  'round.created': { roundId: Id; projectId: Id; title: string; kind: RoundKind; start: IsoDate; due: IsoDate; items?: string[] };
  'round.updated': { roundId: Id; title?: string; kind?: RoundKind; start?: IsoDate; due?: IsoDate; items?: string[] };
  /** Makes a planned round the current one (the previous current round, if not delivered, goes back to planned). */
  'round.started': { roundId: Id };
  /** Freezes the round's delivery. `account` defaults to the live status of the round's shared external needs. */
  'round.delivered': { roundId: Id; date: IsoDate; items?: string[]; account?: DeliveryAccount[] };

  'need.created': {
    needId: Id;
    projectId: Id;
    kind: NeedKind;
    title: string;
    roundId: Id | null;
    status?: NeedStatus;
    parentId?: Id | null;
    fromRoundId?: Id | null;
    ownerId?: Id | null;
    requester?: Requester | null;
    accept?: string | null;
    expect?: string | null;
    verify?: string | null;
    verdict?: string | null;
    source: NeedSource;
    private?: boolean;
  };
  /** A revision bumps the context version (1 + number of revisions). */
  'need.revised': { needId: Id; revisionId: Id; text: string; why: string; date: IsoDate };
  'need.updated': { needId: Id; title?: string; roundId?: Id | null; ownerId?: Id | null; parentId?: Id | null; fromRoundId?: Id | null };
  'need.status_set': { needId: Id; status: NeedStatus; verdict?: string | null };
  /** Private -> project. The service fills `snapshot` from its own state; others create the need from it. */
  'need.shared': { needId: Id; snapshot?: { need: Need; work: WorkItem[] } };

  'work.recorded': {
    workId: Id;
    projectId: Id;
    needId?: Id | null;
    alsoNeedId?: Id | null;
    src: SourceKind;
    text: string;
    why?: string | null;
    effect?: WorkEffect | null;
    result?: 'keep' | 'revert' | null;
    date: IsoDate;
    capture?: boolean;
    private?: boolean;
    /** Set by the service only (MCP reports); a client command carrying it is rejected. */
    via?: AgentVia | null;
    /** The need link came from the rule's code/keyword match, not a person. Requires needId. */
    autoLinked?: boolean;
  };
  /** A person links (or corrects the link of) an unlinked or rule-linked work item. */
  'work.linked': { workId: Id; needId: Id; effect?: WorkEffect | null };
  /** A person decides an unlinked work item is not worth linking; final. */
  'work.ignored': { workId: Id };

  'input.imported': {
    inputId: Id;
    projectId: Id;
    kind: InputKind;
    title: string;
    from?: Requester | null;
    date: IsoDate;
    blobHash?: string | null;
    body: { id: Id; text: string }[];
    extracts: ExtractInput[];
    detector: string;
    private?: boolean;
    /** Detected from the text on import (`detectScene`). */
    scene?: Scene;
  };
  'input.shared': { inputId: Id; snapshot?: { input: Input } };
  /** The input's scene, changed by hand. */
  'input.scene_set': { inputId: Id; scene: Scene };
  /** Accepting a new/hyp extract creates the need `needId`; a revision revises its target. */
  'extract.accepted': { inputId: Id; extractId: Id; needId?: Id; roundId?: Id | null };
  'extract.ignored': { inputId: Id; extractId: Id };

  'conflict.resolved':
    | { conflictId: Id; resolution: 'revise' }
    | { conflictId: Id; resolution: 'park'; needId: Id; roundId: Id | null }
    | { conflictId: Id; resolution: 'handoff'; handoffId: Id; toId: Id; ask: string; due: IsoDate | null };

  'handoff.created': { handoffId: Id; projectId: Id; needId: Id; toId: Id; ask: string; due: IsoDate | null };
  'handoff.responded': { handoffId: Id; response: 'accepted' | 'asked' | 'declined'; note?: string | null };
  'handoff.started': { handoffId: Id };
  'handoff.returned': { handoffId: Id; note?: string | null };
  /** Only the person who handed it off confirms done. */
  'handoff.confirmed': { handoffId: Id };
  'handoff.reopened': { handoffId: Id; note: string };
  'handoff.refresh_requested': { handoffId: Id };
  /** Service-only: the recipient's agent fetched the need context over MCP. */
  'handoff.context_fetched': { handoffId: Id; version: number; client: string | null };

  /** Service-only (MCP propose_need): goes to "To confirm". */
  'proposal.created': {
    proposalId: Id;
    projectId: Id;
    kind: NeedKind;
    title: string;
    accept?: string | null;
    expect?: string | null;
    verify?: string | null;
    why?: string | null;
    parentId?: Id | null;
    via: AgentVia | null;
  };
  'proposal.accepted': { proposalId: Id; needId: Id; roundId: Id | null };
  'proposal.rejected': { proposalId: Id };

  'artifact.created': { artifactId: Id; projectId: Id; kind: ArtifactKind; title: string; where: string; url?: string | null; needIds: Id[]; private?: boolean };
  'artifact.version_added': {
    artifactId: Id;
    versionId: Id;
    label: string;
    date: IsoDate;
    roundId?: Id | null;
    note: string;
    blobHash?: string | null;
    mediaType?: string | null;
    url?: string | null;
  };
  'artifact.linked': { artifactId: Id; needIds: Id[] };
  /** Private -> project. The service fills `snapshot` from its own state; others create the artifact from it. */
  'artifact.shared': { artifactId: Id; snapshot?: { artifact: Artifact } };
  /** Service-only (office preview worker). */
  'artifactVersion.derived': {
    artifactId: Id;
    versionId: Id;
    status: 'ready' | 'partial' | 'failed';
    pageHashes: string[];
    texts: string[];
    error: string | null;
    converter: string | null;
  };

  /** One user's card set for a scope ('home' or a project id). Always private to the actor. */
  'dashboard.set': { scope: Id; cards: CardId[]; refreshed?: Record<string, IsoTime> };

  /** A question to the project agent and its reply, for a scope ('home' or a project id). Always private to the actor (design §8.8). */
  'chat.asked': { messageId: Id; scope: Id; text: string; reply: AgentReply };
  /** Hides earlier messages in the actor's thread for this scope (kept, not deleted). */
  'chat.cleared': { scope: Id };
}

export type EventType = keyof EventPayloads;

export interface EventEnvelope<T extends EventType = EventType> {
  /** Server-assigned, strictly increasing; the cross-client replay order. */
  seq: Seq;
  /** Client-generated id; duplicates are ignored (idempotent retry). */
  id: Id;
  type: T;
  actorId: Id;
  /** Server accept time. */
  recordedAt: IsoTime;
  /** Business time (when it actually happened). Explanatory only. */
  occurredAt?: IsoTime;
  payload: EventPayloads[T];
}

export type DomainEvent = { [K in EventType]: EventEnvelope<K> }[EventType];

/** Event types only the service (or its workers / MCP endpoints) may append. */
export const SERVICE_ONLY_EVENTS: ReadonlySet<EventType> = new Set<EventType>([
  'user.registered',
  'handoff.context_fetched',
  'proposal.created',
  'artifactVersion.derived',
]);

export function isSystemActor(actorId: Id): boolean {
  return actorId === 'system' || actorId.startsWith('system:');
}
