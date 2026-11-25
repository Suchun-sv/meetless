/**
 * Wrong-typed and missing request fields (final review I1): every route that takes input answers
 * 400 BAD_REQUEST naming the field, never 500, and appends nothing.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiName } from '@meetless/api';
import { ApiError, type ApiDeps } from '../src/api/frame';
import { optInt, optObject, optString, reqBool, reqString } from '../src/api/fields';
import { HANDLERS } from '../src/api/index';
import { RateLimiter } from '../src/api/ratelimit';
import type { Principal } from '../src/auth';
import { http, IDS, TODAY, TOKENS, withServer, type TestServer } from './helpers';
import { seedTeam } from './seed';

interface Row {
  route: ApiName;
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
  /** null: the route takes no token (invites.redeem). */
  token?: string | null;
  field: string;
}

const importBody = (over: Record<string, unknown>) => ({
  inputId: randomUUID(),
  title: 'Import',
  kind: 'md',
  blobHash: null,
  text: 'some text',
  from: null,
  date: TODAY,
  private: false,
  ...over,
});
const without = (o: Record<string, unknown>, k: string) => Object.fromEntries(Object.entries(o).filter(([key]) => key !== k));

const ROWS: Row[] = [
  { route: 'invites.create', method: 'POST', path: '/v1/projects/p1/invites', body: { roleId: 5 }, field: 'roleId' },
  { route: 'invites.redeem', method: 'POST', path: '/v1/invites/redeem', body: {}, token: null, field: 'code' },
  { route: 'invites.redeem', method: 'POST', path: '/v1/invites/redeem', body: { code: 7, displayName: 'X', locale: 'en' }, token: null, field: 'code' },
  { route: 'invites.redeem', method: 'POST', path: '/v1/invites/redeem', body: { code: 'ZZZZ-ZZZZ-ZZZZ', displayName: ['X'], locale: 'en' }, token: null, field: 'displayName' },
  { route: 'invites.redeem', method: 'POST', path: '/v1/invites/redeem', body: { code: 'ZZZZ-ZZZZ-ZZZZ', locale: 'en' }, token: null, field: 'displayName' },
  { route: 'invites.redeem', method: 'POST', path: '/v1/invites/redeem', body: { code: 'ZZZZ-ZZZZ-ZZZZ', displayName: 'X', locale: 3 }, token: null, field: 'locale' },
  { route: 'tokens.create', method: 'POST', path: '/v1/tokens', body: {}, field: 'label' },
  { route: 'tokens.create', method: 'POST', path: '/v1/tokens', body: { label: 12 }, field: 'label' },
  { route: 'agentCalls.list', method: 'GET', path: '/v1/agent-calls?limit=abc', field: 'limit' },
  { route: 'agentCalls.list', method: 'GET', path: '/v1/agent-calls?limit=-3', field: 'limit' },
  ...(['inputId', 'title', 'kind', 'blobHash', 'text', 'date'] as const).map(
    (f): Row => ({ route: 'inputs.import', method: 'POST', path: '/v1/projects/p1/inputs', body: importBody({ [f]: 42 }), field: f }),
  ),
  ...(['inputId', 'title', 'kind', 'date', 'private'] as const).map(
    (f): Row => ({ route: 'inputs.import', method: 'POST', path: '/v1/projects/p1/inputs', body: without(importBody({}), f), field: f }),
  ),
  { route: 'inputs.import', method: 'POST', path: '/v1/projects/p1/inputs', body: importBody({ from: 'Lin' }), field: 'from' },
  { route: 'inputs.import', method: 'POST', path: '/v1/projects/p1/inputs', body: importBody({ private: 'yes' }), field: 'private' },
  { route: 'inputs.import', method: 'POST', path: '/v1/projects/p1/inputs', body: importBody({ private: 1 }), field: 'private' },
  { route: 'inputs.import', method: 'POST', path: '/v1/projects/p1/inputs', body: importBody({ private: null }), field: 'private' },
  { route: 'needs.list', method: 'GET', path: '/v1/projects/p1/needs?round=soon', field: 'round' },
  { route: 'search', method: 'GET', path: '/v1/search', field: 'q' },
  { route: 'search', method: 'GET', path: '/v1/search?projectId=p1', field: 'q' },
  { route: 'search', method: 'GET', path: '/v1/search?q=csv&limit=lots', field: 'limit' },
  { route: 'work.record', method: 'POST', path: '/v1/projects/p1/work', body: { text: 'did it' }, field: 'code' },
  { route: 'work.record', method: 'POST', path: '/v1/projects/p1/work', body: { code: 1, text: 'did it' }, field: 'code' },
  { route: 'work.record', method: 'POST', path: '/v1/projects/p1/work', body: { code: 'N1' }, field: 'text' },
  { route: 'work.record', method: 'POST', path: '/v1/projects/p1/work', body: { code: 'N1', text: { a: 1 } }, field: 'text' },
  { route: 'work.record', method: 'POST', path: '/v1/projects/p1/work', body: { code: 'N1', text: 'did it', why: 3 }, field: 'why' },
  { route: 'work.record', method: 'POST', path: '/v1/projects/p1/work', body: { code: 'N1', text: 'did it', effect: 3 }, field: 'effect' },
  { route: 'work.record', method: 'POST', path: '/v1/projects/p1/work', body: { code: 'N1', text: 'did it', date: 20261124 }, field: 'date' },
  { route: 'needs.propose', method: 'POST', path: '/v1/projects/p1/proposals', body: { title: 'A need' }, field: 'kind' },
  { route: 'needs.propose', method: 'POST', path: '/v1/projects/p1/proposals', body: { kind: 'ext' }, field: 'title' },
  { route: 'needs.propose', method: 'POST', path: '/v1/projects/p1/proposals', body: { kind: 'ext', title: 'A need', parentCode: 5 }, field: 'parentCode' },
  { route: 'needs.propose', method: 'POST', path: '/v1/projects/p1/proposals', body: { kind: 'ext', title: 'A need', accept: 5 }, field: 'accept' },
  { route: 'needs.propose', method: 'POST', path: '/v1/projects/p1/proposals', body: { kind: 'ext', title: 'A need', expect: [] }, field: 'expect' },
  { route: 'needs.propose', method: 'POST', path: '/v1/projects/p1/proposals', body: { kind: 'ext', title: 'A need', verify: true }, field: 'verify' },
  { route: 'needs.propose', method: 'POST', path: '/v1/projects/p1/proposals', body: { kind: 'ext', title: 'A need', why: 5 }, field: 'why' },
  { route: 'needs.verdict', method: 'POST', path: '/v1/projects/p1/needs/H1/verdict', body: { verdict: 'held up' }, field: 'status' },
  { route: 'needs.verdict', method: 'POST', path: '/v1/projects/p1/needs/H1/verdict', body: { status: 2, verdict: 'held up' }, field: 'status' },
  { route: 'needs.verdict', method: 'POST', path: '/v1/projects/p1/needs/H1/verdict', body: { status: 'held' }, field: 'verdict' },
  { route: 'needs.verdict', method: 'POST', path: '/v1/projects/p1/needs/H1/verdict', body: { status: 'held', verdict: 9 }, field: 'verdict' },
];

