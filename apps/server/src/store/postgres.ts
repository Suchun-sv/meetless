import pg from 'pg';
import type { DomainEvent, Id, IsoTime, Seq } from '@meetless/core';
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

/**
 * Schema migrations, applied in order inside a transaction guarded by an
 * advisory lock so concurrent service starts do not race.
 * Envelopes are stored as `json` (not jsonb) so the accepted bytes round-trip exactly.
 */
const MIGRATIONS: string[] = [
  `create table ml_streams (
     id text primary key,
     last_seq bigint not null default 0,
     last_recorded_at timestamptz
   );
   create table ml_events (
     stream_id text not null references ml_streams(id),
     seq bigint not null,
     id text not null,
     type text not null,
     actor_id text not null,
     project_id text,
     recorded_at timestamptz not null,
     envelope json not null,
     primary key (stream_id, seq),
     unique (stream_id, id)
   );
   create index ml_events_project on ml_events (stream_id, project_id, seq);
   create table ml_blobs (
     hash text primary key check (hash ~ '^sha256:[0-9a-f]{64}$'),
     size bigint not null,
     media_type text not null,
     created_at timestamptz not null default now()
   );
   create table ml_blob_uploads (
     hash text not null references ml_blobs(hash),
     user_id text not null,
     uploaded_at timestamptz not null default now(),
     primary key (hash, user_id)
   );`,
  // 2: derived artifacts (office previews), content-addressed by source hash + converter version.
  `create table ml_derivations (
     source_hash text not null,
     kind text not null,
     converter text not null,
     status text not null check (status in ('ready', 'partial', 'failed')),
     manifest_hash text,
     error text,
     created_at timestamptz not null default now(),
     primary key (source_hash, kind, converter)
   );`,
  // 3: privacy scope (core eventScope().privateTo): only this user may receive the event.
  `alter table ml_events add column private_to text;`,
  // 4: accounts (invite codes, personal/agent tokens, agent call log). Secrets are stored
  // hashed only (hashSecret in accounts/secrets.ts); the plaintext code/token never lands here.
  `create table ml_invites (
     id text primary key,
     code_hash text not null unique,
     project_id text,
     role_id text,
     admin boolean not null default false,
     created_by text,
     created_at timestamptz not null,
     used_by text,
     used_at timestamptz,
     revoked_at timestamptz
   );
   create table ml_tokens (
     id text primary key,
     kind text not null check (kind in ('personal', 'agent')),
     user_id text not null,
     label text not null,
     token_hash text not null unique,
     created_at timestamptz not null,
     last_used_at timestamptz,
     revoked_at timestamptz
   );
   create index ml_tokens_user_kind on ml_tokens (user_id, kind);
   create table ml_agent_calls (
     id text primary key,
     at timestamptz not null,
     token_id text not null,
     client text,
     tool text not null,
     project_id text,
     need_code text,
     ok boolean not null,
     code text,
     user_id text not null
   );
   create index ml_agent_calls_user_at on ml_agent_calls (user_id, at desc);`,
  // A project's Claude Code session: project-scoped agent tokens, the project folder, its sessions.
  `alter table ml_tokens add column project_id text;
   create table ml_cc_projects (
     project_id text primary key,
     folder text not null,
     repo_path text,
     token_id text,
     updated_at timestamptz not null
   );
   create table ml_cc_sessions (
     project_id text not null,
     session_id text not null,
     name text not null,
     transcript_path text not null,
     created_at timestamptz not null,
     primary key (project_id, session_id)
   );`,
];

const MIGRATION_LOCK = 7_211_001;

export async function migrate(pool: pg.Pool, schema: string): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('select pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    await c.query(`create schema if not exists ${ident(schema)}`);
    await c.query(`set local search_path to ${ident(schema)}`);
    await c.query('create table if not exists ml_schema_migrations (version int primary key, applied_at timestamptz not null default now())');
    const { rows } = await c.query<{ version: number }>('select version from ml_schema_migrations');
    const done = new Set(rows.map((r) => r.version));
    for (const [i, sql] of MIGRATIONS.entries()) {
      if (done.has(i + 1)) continue;
      await c.query(sql);
      await c.query('insert into ml_schema_migrations (version) values ($1)', [i + 1]);
    }
    await c.query('commit');
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`invalid schema name ${name}`);
  return `"${name}"`;
}

/**
 * Read-only check, run before `migrate`: the first event of `streamId` whose
 * type is not in `known`, or null (also when the schema has no log yet). Lets
 * the server refuse an old-model log without writing to it, migrations included.
 */
