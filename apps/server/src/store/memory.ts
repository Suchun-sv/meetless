import type { Id, IsoTime, Seq } from '@meetless/core';
import type {
  AccountStore,
  AgentCallRow,
  AppendContext,
  AppendOutcome,
  BlobMeta,
  CcProjectRow,
  CcSessionRow,
  BlobMetaStore,
  DerivationRow,
  DerivationStore,
  EventStore,
  InviteRow,
  StoredEvent,
  TokenRow,
} from './types';

/** Newest-first by an ISO timestamp field; ties break by insertion order (latest insert first). */
function byNewest<T>(rows: T[], at: (r: T) => IsoTime): T[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (at(a.r) === at(b.r) ? b.i - a.i : at(a.r) < at(b.r) ? 1 : -1))
    .map(({ r }) => r);
}

/**
 * In-memory EventStore. TEST DOUBLE ONLY: it has the same append semantics as
 * the Postgres store (lock, dedupe, gap-free seq, rollback on throw) but keeps
 * nothing across restarts. The running service uses PgEventStore.
 */
export class MemoryEventStore implements EventStore {
  readonly kind = 'memory' as const;
  private streams = new Map<string, { events: StoredEvent[]; byId: Map<Id, StoredEvent>; lastRecordedAt: number }>();
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private readonly clock: () => number = Date.now) {}

  private stream(id: string) {
    let s = this.streams.get(id);
    if (!s) {
      s = { events: [], byId: new Map(), lastRecordedAt: 0 };
      this.streams.set(id, s);
    }
    return s;
  }

  append(streamId: string, eventId: Id, knownSeq: Seq, decide: (ctx: AppendContext) => StoredEvent): Promise<AppendOutcome> {
    const run = async (): Promise<AppendOutcome> => {
      const s = this.stream(streamId);
      const dup = s.byId.get(eventId);
      if (dup) return { status: 'duplicate', stored: dup };
      const seq = s.events.length + 1;
      const t = Math.max(this.clock(), s.lastRecordedAt);
      const stored = decide({ seq, recordedAt: new Date(t).toISOString(), missed: s.events.filter((e) => e.event.seq > knownSeq) });
      if (stored.event.seq !== seq || stored.event.id !== eventId) throw new Error('decide returned a mismatched envelope');
      const copy = structuredClone(stored);
      s.events.push(copy);
      s.byId.set(eventId, copy);
      s.lastRecordedAt = t;
      return { status: 'appended', stored: structuredClone(copy) };
    };
    const p = this.lock.then(run, run);
    this.lock = p.catch(() => undefined);
    return p;
  }

  async readAfter(streamId: string, afterSeq: Seq, limit = Number.MAX_SAFE_INTEGER): Promise<StoredEvent[]> {
    return structuredClone(this.stream(streamId).events.filter((e) => e.event.seq > afterSeq).slice(0, limit));
  }

  async head(streamId: string): Promise<Seq> {
    return this.stream(streamId).events.length;
  }

  async close(): Promise<void> {}
}

/** In-memory blob metadata. TEST DOUBLE ONLY. */
export class MemoryBlobMetaStore implements BlobMetaStore {
  private blobs = new Map<string, BlobMeta>();
  private uploads = new Set<string>();

  async put(meta: BlobMeta, userId: Id) {
    const created = !this.blobs.has(meta.hash);
    if (created) this.blobs.set(meta.hash, { ...meta });
    this.uploads.add(`${meta.hash}\u0000${userId}`);
    return { created };
  }
  async get(hash: string) {
    const b = this.blobs.get(hash);
    return b ? { ...b } : null;
  }
  async uploadedBy(hash: string, userId: Id) {
    return this.uploads.has(`${hash}\u0000${userId}`);
  }
  async close() {}
}

/** In-memory derivation cache. TEST DOUBLE ONLY. */
export class MemoryDerivationStore implements DerivationStore {
  private rows = new Map<string, DerivationRow>();
  async get(sourceHash: string, kind: string, converter: string) {
    const r = this.rows.get(`${sourceHash}|${kind}|${converter}`);
    return r ? { ...r } : null;
  }
  async put(row: DerivationRow) {
    this.rows.set(`${row.sourceHash}|${row.kind}|${row.converter}`, { ...row });
  }
}

/**
 * In-memory accounts (invites, tokens, agent call log). TEST DOUBLE ONLY: same
 * semantics as PgAccountStore (claimInvite atomic, revokeToken owner-only) but
 * keeps nothing across restarts. None of its methods await before mutating
 * state, so a `Promise.all` of calls on the same id resolves them in call order
 * with no further locking needed (Node runs each call's body to completion,
 * or to its first await, before starting the next).
 */
