import { beforeAll, describe, expect, it } from 'vitest';
import { hashSecret } from '../src/accounts/secrets';
import { MemoryAccountStore } from '../src/store/memory';
import { ident, openPostgres } from '../src/store/postgres';
import type { AccountStore, InviteRow, TokenRow } from '../src/store/types';
import { requirePostgres, TEST_DATABASE_URL, testSchema } from './helpers';

const T = '2026-11-24T09:00:00.000Z';
const T2 = '2026-11-24T09:05:00.000Z';

function makeInvite(over: Partial<InviteRow> & { id: string }): InviteRow {
  return {
    codeHash: hashSecret(over.id),
    projectId: null,
    roleId: null,
    admin: false,
    createdBy: null,
    createdAt: T,
    usedBy: null,
    usedAt: null,
    revokedAt: null,
    ...over,
  };
}

function makeToken(over: Partial<TokenRow> & { id: string; userId: string }): TokenRow {
  return {
    kind: 'personal',
    label: 'test token',
    tokenHash: hashSecret(over.id),
    createdAt: T,
    lastUsedAt: null,
    revokedAt: null,
    ...over,
  };
}

interface Backend {
  name: string;
  fresh(): Promise<{ store: AccountStore; cleanup(): Promise<void> }>;
}

const backends: Backend[] = [
  { name: 'memory', fresh: async () => ({ store: new MemoryAccountStore(), cleanup: async () => {} }) },
  {
    name: 'postgres',
    fresh: async () => {
      const s = testSchema();
      const { accounts, pool } = await openPostgres({ connectionString: TEST_DATABASE_URL, schema: s.name });
      return {
        store: accounts,
        cleanup: async () => {
          await pool.end();
          await s.drop();
        },
      };
    },
  },
];

beforeAll(requirePostgres);

describe.each(backends.map((b) => [b.name, b.fresh] as const))('AccountStore (%s)', (_name, fresh) => {
  it('a claimed invite cannot be claimed again, also when two claims race', async () => {
    const { store, cleanup } = await fresh();
    await store.createInvite(makeInvite({ id: 'i1' }));
    const results = (await Promise.all([store.claimInvite('i1', 'u-a', T), store.claimInvite('i1', 'u-b', T)])).sort();
    expect(results).toEqual(['claimed', 'used']);
    const row = await store.invite('i1');
    expect(row?.usedBy).toMatch(/^u-[ab]$/);
    expect(row?.usedAt).toBe(T);
    await cleanup();
  });

  it('a revoked invite reports revoked on claim; releaseInvite makes a claimed invite claimable again', async () => {
    const { store, cleanup } = await fresh();
    await store.createInvite(makeInvite({ id: 'i2' }));
    expect(await store.revokeInvite('i2', T)).toBe(true);
    expect(await store.claimInvite('i2', 'u-a', T)).toBe('revoked');

    await store.createInvite(makeInvite({ id: 'i3' }));
    expect(await store.claimInvite('i3', 'u-a', T)).toBe('claimed');
    expect(await store.claimInvite('i3', 'u-b', T)).toBe('used');
    await store.releaseInvite('i3');
    const released = await store.invite('i3');
    expect(released?.usedBy).toBeNull();
    expect(released?.usedAt).toBeNull();
    expect(released?.revokedAt).toBeNull();
    expect(await store.claimInvite('i3', 'u-c', T2)).toBe('claimed');
    await cleanup();
  });

  it('tokens are found by hash; a revoked token is returned with revokedAt set', async () => {
    const { store, cleanup } = await fresh();
    const row = makeToken({ id: 't1', userId: 'u-a' });
    await store.createToken(row);
    expect(await store.tokenByHash(row.tokenHash)).toMatchObject({ id: 't1', userId: 'u-a', revokedAt: null });
    expect(await store.tokenByHash(`sha256:${'f'.repeat(64)}`)).toBeNull();
    expect(await store.revokeToken('t1', 'u-a', T)).toBe(true);
    expect(await store.tokenByHash(row.tokenHash)).toMatchObject({ id: 't1', revokedAt: T });
    await cleanup();
  });

  it("revokeToken revokes only the owner's token", async () => {
    const { store, cleanup } = await fresh();
    await store.createToken(makeToken({ id: 't2', userId: 'u-a' }));
    expect(await store.revokeToken('t2', 'u-other', T)).toBe(false);
    const untouched = await store.tokenByHash(hashSecret('t2'));
    expect(untouched?.revokedAt).toBeNull();
    expect(await store.revokeToken('t2', 'u-a', T)).toBe(true);
    const revoked = await store.tokenByHash(hashSecret('t2'));
    expect(revoked?.revokedAt).toBe(T);
    await cleanup();
  });

  it('a second same-owner revokeToken stays true but never moves revokedAt', async () => {
    const { store, cleanup } = await fresh();
    await store.createToken(makeToken({ id: 't2b', userId: 'u-a' }));
    expect(await store.revokeToken('t2b', 'u-a', T)).toBe(true);
    expect(await store.revokeToken('t2b', 'u-a', T2)).toBe(true);
    const row = await store.tokenByHash(hashSecret('t2b'));
    expect(row?.revokedAt).toBe(T);
    await cleanup();
  });

  it("listCalls returns the user's calls newest first, capped by limit", async () => {
    const { store, cleanup } = await fresh();
    const call = (id: string, userId: string, at: string) => ({
      id,
      at,
      tokenId: 't1',
      client: 'claude-code',
      tool: 'get_need_context' as const,
      projectId: null,
      needCode: null,
      ok: true,
      code: null,
      userId,
    });
    await store.recordCall(call('c1', 'u-a', '2026-11-24T09:00:00.000Z'));
    await store.recordCall(call('c2', 'u-a', '2026-11-24T09:01:00.000Z'));
    await store.recordCall(call('c3', 'u-a', '2026-11-24T09:02:00.000Z'));
    await store.recordCall(call('c4', 'u-b', '2026-11-24T09:03:00.000Z'));
    const calls = await store.listCalls('u-a', 2);
    expect(calls.map((c) => c.id)).toEqual(['c3', 'c2']);
    await cleanup();
  });

  it('pendingAdminInvite returns the unused, unrevoked admin invite; hasAnyAccount turns true once a personal token exists', async () => {
    const { store, cleanup } = await fresh();
    expect(await store.pendingAdminInvite()).toBeNull();
    expect(await store.hasAnyAccount()).toBe(false);
    await store.createInvite(makeInvite({ id: 'ia1', admin: true }));
    expect((await store.pendingAdminInvite())?.id).toBe('ia1');
    await store.claimInvite('ia1', 'u-admin', T);
    expect(await store.pendingAdminInvite()).toBeNull();
    expect(await store.hasAnyAccount()).toBe(false);
    await store.createToken(makeToken({ id: 't3', userId: 'u-admin', kind: 'personal' }));
    expect(await store.hasAnyAccount()).toBe(true);
    await cleanup();
  });
});