export async function firstUnknownEvent(
  connectionString: string,
  schema: string,
  streamId: string,
  known: readonly string[],
): Promise<{ seq: number; type: string } | null> {
  const t = ident(schema);
  const c = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  // A connection dropped mid-check rejects the pending query; without a listener it would crash the process.
  c.on('error', () => undefined);
  await c.connect();
  try {
    const exists = await c.query<{ r: string | null }>('select to_regclass($1) as r', [`${t}.ml_events`]);
    if (!exists.rows[0]?.r) return null;
    const r = await c.query<{ seq: string; type: string }>(
      `select seq, type from ${t}.ml_events where stream_id = $1 and type <> all($2::text[]) order by seq limit 1`,
      [streamId, [...known]],
    );
    return r.rows[0] ? { seq: Number(r.rows[0].seq), type: r.rows[0].type } : null;
  } finally {
    await c.end();
  }
}

export interface PgOptions {
  connectionString: string;
  /** Postgres schema holding the tables; tests use a throw-away schema per suite. */
  schema?: string;
  clock?: () => number;
}

export async function openPostgres(
  opts: PgOptions,
): Promise<{ events: PgEventStore; blobs: PgBlobMetaStore; derivations: PgDerivationStore; accounts: PgAccountStore; pool: pg.Pool }> {
  const schema = opts.schema ?? 'meetless';
  const pool = new pg.Pool({ connectionString: opts.connectionString, max: 8 });
  await migrate(pool, schema);
  // Every query below uses schema-qualified table names; no search_path dependency.
  const events = new PgEventStore(pool, schema, opts.clock ?? Date.now);
  const blobs = new PgBlobMetaStore(pool, schema);
  return { events, blobs, derivations: new PgDerivationStore(pool, schema), accounts: new PgAccountStore(pool, schema), pool };
}

type Row = { envelope: DomainEvent; project_id: string | null; private_to: string | null };
const toStored = (r: Row): StoredEvent => ({ event: r.envelope, projectId: r.project_id, privateTo: r.private_to });
const COLS = 'envelope, project_id, private_to';

export class PgEventStore implements EventStore {
  readonly kind = 'postgres' as const;
  private readonly t: string;

  constructor(
    private readonly pool: pg.Pool,
    schema: string,
    private readonly clock: () => number,
  ) {
    this.t = ident(schema);
  }

