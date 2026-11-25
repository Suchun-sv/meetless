import {
  applyEvent,
  DomainError,
  emptyState,
  EVENT_TYPES,
  eventScope,
  isSystemActor,
  readableProjectIds,
  SERVICE_ONLY_EVENTS,
  viewFor,
  type DomainEvent,
  type EventPayloads,
  type EventScope,
  type EventType,
  type Id,
  type Seq,
  type State,
} from '@meetless/core';
import { BLOB_HASH, BlobFiles, sha256 } from './blobs';
import type { DevUser } from './auth';
import { MemoryDerivationStore } from './store/memory';
import type { BlobMetaStore, DerivationStore, EventStore, StoredEvent } from './store/types';

export const TEAM_STREAM = 'team';

/** Wire shape of a client command. The server adds seq, actorId and recordedAt. */
export interface Command {
  id: Id;
  type: EventType;
  payload: unknown;
  occurredAt?: string;
}

export interface CommandResult {
  status: 'accepted' | 'duplicate';
  event: DomainEvent;
}

export interface EventPage {
  events: DomainEvent[];
  /** Global seq up to which the log was scanned for this user (resume point; filtered events leave gaps). */
  cursor: Seq;
  head: Seq;
  /** Id of event #1. A client holding a cache from a different log must discard it. */
  epoch: Id | null;
  /** The client's cursor or epoch does not match this log: discard the cache and start from 0. */
  reset: boolean;
}

/** A blob upload whose address is malformed or does not match its bytes (HTTP 422). */
export class BlobHashError extends Error {
  readonly code = 'INVALID_CONTENT_HASH';
  readonly statusCode = 422;
}

/** What every refusal of `open()` ends with: the log is from another version and the schema needs a reset. */
const RESET_HINT = 'this schema predates this version, reset it';

/** The error `open()` throws for a log written by another version (e.g. the old PR model). */
export function unknownEventTypeError(seq: Seq, type: string, where = ''): Error {
  return new Error(`event ${seq} has type ${type}, unknown to this version${where}; ${RESET_HINT}`);
}

/** The error `open()` throws when a stored event's read scope is not what the current scope rules give. */
export function scopeMismatchError(seq: Seq, type: string, stored: EventScope, computed: EventScope): Error {
  const fmt = (x: EventScope) => `project=${x.projectId ?? 'null'} privateTo=${x.privateTo ?? 'null'}`;
  return new Error(`event ${seq} (${type}): stored scope ${fmt(stored)} differs from the computed scope ${fmt(computed)}; this schema predates privacy scopes, reset it`);
}

const KNOWN_TYPES: ReadonlySet<string> = new Set(EVENT_TYPES);
/** Commands whose payload names a blob the actor attaches (sharing snapshots are service-filled and not checked). */
const BLOB_REFERENCES: ReadonlySet<EventType> = new Set<EventType>(['input.imported', 'artifact.version_added']);
const UUID_LIKE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/;
const own = (rec: object, id: unknown): boolean => typeof id === 'string' && Object.prototype.hasOwnProperty.call(rec, id);

/**
 * Sharing events carry a snapshot of the item for members who never saw it.
 * The service builds it from its own full state and replaces whatever the
 * client sent, so a snapshot holds exactly the item being shared (for a need,
 * plus the private work on it that becomes shared with it) and nothing else.
 * Only the owner of a private item gets a snapshot; for anyone else the core
 * rejects the share, so the stripped payload is what it sees.
 */
// Runs on every append path (submit, appendTrusted, appendSystem); a system actor never owns a private item, so it never gets a snapshot.
function fillSnapshot(s: State, actorId: Id, type: EventType, payload: unknown): unknown {
  switch (type) {
    case 'need.shared': {
      const { snapshot: _client, ...rest } = payload as EventPayloads['need.shared'];
      const need = own(s.needs, rest.needId) ? s.needs[rest.needId]! : null;
      if (!need || need.privateTo !== actorId) return rest;
      // The same work the core makes shared with the need (reducer 'need.shared').
      const work = Object.values(s.work).filter((w) => w.needId === need.id && w.privateTo === actorId);
      return { ...rest, snapshot: structuredClone({ need, work }) };
    }
    case 'input.shared': {
      const { snapshot: _client, ...rest } = payload as EventPayloads['input.shared'];
      const input = own(s.inputs, rest.inputId) ? s.inputs[rest.inputId]! : null;
      if (!input || input.privateTo !== actorId) return rest;
      return { ...rest, snapshot: structuredClone({ input }) };
    }
    case 'artifact.shared': {
      const { snapshot: _client, ...rest } = payload as EventPayloads['artifact.shared'];
      const artifact = own(s.artifacts, rest.artifactId) ? s.artifacts[rest.artifactId]! : null;
      if (!artifact || artifact.privateTo !== actorId) return rest;
      return { ...rest, snapshot: structuredClone({ artifact }) };
    }
    default:
      return payload;
  }
}

