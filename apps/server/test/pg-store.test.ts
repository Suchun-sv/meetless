import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DomainEvent } from '@meetless/core';
import { openPostgres, type StoredEvent } from '../src/index';
import { requirePostgres, serverConfig, startServer, TEST_DATABASE_URL, tempDir, testSchema } from './helpers';

/** PgEventStore against the real Postgres in meetless-pg (throw-away schema). */
const schema = testSchema();
beforeAll(requirePostgres);
afterAll(() => schema.drop());

const ev = (seq: number, id: string, recordedAt: string): StoredEvent => ({
  event: { seq, id, type: 'user.registered', actorId: 'system', recordedAt, payload: { userId: id, displayName: id, locale: 'en' } } as DomainEvent,
  projectId: null,
  privateTo: null,
});

describe('PgEventStore', () => {
  it('assigns gap-free seq, is idempotent on id (also concurrently), rolls back on a rejected decision, and persists', async () => {
    const a = await openPostgres({ connectionString: TEST_DATABASE_URL, schema: schema.name });
    const decide = (id: string) => (ctx: { seq: number; recordedAt: string }) => ev(ctx.seq, id, ctx.recordedAt);

    const r1 = await a.events.append('s', 'e1', 0, decide('e1'));
    expect(r1.status).toBe('appended');
    expect(r1.stored.event.seq).toBe(1);

    const concurrent = await Promise.all([1, 2, 3, 4].map(() => a.events.append('s', 'e2', 1, decide('e2'))));
    expect(concurrent.filter((r) => r.status === 'appended')).toHaveLength(1);
    expect(concurrent.every((r) => r.stored.event.seq === 2)).toBe(true);

    await expect(a.events.append('s', 'e3', 2, () => { throw new Error('rejected by domain'); })).rejects.toThrow('rejected by domain');
    expect(await a.events.head('s')).toBe(2);

    // A writer that is behind gets the missed events to catch up its projection.
    let missed: StoredEvent[] = [];
    await a.events.append('s', 'e3', 0, (ctx) => {
      missed = ctx.missed;
      return ev(ctx.seq, 'e3', ctx.recordedAt);
    });
    expect(missed.map((m) => m.event.id)).toEqual(['e1', 'e2']);
    await a.events.close();

    // Restart: a new pool sees exactly the same log, envelopes round-trip unchanged.
    const b = await openPostgres({ connectionString: TEST_DATABASE_URL, schema: schema.name });
    const all = await b.events.readAfter('s', 0);
    expect(all.map((s) => s.event.seq)).toEqual([1, 2, 3]);
    expect(all[0]!.event).toEqual(r1.stored.event);
    const times = all.map((s) => Date.parse(s.event.recordedAt));
    expect(times).toEqual([...times].sort((x, y) => x - y));
    expect(await b.events.readAfter('s', 2)).toHaveLength(1);
    await b.events.close();
  });

  it('records blob metadata once and remembers every uploader', async () => {
    const s = await openPostgres({ connectionString: TEST_DATABASE_URL, schema: schema.name });
    const hash = `sha256:${'a'.repeat(64)}`;
    expect((await s.blobs.put({ hash, size: 3, mediaType: 'text/plain' }, 'u1')).created).toBe(true);
    expect((await s.blobs.put({ hash, size: 3, mediaType: 'text/plain' }, 'u2')).created).toBe(false);
    expect(await s.blobs.get(hash)).toEqual({ hash, size: 3, mediaType: 'text/plain' });
    expect(await s.blobs.uploadedBy(hash, 'u2')).toBe(true);
    expect(await s.blobs.uploadedBy(hash, 'u3')).toBe(false);
    await expect(s.blobs.put({ hash: 'sha256:nothex', size: 1, mediaType: 'x' }, 'u1')).rejects.toThrow();
    await s.events.close();
  });

  it('stores private_to and returns it on read', async () => {
    const a = await openPostgres({ connectionString: TEST_DATABASE_URL, schema: schema.name });
    const scoped = (ctx: { seq: number; recordedAt: string }, id: string, privateTo: string | null): StoredEvent => ({
      event: { seq: ctx.seq, id, type: 'need.created', actorId: 'u-alex', recordedAt: ctx.recordedAt, payload: {} } as unknown as DomainEvent,
      projectId: 'P1',
      privateTo,
    });
    const priv = await a.events.append('scoped', 'p1', 0, (ctx) => scoped(ctx, 'p1', 'u-alex'));
    expect(priv.stored).toMatchObject({ projectId: 'P1', privateTo: 'u-alex' });
    await a.events.append('scoped', 'p2', 1, (ctx) => scoped(ctx, 'p2', null));
    // The duplicate path and the catch-up path carry it too.
    expect((await a.events.append('scoped', 'p1', 2, (ctx) => scoped(ctx, 'p1', null))).stored.privateTo).toBe('u-alex');
    let missed: StoredEvent[] = [];
    await a.events.append('scoped', 'p3', 0, (ctx) => {
      missed = ctx.missed;
      return scoped(ctx, 'p3', 'u-lin');
    });
    expect(missed.map((m) => m.privateTo)).toEqual(['u-alex', null]);
    await a.events.close();

    const b = await openPostgres({ connectionString: TEST_DATABASE_URL, schema: schema.name });
    const all = await b.events.readAfter('scoped', 0);
    expect(all.map((x) => [x.event.id, x.projectId, x.privateTo])).toEqual([
      ['p1', 'P1', 'u-alex'],
      ['p2', 'P1', null],
      ['p3', 'P1', 'u-lin'],
    ]);
    await b.events.close();
  });

  it('startServer refuses an old-model log: names the seq, type and schema, and writes nothing', async () => {
    const old = testSchema();
    const dir = tempDir('old');
    try {
      // An old schema: migrations 1 and 2 only, and a log holding an event type this version does not know.
      const s = await openPostgres({ connectionString: TEST_DATABASE_URL, schema: old.name });
      await s.events.append('team', 'e1', 0, (ctx) => ev(ctx.seq, 'e1', ctx.recordedAt));
      await s.events.append('team', 'e2', 1, (ctx) => ({
        event: { seq: ctx.seq, id: 'e2', type: 'changeRequest.created', actorId: 'e1', recordedAt: ctx.recordedAt, payload: {} } as unknown as DomainEvent,
        projectId: 'P-old',
        privateTo: null,
      }));
      await s.pool.query(`alter table "${old.name}".ml_events drop column private_to`);
      await s.pool.query(`delete from "${old.name}".ml_schema_migrations where version = 3`);
      await s.events.close();

      const snapshot = async () => {
        const c = new pg.Client({ connectionString: TEST_DATABASE_URL });
        await c.connect();
        try {
          const events = await c.query(`select seq, type from "${old.name}".ml_events order by seq`);
          const versions = await c.query(`select version from "${old.name}".ml_schema_migrations order by version`);
          const cols = await c.query(`select column_name from information_schema.columns where table_schema = $1 and table_name = 'ml_events' order by column_name`, [old.name]);
          return { events: events.rows, versions: versions.rows, cols: cols.rows };
        } finally {
          await c.end();
        }
      };
      const before = await snapshot();
      await expect(startServer(serverConfig({ dataDir: dir.path, pgSchema: old.name }))).rejects.toThrow(
        `event 2 has type changeRequest.created, unknown to this version (schema ${old.name}); this schema predates this version, reset it`,
      );
      expect(await snapshot()).toEqual(before);
    } finally {
      await old.drop();
      dir.rm();
    }
  });
});
