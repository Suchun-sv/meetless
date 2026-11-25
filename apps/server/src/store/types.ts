import type { DomainEvent, Id, IsoTime, Seq } from '@meetless/core';
import type { AgentCall } from '@meetless/api';

/**
 * An accepted event plus its read scope (core `eventScope`, computed on the
 * state after the event). Every read path filters by both fields.
 */
export interface StoredEvent {
  event: DomainEvent;
  /** Project the event belongs to; null for team-level events. Readers must be members. */
  projectId: Id | null;
  /** Only this user may receive the event (private items, personal dashboards and chats); null = no restriction. */
  privateTo: Id | null;
}

export interface AppendContext {
  /** Seq the new event will get: last_seq + 1 (gap-free, assigned under the stream lock). */
  seq: Seq;
  /** Server accept time; never earlier than the previous event's recordedAt. */
  recordedAt: IsoTime;
  /** Events committed after `knownSeq` that the caller's projection has not seen yet (multi-writer catch-up). */
  missed: StoredEvent[];
}

export type AppendOutcome =
  | { status: 'appended'; stored: StoredEvent }
  /** An event with this id is already in the log: nothing was written (idempotent retry). */
  | { status: 'duplicate'; stored: StoredEvent };

/**
 * Append-only, totally ordered event log, one sequence per stream.
 *
 * `append` runs in ONE transaction while holding the stream lock:
 *   1. if `eventId` already exists -> `duplicate`, nothing written;
 *   2. read events after `knownSeq` (catch-up) and compute the next seq / recordedAt;
 *   3. call `decide(ctx)`, which validates (core `applyEvent`) and returns the record to insert,
 *      or throws -> transaction rolled back, nothing written, error propagated;
 *   4. insert, bump the stream head, commit.
 * Only after commit does the promise resolve, so callers may publish the event.
 */
export interface EventStore {
  readonly kind: 'postgres' | 'memory';
  append(
    streamId: string,
    eventId: Id,
    knownSeq: Seq,
    decide: (ctx: AppendContext) => StoredEvent,
  ): Promise<AppendOutcome>;
  /** Events with seq > afterSeq, ascending. */
  readAfter(streamId: string, afterSeq: Seq, limit?: number): Promise<StoredEvent[]>;
  head(streamId: string): Promise<Seq>;
  close(): Promise<void>;
}

export interface BlobMeta {
  hash: string;
  size: number;
  mediaType: string;
}

/** Metadata for the content-addressed blob store (bytes live on disk, see blobs.ts). */
export interface BlobMetaStore {
  /** Records the blob (no-op if present) and that `userId` uploaded it. Returns whether the blob was new. */
  put(meta: BlobMeta, userId: Id): Promise<{ created: boolean }>;
  get(hash: string): Promise<BlobMeta | null>;
  uploadedBy(hash: string, userId: Id): Promise<boolean>;
  close(): Promise<void>;
}

/** One conversion result, keyed by the source content hash + kind + converter version. */
export interface DerivationRow {
  sourceHash: string;
  kind: string;
  converter: string;
  status: 'ready' | 'partial' | 'failed';
  manifestHash: string | null;
  error: string | null;
}

/** Cache of derived artifacts (office previews). The artifacts themselves are content-addressed blobs. */
export interface DerivationStore {
  get(sourceHash: string, kind: string, converter: string): Promise<DerivationRow | null>;
  put(row: DerivationRow): Promise<void>;
}

/** An invite code: how an account is created (admin bootstrap or project invite). */
export interface InviteRow {
  id: Id;
  /** `hashSecret` of the plaintext code; the plaintext itself is never stored. */
  codeHash: string;
  projectId: Id | null;
  roleId: Id | null;
  /** The one-time admin bootstrap invite, created on first start; not listed by `listInvites`. */
  admin: boolean;
  createdBy: Id | null;
  createdAt: IsoTime;
  usedBy: Id | null;
  usedAt: IsoTime | null;
  revokedAt: IsoTime | null;
}

/** A bearer token: a user's personal token, or an agent's. */
export interface TokenRow {
  id: Id;
  kind: 'personal' | 'agent';
  userId: Id;
  label: string;
  /** `hashSecret` of the plaintext token; the plaintext itself is never stored. */
  tokenHash: string;
  createdAt: IsoTime;
  lastUsedAt: IsoTime | null;
  revokedAt: IsoTime | null;
}

/** One MCP call, logged for the agent activity view. */
export type AgentCallRow = AgentCall & { userId: Id };

/** Invites, tokens and the agent call log: everything that creates or checks an account's identity. */
export interface AccountStore {
  createInvite(r: InviteRow): Promise<void>;
  inviteByHash(h: string): Promise<InviteRow | null>;
  invite(id: Id): Promise<InviteRow | null>;
  /** Newest first; excludes the admin invite. */
  listInvites(projectId: Id): Promise<InviteRow[]>;
  /**
   * Atomically marks the invite used by `userId`, unless it is already used
   * or revoked. `'claimed'` only for the caller that wins the race.
   */
  claimInvite(id: Id, userId: Id, at: IsoTime): Promise<'claimed' | 'used' | 'revoked'>;
  /** Clears `usedBy`/`usedAt` so the invite can be claimed again (a failed registration). */
  releaseInvite(id: Id): Promise<void>;
  /** True if the invite was pending and is now revoked; false if already revoked or missing. */
  revokeInvite(id: Id, at: IsoTime): Promise<boolean>;
  /** The unused, unrevoked admin invite, or null once it has been claimed. */
  pendingAdminInvite(): Promise<InviteRow | null>;
  /** True once any personal token row exists (the server has at least one account). */
  hasAnyAccount(): Promise<boolean>;
  createToken(r: TokenRow): Promise<void>;
  tokenByHash(h: string): Promise<TokenRow | null>;
  /** Newest first. */
  listTokens(userId: Id, kind: 'personal' | 'agent'): Promise<TokenRow[]>;
  /** True only when `id` exists and belongs to `userId`. */
  revokeToken(id: Id, userId: Id, at: IsoTime): Promise<boolean>;
  touchToken(id: Id, at: IsoTime): Promise<void>;
  recordCall(r: AgentCallRow): Promise<void>;
  /** Newest first, capped at `limit`. */
  listCalls(userId: Id, limit: number): Promise<AgentCallRow[]>;
  close(): Promise<void>;
}