export class MemoryAccountStore implements AccountStore {
  private invites = new Map<Id, InviteRow>();
  private invitesByHash = new Map<string, Id>();
  private tokens = new Map<Id, TokenRow>();
  private tokensByHash = new Map<string, Id>();
  private calls: AgentCallRow[] = [];
  private cc = new Map<Id, CcProjectRow>();
  private ccSess: CcSessionRow[] = [];

  async ccProject(projectId: Id): Promise<CcProjectRow | null> {
    const r = this.cc.get(projectId);
    return r ? { ...r } : null;
  }

  async putCcProject(r: CcProjectRow): Promise<void> {
    this.cc.set(r.projectId, { ...r });
  }

  async ccSessions(projectId: Id): Promise<CcSessionRow[]> {
    return byNewest(
      this.ccSess.filter((s) => s.projectId === projectId),
      (s) => s.createdAt,
    ).map((s) => ({ ...s }));
  }

  async putCcSession(r: CcSessionRow): Promise<void> {
    this.ccSess = [...this.ccSess.filter((s) => !(s.projectId === r.projectId && s.sessionId === r.sessionId)), { ...r }];
  }

  async createInvite(r: InviteRow): Promise<void> {
    this.invites.set(r.id, { ...r });
    this.invitesByHash.set(r.codeHash, r.id);
  }

  async inviteByHash(h: string): Promise<InviteRow | null> {
    const id = this.invitesByHash.get(h);
    const r = id ? this.invites.get(id) : undefined;
    return r ? { ...r } : null;
  }

  async invite(id: Id): Promise<InviteRow | null> {
    const r = this.invites.get(id);
    return r ? { ...r } : null;
  }

  async listInvites(projectId: Id): Promise<InviteRow[]> {
    const rows = [...this.invites.values()].filter((r) => r.projectId === projectId && !r.admin);
    return byNewest(rows, (r) => r.createdAt).map((r) => ({ ...r }));
  }

  async claimInvite(id: Id, userId: Id, at: IsoTime): Promise<'claimed' | 'used' | 'revoked'> {
    const r = this.invites.get(id);
    if (!r) throw new Error(`invite ${id} not found`);
    if (r.revokedAt) return 'revoked';
    if (r.usedBy) return 'used';
    r.usedBy = userId;
    r.usedAt = at;
    return 'claimed';
  }

  async releaseInvite(id: Id): Promise<void> {
    const r = this.invites.get(id);
    if (!r) return;
    r.usedBy = null;
    r.usedAt = null;
  }

  async revokeInvite(id: Id, at: IsoTime): Promise<boolean> {
    const r = this.invites.get(id);
    if (!r || r.revokedAt) return false;
    r.revokedAt = at;
    return true;
  }

  async pendingAdminInvite(): Promise<InviteRow | null> {
    const r = [...this.invites.values()].find((x) => x.admin && !x.usedBy && !x.revokedAt);
    return r ? { ...r } : null;
  }

  async hasAnyAccount(): Promise<boolean> {
    return [...this.tokens.values()].some((t) => t.kind === 'personal');
  }

  async createToken(r: TokenRow): Promise<void> {
    this.tokens.set(r.id, { ...r });
    this.tokensByHash.set(r.tokenHash, r.id);
  }

  async tokenByHash(h: string): Promise<TokenRow | null> {
    const id = this.tokensByHash.get(h);
    const r = id ? this.tokens.get(id) : undefined;
    return r ? { ...r } : null;
  }

  async listTokens(userId: Id, kind: 'personal' | 'agent'): Promise<TokenRow[]> {
    const rows = [...this.tokens.values()].filter((t) => t.userId === userId && t.kind === kind);
    return byNewest(rows, (t) => t.createdAt).map((t) => ({ ...t }));
  }

  async revokeToken(id: Id, userId: Id, at: IsoTime): Promise<boolean> {
    const t = this.tokens.get(id);
    if (!t || t.userId !== userId) return false;
    // Idempotent: a repeated revoke by the same owner still returns true, but never
    // moves revokedAt once it is set.
    if (!t.revokedAt) t.revokedAt = at;
    return true;
  }

  async touchToken(id: Id, at: IsoTime): Promise<void> {
    const t = this.tokens.get(id);
    if (t) t.lastUsedAt = at;
  }

  async recordCall(r: AgentCallRow): Promise<void> {
    this.calls.push({ ...r });
  }

  async listCalls(userId: Id, limit: number): Promise<AgentCallRow[]> {
    const rows = this.calls.filter((c) => c.userId === userId);
    return byNewest(rows, (c) => c.at)
      .slice(0, limit)
      .map((c) => ({ ...c }));
  }

  async close(): Promise<void> {}
}