/**
 * The sync service core: owns the in-memory projection of the accepted log,
 * validates every command through @meetless/core against it, appends through
 * the EventStore (transactional, idempotent on event id) together with the
 * event's scope, and filters every read by membership and privacy.
 */
export class SyncService {
  private state: State = emptyState();
  private log: StoredEvent[] = [];
  private listeners = new Set<(e: StoredEvent) => void>();
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    readonly store: EventStore,
    readonly blobMeta: BlobMetaStore,
    readonly blobFiles: BlobFiles,
    private readonly stream: string,
    readonly derivations: DerivationStore,
  ) {}

  /**
   * Loads the log and registers missing dev users. A log holding an event type
   * this version does not know (e.g. the old PR model) is refused before
   * anything is replayed, served or written. While replaying, each stored
   * read scope (projectId, privateTo) is checked against core `eventScope` on
   * the state after the event; a mismatch (a scope rule fixed since, or a row
   * from before scopes were stored) is refused the same way, before anything
   * is served or written.
   */
  static async open(opts: {
    store: EventStore;
    blobMeta: BlobMetaStore;
    blobFiles: BlobFiles;
    devUsers?: DevUser[];
    derivations?: DerivationStore;
    stream?: string;
  }): Promise<SyncService> {
    const svc = new SyncService(opts.store, opts.blobMeta, opts.blobFiles, opts.stream ?? TEAM_STREAM, opts.derivations ?? new MemoryDerivationStore());
    const stored = await opts.store.readAfter(svc.stream, 0);
    const unknown = stored.find((se) => !KNOWN_TYPES.has(se.event.type));
    if (unknown) throw unknownEventTypeError(unknown.event.seq, unknown.event.type);
    for (const se of stored) {
      let applied: boolean;
      try {
        applied = svc.ingest(se);
      } catch (e) {
        throw new Error(`event ${se.event.seq} (${se.event.type}) does not replay on this version: ${(e as Error).message}; ${RESET_HINT}`, { cause: e });
      }
      if (!applied) continue;
      const scope = eventScope(svc.state, se.event);
      if (scope.projectId !== se.projectId || scope.privateTo !== se.privateTo) {
        throw scopeMismatchError(se.event.seq, se.event.type, { projectId: se.projectId, privateTo: se.privateTo }, scope);
      }
    }
    for (const u of opts.devUsers ?? []) {
      if (!svc.state.users[u.id]) {
        await svc.appendAs('system', {
          id: `register:${u.id}`,
          type: 'user.registered',
          payload: { userId: u.id, displayName: u.displayName, locale: u.locale },
        });
      }
    }
    return svc;
  }

  /** Client command (HTTP), authenticated as `actorId`. Service-only types and work reported `via` an agent are refused. */
  async submit(actorId: Id, cmd: Command): Promise<CommandResult> {
    if (!cmd || typeof cmd !== 'object') throw new DomainError('INVALID_EVENT', 'command body missing');
    this.requireKnownType(cmd);
    if (isSystemActor(actorId)) throw new DomainError('NOT_AUTHORISED', `${actorId} is a service actor`);
    if (SERVICE_ONLY_EVENTS.has(cmd.type)) throw new DomainError('NOT_AUTHORISED', `${cmd.type} is appended by the service only`);
    if (cmd.type === 'work.recorded' && cmd.payload && typeof cmd.payload === 'object' && (cmd.payload as { via?: unknown }).via != null) {
      throw new DomainError('NOT_AUTHORISED', 'work reported via an agent is recorded by the service only');
    }
    return this.appendAs(actorId, cmd, { checkBlobs: true });
  }

  /**
   * In-process callers only (block S's endpoints, the sample loader); never
   * reachable over HTTP. Any event type, any actor; the core still validates
   * and sharing snapshots are filled the same way.
   */
  async appendTrusted(actorId: Id, cmd: Command): Promise<CommandResult> {
    this.requireKnownType(cmd);
    return this.appendAs(actorId, cmd, { checkBlobs: true });
  }

  /** Server workers (office conversion) append as a system actor; may use service-only types. No blob-reference check: workers reference only bytes they stored. */
  async appendSystem(actorId: Id, cmd: Command): Promise<CommandResult> {
    if (!isSystemActor(actorId)) throw new DomainError('NOT_AUTHORISED', `${actorId} is not a service actor`);
    this.requireKnownType(cmd);
    return this.appendAs(actorId, cmd);
  }

  private requireKnownType(cmd: Command): void {
    if (typeof cmd?.type !== 'string' || !KNOWN_TYPES.has(cmd.type)) {
      throw new DomainError('UNKNOWN_EVENT_TYPE', `unknown event type ${String(cmd?.type)}`);
    }
  }

  /** Accepted envelope with this seq (seq is gap-free 1..head). */
  eventAt(seq: Seq): DomainEvent | null {
    return this.log[seq - 1]?.event ?? null;
  }

  get head(): Seq {
    return this.state.lastSeq;
  }

  get epoch(): Id | null {
    return this.log[0]?.event.id ?? null;
  }

  /** The full projection, private items included. In-process only; anything shown to a user goes through `view`. */
  get current(): State {
    return this.state;
  }

  /** What `userId` may see (core `viewFor`): their projects, minus other people's private items. */
  view(userId: Id): State {
    return viewFor(this.state, userId);
  }

  onAppended(cb: (e: StoredEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Applies a stored event; false if its seq was already applied. */
  private ingest(se: StoredEvent): boolean {
    if (se.event.seq <= this.state.lastSeq) return false;
    this.state = applyEvent(this.state, se.event);
    this.log.push(se);
    return true;
  }

  private appendAs(actorId: Id, cmd: Command, opts: { checkBlobs?: boolean } = {}): Promise<CommandResult> {
    const run = () => this.appendNow(actorId, cmd, opts.checkBlobs === true);
    // One append at a time per process; the store additionally locks the stream for multi-process safety.
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private async appendNow(actorId: Id, cmd: Command, checkBlobs: boolean): Promise<CommandResult> {
    if (typeof cmd.id !== 'string' || !UUID_LIKE.test(cmd.id)) throw new DomainError('INVALID_EVENT', 'command id must be a client-generated unique id');
    if (!cmd.payload || typeof cmd.payload !== 'object') throw new DomainError('INVALID_EVENT', 'payload must be an object');
    if (cmd.occurredAt !== undefined && (typeof cmd.occurredAt !== 'string' || Number.isNaN(Date.parse(cmd.occurredAt)))) {
      throw new DomainError('INVALID_EVENT', 'occurredAt must be ISO time');
    }
    const seen = Object.prototype.hasOwnProperty.call(this.state.seenEventIds, cmd.id) ? this.state.seenEventIds[cmd.id]! : null;
    if (seen !== null) return this.duplicate(this.log[seen - 1]!, actorId);
    if (checkBlobs) await this.requireBlobReference(actorId, cmd);

    let next: State | null = null;
    const outcome = await this.store.append(this.stream, cmd.id, this.state.lastSeq, (ctx) => {
      for (const m of ctx.missed) this.ingest(m);
      const envelope = {
        seq: ctx.seq,
        id: cmd.id,
        type: cmd.type,
        actorId,
        recordedAt: ctx.recordedAt,
        ...(cmd.occurredAt !== undefined ? { occurredAt: cmd.occurredAt } : {}),
        // Built from the state the event applies to, after catching up with other writers.
        payload: fillSnapshot(this.state, actorId, cmd.type, cmd.payload),
      } as DomainEvent;
      // Throws DomainError -> the store rolls back; nothing is appended.
      const after = applyEvent(this.state, envelope);
      next = after;
      return { event: envelope, ...eventScope(after, envelope) };
    });
    if (outcome.status === 'duplicate') return this.duplicate(outcome.stored, actorId);
    this.state = next!;
    this.log.push(outcome.stored);
    for (const l of this.listeners) l(outcome.stored);
    return { status: 'accepted', event: outcome.stored.event };
  }

  /**
   * A command may attach only a blob its actor uploaded or can already read.
   * Otherwise knowing a hash would be enough to pull someone else's private
   * file into one's own input or artifact, and with it into one's view.
   */
  private async requireBlobReference(actorId: Id, cmd: Command): Promise<void> {
    if (!BLOB_REFERENCES.has(cmd.type)) return;
    const hash = (cmd.payload as { blobHash?: unknown }).blobHash;
    // A malformed hash is left to the core (INVALID_EVENT).
    if (typeof hash !== 'string' || !BLOB_HASH.test(hash)) return;
    if (!(await this.canReadBlob(actorId, hash))) {
      throw new DomainError('NOT_AUTHORISED', `${actorId} may not attach blob ${hash}`, { what: 'blob', id: hash });
    }
  }

  private duplicate(se: StoredEvent, actorId: Id): CommandResult {
    if (se.event.actorId !== actorId) throw new DomainError('ALREADY_EXISTS', `event id ${se.event.id} is taken`);
    return { status: 'duplicate', event: se.event };
  }

  // ------------------------------------------------------------ reads (membership and privacy)

  readable(userId: Id): Set<Id> {
    return readableProjectIds(this.state, userId);
  }

  /** Stable key of the user's readable project set; a change forces client resync (cache purge on revoke). */
  readableKey(userId: Id): string {
    return [...this.readable(userId)].sort().join(',');
  }

  /** Every read path keeps an event only for a member of its project and, if it is private, only for its owner. */
  private isVisible(se: StoredEvent, userId: Id, readable: Set<Id>): boolean {
    return (se.projectId === null || readable.has(se.projectId)) && (se.privateTo === null || se.privateTo === userId);
  }

  eventsFor(userId: Id, after: Seq, limit = 5000, epoch?: Id | null): EventPage {
    const head = this.head;
    const reset = after > head || after < 0 || (after > 0 && epoch !== undefined && epoch !== this.epoch);
    const from = reset ? 0 : after;
    const readable = this.readable(userId);
    // seq is gap-free 1..head, so the event with seq n sits at index n-1.
    const slice = this.log.slice(from, from + Math.max(1, limit));
    return {
      events: slice.filter((se) => this.isVisible(se, userId, readable)).map((se) => se.event),
      cursor: slice.length > 0 ? slice[slice.length - 1]!.event.seq : from,
      head,
      epoch: this.epoch,
      reset,
    };
  }

  requireMember(userId: Id, projectId: Id): void {
    if (!this.state.projects[projectId]) throw new DomainError('NOT_FOUND', `project ${projectId}`, { what: 'project', id: projectId });
    if (!this.readable(userId).has(projectId)) throw new DomainError('NOT_A_MEMBER', `${userId} is not a member of ${projectId}`);
  }

  // ------------------------------------------------------------ blobs

  async putBlob(userId: Id, hash: string, bytes: Uint8Array, mediaType: string): Promise<{ created: boolean; size: number }> {
    if (!BLOB_HASH.test(hash)) throw new BlobHashError('blob address must be sha256:<64 hex>');
    if (sha256(bytes) !== hash) throw new BlobHashError('uploaded bytes do not match the address');
    // Bytes first (atomic rename), then metadata: metadata never points at missing bytes.
    await this.blobFiles.write(hash, bytes);
    const { created } = await this.blobMeta.put({ hash, size: bytes.byteLength, mediaType }, userId);
    return { created, size: bytes.byteLength };
  }

  /**
   * A user may read a blob they uploaded, or one their view references: the
   * file of an input, or the file or a preview page of an artifact version.
   * Other people's private inputs and artifacts are not in the view.
   * Builds the view per call (linear in the state size); fine at team scale.
   */
  async canReadBlob(userId: Id, hash: string): Promise<boolean> {
    const v = this.view(userId);
    if (Object.values(v.inputs).some((i) => i.blobHash === hash)) return true;
    for (const a of Object.values(v.artifacts)) {
      if (a.versions.some((ver) => ver.blobHash === hash || (ver.derived?.pageHashes.includes(hash) ?? false))) return true;
    }
    return this.blobMeta.uploadedBy(hash, userId);
  }

  /** Stores bytes produced by a server worker (derived previews). */
  async putDerivedBlob(actorId: Id, bytes: Uint8Array, mediaType: string): Promise<string> {
    const hash = sha256(bytes);
    await this.putBlob(actorId, hash, bytes, mediaType);
    return hash;
  }
}