describe('request field types (I1)', () => {
  let s: TestServer;

  beforeAll(async () => {
    s = await withServer();
    await seedTeam(s.base);
  });
  afterAll(async () => {
    await s.stop();
  });

  it.each(ROWS.map((r) => [`${r.route} ${r.method} ${r.path} ${JSON.stringify(r.body ?? null)}`, r] as const))(
    '%s answers 400 BAD_REQUEST naming the field and appends nothing',
    async (_name, row) => {
      const head = s.svc.head;
      const calls = await s.accounts.listCalls(IDS.alex, 1000);
      const tokens = await s.accounts.listTokens(IDS.alex, 'agent');
      const r = await http(s.base, row.token === undefined ? TOKENS.alex : row.token, row.method, row.path, row.body);
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ error: { code: 'BAD_REQUEST', details: { field: row.field } } });
      expect(s.svc.head).toBe(head);
      expect(await s.accounts.listTokens(IDS.alex, 'agent')).toEqual(tokens);
      expect(await s.accounts.hasAnyAccount()).toBe(false);
      expect((await s.accounts.listCalls(IDS.alex, 1000)).length).toBe(calls.length);
    },
  );

  it('the table covers every route that takes input besides path params, over HTTP or (query-only optional strings) the handler', () => {
    const covered = new Set<string>([...ROWS.map((r) => r.route), ...DIRECT.map((d) => d.route)]);
    expect([...covered].sort()).toEqual(
      [
        'invites.create',
        'invites.redeem',
        'tokens.create',
        'agentCalls.list',
        'inputs.import',
        'context.get',
        'needs.list',
        'search',
        'artifacts.read',
        'work.record',
        'needs.propose',
        'needs.verdict',
      ].sort(),
    );
  });

  /** A query value always arrives as a string, so these two optional-string fields are wrong-typed only when a caller reaches the handler directly. */
  const DIRECT: { route: 'context.get' | 'artifacts.read'; req: Record<string, unknown>; field: string }[] = [
    { route: 'context.get', req: { projectId: 'p1', code: 'N1', locale: 5 }, field: 'locale' },
    { route: 'artifacts.read', req: { projectId: 'p1', artifactId: 'art-p1-deck', versionId: 5 }, field: 'versionId' },
  ];

  it.each(DIRECT.map((d) => [d.route, d] as const))('%s refuses a wrong-typed field with BAD_REQUEST naming it', async (_name, d) => {
    const deps: ApiDeps = {
      service: s.svc,
      accounts: s.accounts,
      auth: s.auth,
      cfg: s.cfg,
      rateLimits: { signIn: new RateLimiter(s.cfg.rateLimits.signIn, Date.now), redeem: new RateLimiter(s.cfg.rateLimits.redeem, Date.now) },
      skillMarkdown: 'guide',
    };
    const p: Principal = { userId: IDS.alex, kind: 'dev', tokenId: null, label: null, via: 'bearer' };
    const head = s.svc.head;
    const handler = HANDLERS[d.route] as (ctx: unknown) => Promise<unknown>;
    const err = await handler({ p, req: d.req, http: { headers: {} }, deps }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'BAD_REQUEST', details: { field: d.field } });
    expect(s.svc.head).toBe(head);
  });

  it('well-typed requests on the same routes still succeed', async () => {
    const imported = await http(s.base, TOKENS.alex, 'POST', '/v1/projects/p1/inputs', importBody({ private: true }));
    expect(imported.status).toBe(200);
    expect(s.svc.current.inputs[imported.json.inputId]?.privateTo).toBe(IDS.alex);
    const shared = await http(s.base, TOKENS.alex, 'POST', '/v1/projects/p1/inputs', importBody({ private: false, blobHash: undefined }));
    expect(shared.status).toBe(200);
    expect(s.svc.current.inputs[shared.json.inputId]?.privateTo).toBeNull();
    expect((await http(s.base, TOKENS.alex, 'GET', '/v1/search?q=csv&limit=5')).status).toBe(200);
    expect((await http(s.base, TOKENS.alex, 'GET', '/v1/projects/p1/needs?round=current')).status).toBe(200);
    expect((await http(s.base, TOKENS.alex, 'GET', '/v1/projects/p1/needs?round=1')).status).toBe(200);
    expect((await http(s.base, TOKENS.alex, 'GET', '/v1/agent-calls?limit=0')).status).toBe(200);
  });
});