  async append(streamId: string, eventId: Id, knownSeq: Seq, decide: (ctx: AppendContext) => StoredEvent): Promise<AppendOutcome> {
    const c = await this.pool.connect();
    const t = this.t;
    try {
      await c.query('begin');
      await c.query(`insert into ${t}.ml_streams (id) values ($1) on conflict (id) do nothing`, [streamId]);
      const head = await c.query<{ last_seq: string; last_recorded_at: Date | null }>(
        `select last_seq, last_recorded_at from ${t}.ml_streams where id = $1 for update`,
        [streamId],
      );
      const dup = await c.query<Row>(`select ${COLS} from ${t}.ml_events where stream_id = $1 and id = $2`, [streamId, eventId]);
      if (dup.rows[0]) {
        await c.query('commit');
        return { status: 'duplicate', stored: toStored(dup.rows[0]) };
      }
      const missed = await c.query<Row>(
        `select ${COLS} from ${t}.ml_events where stream_id = $1 and seq > $2 order by seq`,
        [streamId, knownSeq],
      );
      const lastSeq = Number(head.rows[0]!.last_seq);
      const lastAt = head.rows[0]!.last_recorded_at?.getTime() ?? 0;
      const seq = lastSeq + 1;
      const at = Math.max(this.clock(), lastAt);
      const stored = decide({ seq, recordedAt: new Date(at).toISOString(), missed: missed.rows.map(toStored) });
      const e = stored.event;
      if (e.seq !== seq || e.id !== eventId) throw new Error('decide returned a mismatched envelope');
      await c.query(
        `insert into ${t}.ml_events (stream_id, seq, id, type, actor_id, project_id, private_to, recorded_at, envelope)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [streamId, seq, e.id, e.type, e.actorId, stored.projectId, stored.privateTo, e.recordedAt, JSON.stringify(e)],
      );
      await c.query(`update ${t}.ml_streams set last_seq = $2, last_recorded_at = $3 where id = $1`, [streamId, seq, e.recordedAt]);
      await c.query('commit');
      return { status: 'appended', stored };
    } catch (err) {
      await c.query('rollback').catch(() => undefined);
      // A concurrent writer inserted the same id between our check and insert: report it as a duplicate.
      if ((err as { code?: string }).code === '23505') {
        const dup = await this.pool.query<Row>(`select ${COLS} from ${t}.ml_events where stream_id = $1 and id = $2`, [streamId, eventId]);
        if (dup.rows[0]) return { status: 'duplicate', stored: toStored(dup.rows[0]) };
      }
      throw err;
    } finally {
      c.release();
    }
  }

  async readAfter(streamId: string, afterSeq: Seq, limit = 1_000_000): Promise<StoredEvent[]> {
    const r = await this.pool.query<Row>(
      `select ${COLS} from ${this.t}.ml_events where stream_id = $1 and seq > $2 order by seq limit $3`,
      [streamId, afterSeq, limit],
    );
    return r.rows.map(toStored);
  }

  async head(streamId: string): Promise<Seq> {
    const r = await this.pool.query<{ last_seq: string }>(`select last_seq from ${this.t}.ml_streams where id = $1`, [streamId]);
    return r.rows[0] ? Number(r.rows[0].last_seq) : 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class PgBlobMetaStore implements BlobMetaStore {
  private readonly t: string;
  constructor(
    private readonly pool: pg.Pool,
    schema: string,
  ) {
    this.t = ident(schema);
  }

  async put(meta: BlobMeta, userId: Id) {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const ins = await c.query(
        `insert into ${this.t}.ml_blobs (hash, size, media_type) values ($1, $2, $3) on conflict (hash) do nothing`,
        [meta.hash, meta.size, meta.mediaType],
      );
      await c.query(`insert into ${this.t}.ml_blob_uploads (hash, user_id) values ($1, $2) on conflict do nothing`, [meta.hash, userId]);
      await c.query('commit');
      return { created: (ins.rowCount ?? 0) > 0 };
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  async get(hash: string) {
    const r = await this.pool.query<{ hash: string; size: string; media_type: string }>(
      `select hash, size, media_type from ${this.t}.ml_blobs where hash = $1`,
      [hash],
    );
    const row = r.rows[0];
    return row ? { hash: row.hash, size: Number(row.size), mediaType: row.media_type } : null;
  }

  async uploadedBy(hash: string, userId: Id) {
    const r = await this.pool.query(`select 1 from ${this.t}.ml_blob_uploads where hash = $1 and user_id = $2`, [hash, userId]);
    return (r.rowCount ?? 0) > 0;
  }

  async close() {}
}

export class PgDerivationStore implements DerivationStore {
  private readonly t: string;
  constructor(
    private readonly pool: pg.Pool,
    schema: string,
  ) {
    this.t = ident(schema);
  }

  async get(sourceHash: string, kind: string, converter: string): Promise<DerivationRow | null> {
    const r = await this.pool.query<{ status: DerivationRow['status']; manifest_hash: string | null; error: string | null }>(
      `select status, manifest_hash, error from ${this.t}.ml_derivations where source_hash = $1 and kind = $2 and converter = $3`,
      [sourceHash, kind, converter],
    );
    const row = r.rows[0];
    return row ? { sourceHash, kind, converter, status: row.status, manifestHash: row.manifest_hash, error: row.error } : null;
  }

  async put(row: DerivationRow): Promise<void> {
    await this.pool.query(
      `insert into ${this.t}.ml_derivations (source_hash, kind, converter, status, manifest_hash, error) values ($1, $2, $3, $4, $5, $6)
       on conflict (source_hash, kind, converter) do update set status = excluded.status, manifest_hash = excluded.manifest_hash, error = excluded.error`,
      [row.sourceHash, row.kind, row.converter, row.status, row.manifestHash, row.error],
    );
  }
}

type InviteDbRow = {
  id: string;
  code_hash: string;
  project_id: string | null;
  role_id: string | null;
  admin: boolean;
  created_by: string | null;
  created_at: Date;
  used_by: string | null;
  used_at: Date | null;
  revoked_at: Date | null;
};
const INVITE_COLS = 'id, code_hash, project_id, role_id, admin, created_by, created_at, used_by, used_at, revoked_at';
const toInviteRow = (r: InviteDbRow): InviteRow => ({
  id: r.id,
  codeHash: r.code_hash,
  projectId: r.project_id,
  roleId: r.role_id,
  admin: r.admin,
  createdBy: r.created_by,
  createdAt: r.created_at.toISOString(),
  usedBy: r.used_by,
  usedAt: r.used_at ? r.used_at.toISOString() : null,
  revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
});

type TokenDbRow = {
  id: string;
  kind: TokenRow['kind'];
  user_id: string;
  label: string;
  token_hash: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
  project_id: string | null;
};
const TOKEN_COLS = 'id, kind, user_id, label, token_hash, created_at, last_used_at, revoked_at, project_id';
const toTokenRow = (r: TokenDbRow): TokenRow => ({
  id: r.id,
  kind: r.kind,
  userId: r.user_id,
  label: r.label,
  tokenHash: r.token_hash,
  createdAt: r.created_at.toISOString(),
  lastUsedAt: r.last_used_at ? r.last_used_at.toISOString() : null,
  revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
  projectId: r.project_id,
});

type AgentCallDbRow = {
  id: string;
  at: Date;
  token_id: string;
  client: string | null;
  tool: AgentCallRow['tool'];
  project_id: string | null;
  need_code: string | null;
  ok: boolean;
  code: string | null;
  user_id: string;
};
const CALL_COLS = 'id, at, token_id, client, tool, project_id, need_code, ok, code, user_id';
const toCallRow = (r: AgentCallDbRow): AgentCallRow => ({
  id: r.id,
  at: r.at.toISOString(),
  tokenId: r.token_id,
  client: r.client,
  tool: r.tool,
  projectId: r.project_id,
  needCode: r.need_code,
  ok: r.ok,
  code: r.code,
  userId: r.user_id,
});

/** Invites, tokens and the agent call log, against the real Postgres schema (migration 4). */
export class PgAccountStore implements AccountStore {
  private readonly t: string;
  constructor(
    private readonly pool: pg.Pool,
    schema: string,
  ) {
    this.t = ident(schema);
  }

  async createInvite(r: InviteRow): Promise<void> {
    await this.pool.query(
      `insert into ${this.t}.ml_invites (${INVITE_COLS}) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [r.id, r.codeHash, r.projectId, r.roleId, r.admin, r.createdBy, r.createdAt, r.usedBy, r.usedAt, r.revokedAt],
    );
  }

  async inviteByHash(h: string): Promise<InviteRow | null> {
    const r = await this.pool.query<InviteDbRow>(`select ${INVITE_COLS} from ${this.t}.ml_invites where code_hash = $1`, [h]);
    return r.rows[0] ? toInviteRow(r.rows[0]) : null;
  }

  async invite(id: Id): Promise<InviteRow | null> {
    const r = await this.pool.query<InviteDbRow>(`select ${INVITE_COLS} from ${this.t}.ml_invites where id = $1`, [id]);
    return r.rows[0] ? toInviteRow(r.rows[0]) : null;
  }

  async listInvites(projectId: Id): Promise<InviteRow[]> {
    const r = await this.pool.query<InviteDbRow>(
      `select ${INVITE_COLS} from ${this.t}.ml_invites where project_id = $1 and admin = false order by created_at desc`,
      [projectId],
    );
    return r.rows.map(toInviteRow);
  }

  async claimInvite(id: Id, userId: Id, at: IsoTime): Promise<'claimed' | 'used' | 'revoked'> {
    const upd = await this.pool.query<{ id: string }>(
      `update ${this.t}.ml_invites set used_by = $2, used_at = $3 where id = $1 and used_at is null and revoked_at is null returning id`,
      [id, userId, at],
    );
    if (upd.rows[0]) return 'claimed';
    const sel = await this.pool.query<{ revoked_at: Date | null }>(`select revoked_at from ${this.t}.ml_invites where id = $1`, [id]);
    if (!sel.rows[0]) throw new Error(`invite ${id} not found`);
    return sel.rows[0].revoked_at ? 'revoked' : 'used';
  }

  async releaseInvite(id: Id): Promise<void> {
    await this.pool.query(`update ${this.t}.ml_invites set used_by = null, used_at = null where id = $1`, [id]);
  }

  async revokeInvite(id: Id, at: IsoTime): Promise<boolean> {
    const r = await this.pool.query<{ id: string }>(
      `update ${this.t}.ml_invites set revoked_at = $2 where id = $1 and revoked_at is null returning id`,
      [id, at],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async pendingAdminInvite(): Promise<InviteRow | null> {
    const r = await this.pool.query<InviteDbRow>(
      `select ${INVITE_COLS} from ${this.t}.ml_invites where admin and used_by is null and revoked_at is null order by created_at asc limit 1`,
    );
    return r.rows[0] ? toInviteRow(r.rows[0]) : null;
  }

  async hasAnyAccount(): Promise<boolean> {
    const r = await this.pool.query(`select 1 from ${this.t}.ml_tokens where kind = 'personal' limit 1`);
    return (r.rowCount ?? 0) > 0;
  }

  async createToken(r: TokenRow): Promise<void> {
    await this.pool.query(
      `insert into ${this.t}.ml_tokens (${TOKEN_COLS}) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [r.id, r.kind, r.userId, r.label, r.tokenHash, r.createdAt, r.lastUsedAt, r.revokedAt, r.projectId ?? null],
    );
  }

  async tokenByHash(h: string): Promise<TokenRow | null> {
    const r = await this.pool.query<TokenDbRow>(`select ${TOKEN_COLS} from ${this.t}.ml_tokens where token_hash = $1`, [h]);
    return r.rows[0] ? toTokenRow(r.rows[0]) : null;
  }

  async listTokens(userId: Id, kind: 'personal' | 'agent'): Promise<TokenRow[]> {
    const r = await this.pool.query<TokenDbRow>(
      `select ${TOKEN_COLS} from ${this.t}.ml_tokens where user_id = $1 and kind = $2 order by created_at desc`,
      [userId, kind],
    );
    return r.rows.map(toTokenRow);
  }

  async revokeToken(id: Id, userId: Id, at: IsoTime): Promise<boolean> {
    // Idempotent: a repeated revoke by the same owner still returns true, but never
    // moves revokedAt once it is set (coalesce keeps the first revocation time).
    const r = await this.pool.query<{ id: string }>(
      `update ${this.t}.ml_tokens set revoked_at = coalesce(revoked_at, $3) where id = $1 and user_id = $2 returning id`,
      [id, userId, at],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async touchToken(id: Id, at: IsoTime): Promise<void> {
    await this.pool.query(`update ${this.t}.ml_tokens set last_used_at = $2 where id = $1`, [id, at]);
  }

  async ccProject(projectId: Id): Promise<CcProjectRow | null> {
    const r = await this.pool.query<{ project_id: string; folder: string; repo_path: string | null; token_id: string | null; updated_at: Date }>(
      `select project_id, folder, repo_path, token_id, updated_at from ${this.t}.ml_cc_projects where project_id = $1`,
      [projectId],
    );
    const x = r.rows[0];
    return x ? { projectId: x.project_id, folder: x.folder, repoPath: x.repo_path, tokenId: x.token_id, updatedAt: x.updated_at.toISOString() } : null;
  }

  async putCcProject(r: CcProjectRow): Promise<void> {
    await this.pool.query(
      `insert into ${this.t}.ml_cc_projects (project_id, folder, repo_path, token_id, updated_at) values ($1, $2, $3, $4, $5)
       on conflict (project_id) do update set folder = excluded.folder, repo_path = excluded.repo_path, token_id = excluded.token_id, updated_at = excluded.updated_at`,
      [r.projectId, r.folder, r.repoPath, r.tokenId, r.updatedAt],
    );
  }

  async ccSessions(projectId: Id): Promise<CcSessionRow[]> {
    const r = await this.pool.query<{ project_id: string; session_id: string; name: string; transcript_path: string; created_at: Date }>(
      `select project_id, session_id, name, transcript_path, created_at from ${this.t}.ml_cc_sessions where project_id = $1 order by created_at desc`,
      [projectId],
    );
    return r.rows.map((x) => ({ projectId: x.project_id, sessionId: x.session_id, name: x.name, transcriptPath: x.transcript_path, createdAt: x.created_at.toISOString() }));
  }

  async putCcSession(r: CcSessionRow): Promise<void> {
    await this.pool.query(
      `insert into ${this.t}.ml_cc_sessions (project_id, session_id, name, transcript_path, created_at) values ($1, $2, $3, $4, $5)
       on conflict (project_id, session_id) do update set name = excluded.name, transcript_path = excluded.transcript_path`,
      [r.projectId, r.sessionId, r.name, r.transcriptPath, r.createdAt],
    );
  }

  async recordCall(r: AgentCallRow): Promise<void> {
    await this.pool.query(
      `insert into ${this.t}.ml_agent_calls (${CALL_COLS}) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [r.id, r.at, r.tokenId, r.client, r.tool, r.projectId, r.needCode, r.ok, r.code, r.userId],
    );
  }

  async listCalls(userId: Id, limit: number): Promise<AgentCallRow[]> {
    const r = await this.pool.query<AgentCallDbRow>(
      `select ${CALL_COLS} from ${this.t}.ml_agent_calls where user_id = $1 order by at desc limit $2`,
      [userId, limit],
    );
    return r.rows.map(toCallRow);
  }

  async close(): Promise<void> {}
}