describe('PgAccountStore (postgres only)', () => {
  it('stores no plaintext secret: no column of ml_invites or ml_tokens equals the code or the token', async () => {
    const s = testSchema();
    const { accounts, pool } = await openPostgres({ connectionString: TEST_DATABASE_URL, schema: s.name });
    try {
      const code = 'ABCD-EFGH-JKMN';
      const tok = `mlp_${'x'.repeat(43)}`;
      await accounts.createInvite(makeInvite({ id: 'ip1', codeHash: hashSecret(code) }));
      await accounts.createToken(makeToken({ id: 'tp1', userId: 'u-a', tokenHash: hashSecret(tok) }));
      const t = ident(s.name);
      const invites = await pool.query(`select * from ${t}.ml_invites`);
      const tokens = await pool.query(`select * from ${t}.ml_tokens`);
      const allValues = [...invites.rows, ...tokens.rows].flatMap((r) => Object.values(r));
      expect(allValues).not.toContain(code);
      expect(allValues).not.toContain(tok);
    } finally {
      await pool.end();
      await s.drop();
    }
  });

  it('migration 4 is applied once; reopening the schema is a no-op', async () => {
    const s = testSchema();
    try {
      const a = await openPostgres({ connectionString: TEST_DATABASE_URL, schema: s.name });
      await a.pool.end();
      const b = await openPostgres({ connectionString: TEST_DATABASE_URL, schema: s.name });
      const t = ident(s.name);
      const versions = await b.pool.query(`select version from ${t}.ml_schema_migrations where version = 4`);
      expect(versions.rows).toHaveLength(1);
      // Reopening did not error and did not duplicate anything; the store still works.
      await b.accounts.createInvite(makeInvite({ id: 'ireopen' }));
      expect(await b.accounts.invite('ireopen')).not.toBeNull();
      await b.pool.end();
    } finally {
      await s.drop();
    }
  });
});