describe('field guards (unit)', () => {
  const field = (f: () => unknown) => {
    try {
      f();
      return null;
    } catch (e) {
      return e instanceof ApiError && e.code === 'BAD_REQUEST' ? (e.details as { field: string }).field : 'other';
    }
  };

  it('accept the right type and refuse anything else naming the field', () => {
    expect(reqString('', 'a')).toBe('');
    expect(field(() => reqString(undefined, 'a'))).toBe('a');
    expect(field(() => reqString(1, 'a'))).toBe('a');
    expect(optString(undefined, 'b')).toBeNull();
    expect(optString(null, 'b')).toBeNull();
    expect(optString('x', 'b')).toBe('x');
    expect(field(() => optString({}, 'b'))).toBe('b');
    expect(reqBool(true, 'c')).toBe(true);
    expect(reqBool(false, 'c')).toBe(false);
    for (const v of [undefined, null, 'true', 1, 0]) expect(field(() => reqBool(v, 'c'))).toBe('c');
    expect(optInt(undefined, 'd')).toBeUndefined();
    expect(optInt(3, 'd')).toBe(3);
    for (const v of ['3', 1.5, Number.NaN, Infinity]) expect(field(() => optInt(v, 'd'))).toBe('d');
    expect(optObject(null, 'e')).toBeNull();
    expect(optObject({ name: 'Lin' }, 'e')).toEqual({ name: 'Lin' });
    for (const v of ['Lin', [], 3]) expect(field(() => optObject(v, 'e'))).toBe('e');
  });
});
