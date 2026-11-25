import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { replay, type DomainEvent } from '@meetless/core';
import { ClientNode, type BridgeEvent } from '@meetless/client';
import { Cable, cmd, http, IDS, make, requirePostgres, serverConfig, startServer, tempDir, testSchema, TODAY, TOKENS, until } from './helpers';

/**
 * End-to-end over real HTTP + WebSocket: the sync service on Postgres
 * (meetless-pg, throw-away schema) and independent client engines, each with
 * its own data directory and SQLite cache, as the desktop main process uses them.
 */
const schema = testSchema();
const serverDir = tempDir('server');
const dirs = { lin: tempDir('lin'), ben: tempDir('ben'), zhou: tempDir('zhou'), eve: tempDir('eve') };
type Name = keyof typeof dirs;
let server: Awaited<ReturnType<typeof startServer>>;
let port = 0;
let zhouCable: Cable;
const clients: Record<Name, ClientNode> = {} as never;
const seen: Record<Name, BridgeEvent[]> = { lin: [], ben: [], zhou: [], eve: [] };

const P = 'P-crm';
const SECRET = 'RoPE extrapolation';
const OTHER_SECRET = 'salary table for the client';
const ids = { round: 'r1', need: 'n-export', work: 'w-1', art: 'a-doc', v1: 'v1' };
let fileHash = '';

async function open(name: Name, url: string, token: string, locale: string) {
  const c = await ClientNode.open({ dataDir: dirs[name].path, minBackoffMs: 50, maxBackoffMs: 200 });
  c.subscribe((e) => seen[name].push(e));
  const r = await c.signIn(url, token);
  expect(r.ok).toBe(true);
  await c.setLocale(locale);
  clients[name] = c;
  await until(async () => (await c.snapshot()).status.state === 'online', 8000, `${name} online`);
  return c;
}

const events = async (name: Name): Promise<DomainEvent[]> => (await clients[name].snapshot()).events;
const head = () => server.service.head;
const caughtUp = (name: Name) => until(async () => (await clients[name].snapshot()).status.cursor >= head(), 8000, `${name} caught up`);

async function ok(name: Name, c: { id: string; type: string; payload: unknown }) {
  const r = await clients[name].submit(c as never);
  expect(r, `${c.type} by ${name}`).toMatchObject({ kind: 'accepted' });
  return r;
}

/** Whether any file in a client's data directory (SQLite cache, WAL, blobs) contains `text`. */
function onDisk(name: Name, text: string): boolean {
  const needle = Buffer.from(text);
  const walk = (d: string): boolean =>
    readdirSync(d).some((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : readFileSync(p).includes(needle);
    });
  return walk(dirs[name].path);
}

beforeAll(async () => {
  await requirePostgres();
  server = await startServer(serverConfig({ dataDir: serverDir.path, pgSchema: schema.name }));
  port = Number(new URL(server.url).port);
  zhouCable = new Cable(port);
  await zhouCable.plug();
  await open('lin', server.url, TOKENS.lin, 'zh-CN');
  await open('ben', server.url, TOKENS.ben, 'en');
  await open('zhou', zhouCable.url, TOKENS.zhou, 'zh-CN');
  await open('eve', server.url, TOKENS.eve, 'en');
});

afterAll(async () => {
  for (const c of Object.values(clients)) await c.close();
  await zhouCable?.unplug();
  await server?.close();
  await schema.drop();
  for (const d of [serverDir, ...Object.values(dirs)]) d.rm();
});

describe('clients in different locales share one server-ordered state', () => {
  it('zh-CN and en clients converge after one creates a need', async () => {
    await ok('lin', make.project(P));
    await ok('lin', make.member(P, IDS.ben));
    await ok('lin', make.member(P, IDS.zhou));
    await ok('lin', make.round(ids.round, P));
    await ok('lin', make.need(ids.need, P, '支持导出客户数据', { roundId: ids.round }));
    await ok('ben', make.work(ids.work, P, ids.need, 'Export design drafted'));
    const up = await clients.ben.uploadBlob(new TextEncoder().encode('Export design v1, 12 fields'), 'application/pdf');
    if (!up.ok) throw new Error(up.code);
    fileHash = up.hash;
    await ok('ben', cmd('artifact.created', { artifactId: ids.art, projectId: P, kind: 'pdf', title: 'Export design', where: 'local', needIds: [ids.need] }));
    await ok('ben', cmd('artifact.version_added', { artifactId: ids.art, versionId: ids.v1, label: 'v1', date: TODAY, note: 'first draft', blobHash: fileHash, mediaType: 'application/pdf' }));
    // The PDF text worker appends its own `artifactVersion.derived` for this version in the
    // background; wait for it here so it never lands inside a later test's head count.
    await until(() => server.service.current.artifacts[ids.art]?.versions[0]?.derived, 8000, 'pdf text worker done with v1');

    for (const n of ['lin', 'ben', 'zhou'] as const) await caughtUp(n);
    const [a, b] = [replay(await events('lin')), replay(await events('ben'))];
    expect(a).toEqual(b);
    expect(replay(await events('zhou'))).toEqual(a);
    expect(a.needs[ids.need]).toMatchObject({ code: 'N1', title: '支持导出客户数据' });
    // Personal locale differs per user; shared objects do not depend on it.
    expect(a.users[IDS.lin]?.locale).toBe('zh-CN');
    expect(a.users[IDS.ben]?.locale).toBe('en');
    expect((await clients.lin.snapshot()).locale).toBe('zh-CN');
    expect((await clients.ben.snapshot()).locale).toBe('en');
    // zhou fetches the file through his own client, not via ben's machine.
    const blob = await clients.zhou.readBlob(fileHash);
    expect(blob.ok && new TextDecoder().decode(blob.bytes)).toBe('Export design v1, 12 fields');
    const me = await http(server.url, TOKENS.ben, 'GET', '/v1/me');
    expect(me.json).toEqual({ user: { id: IDS.ben, displayName: 'Ben Carter', locale: 'en' }, devAuth: true });
  });

  it('repeated submissions of one command id are deduplicated', async () => {
    const c = make.work('w-dup', P, ids.need, 'Client reports use basic contact fields only');
    const before = head();
    const [x, y] = await Promise.all([clients.ben.submit(c), clients.ben.submit(c)]);
    expect([x.kind, y.kind].sort()).toEqual(['accepted', 'duplicate']);
    const again = await http(server.url, TOKENS.ben, 'POST', '/v1/commands', c);
    expect(again.status).toBe(200);
    expect(again.json.status).toBe('duplicate');
    expect(head()).toBe(before + 1);
    await caughtUp('lin');
    expect((await events('lin')).filter((e) => e.id === c.id)).toHaveLength(1);
    // Same bytes uploaded twice: content-addressed, the second upload is a no-op.
    const same = await clients.lin.uploadBlob(new TextEncoder().encode('Export design v1, 12 fields'), 'application/pdf');
    expect(same).toMatchObject({ ok: true, hash: fileHash });
  });

  it('an offline client queues; on reconnect it resumes and a conflicting command is rejected visibly', async () => {
    await caughtUp('zhou');
    const cursorBefore = (await clients.zhou.snapshot()).status.cursor;
    await zhouCable.unplug();
    await until(async () => (await clients.zhou.snapshot()).status.state === 'offline', 8000, 'zhou offline');

    // zhou delivers round 1 while offline; meanwhile lin delivers it too.
    const deliver = cmd('round.delivered', { roundId: ids.round, date: TODAY, items: ['导出 CSV'] });
    expect(await clients.zhou.submit(deliver)).toEqual({ kind: 'queued' });
    expect((await clients.zhou.snapshot()).outbox).toMatchObject([{ id: deliver.id, status: 'queued', error: null }]);
    await ok('lin', cmd('round.delivered', { roundId: ids.round, date: TODAY, items: ['导出 CSV', '字段说明'] }));
    await ok('ben', make.work('w-2', P, ids.need, 'noted while zhou is offline'));
    const missed = server.service.eventsFor(IDS.zhou, cursorBefore).events.map((e) => e.seq);
    expect(missed.length).toBeGreaterThanOrEqual(2);

    seen.zhou.length = 0;
    await zhouCable.plug();
    const outbox = await until(async () => {
      const o = (await clients.zhou.snapshot()).outbox;
      return o[0]?.status === 'rejected' ? o : null;
    }, 8000, 'outbox rejection');
    expect(outbox).toMatchObject([{ id: deliver.id, status: 'rejected', error: { code: 'INVALID_STATE_TRANSITION' } }]);
    await caughtUp('zhou');

    // Resume, not refetch: no reset, and exactly the missed events were delivered, once each, in order.
    expect(seen.zhou.some((e) => e.type === 'reset')).toBe(false);
    const delivered = seen.zhou.flatMap((e) => (e.type === 'events' ? e.events.map((x) => x.seq) : []));
    expect(delivered).toEqual(missed);
    const zs = replay(await events('zhou'));
    expect(zs.rounds[ids.round]?.delivery?.items).toEqual(['导出 CSV', '字段说明']);
    expect(zs).toEqual(replay(await events('ben')));

    await clients.zhou.dismissOutbox(deliver.id);
    expect((await clients.zhou.snapshot()).outbox).toEqual([]);
  });

  it('a non-member is denied on every read path and gets history once added', async () => {
    expect((await http(server.url, null, 'GET', '/v1/events?after=0')).status).toBe(401);
    expect((await http(server.url, TOKENS.eve, 'GET', `/v1/blobs/${fileHash}`)).status).toBe(403);
    // The old export and ai-status routes are gone.
    expect((await http(server.url, TOKENS.eve, 'GET', `/v1/projects/${P}/export`)).status).toBe(404);
    expect((await http(server.url, TOKENS.lin, 'GET', `/v1/projects/${P}/export`)).status).toBe(404);
    expect((await http(server.url, TOKENS.lin, 'GET', '/v1/ai-status')).status).toBe(404);
    const page = await http(server.url, TOKENS.eve, 'GET', '/v1/events?after=0');
    expect(page.json.events.some((e: DomainEvent) => e.type !== 'user.registered' && e.type !== 'user.locale_changed')).toBe(false);
    await caughtUp('eve');
    expect(replay(await events('eve')).projects[P]).toBeUndefined();
    expect(await clients.eve.readBlob(fileHash)).toMatchObject({ ok: false, code: 'NOT_AUTHORISED' });

    await ok('lin', make.member(P, IDS.eve));
    await until(async () => replay(await events('eve')).projects[P], 8000, 'eve sees the project after being added');
    expect(seen.eve.some((e) => e.type === 'reset')).toBe(true);
    expect(replay(await events('eve')).needs[ids.need]?.code).toBe('N1');
    expect((await http(server.url, TOKENS.eve, 'GET', `/v1/blobs/${fileHash}`)).status).toBe(200);
  });

  it('a private need never reaches the other client’s cache; after sharing it does', async () => {
    await ok('lin', make.need('n-priv', P, `${SECRET} may cut latency`, { private: true }));
    await ok('lin', make.work('w-priv', P, 'n-priv', `${SECRET} small run`));
    await ok('lin', make.need('n-priv2', P, `${OTHER_SECRET} draft`, { private: true }));
    const notes = new TextEncoder().encode(`private minutes: ${OTHER_SECRET}`);
    const up = await clients.lin.uploadBlob(notes, 'text/markdown');
    if (!up.ok) throw new Error(up.code);
    await ok('lin', cmd('input.imported', { inputId: 'in-priv', projectId: P, kind: 'md', title: 'My notes.md', date: TODAY, blobHash: up.hash, body: [{ id: 'p1', text: OTHER_SECRET }], extracts: [], detector: 'rules/1', private: true }));
    for (const n of ['lin', 'ben'] as const) await caughtUp(n);

    expect(JSON.stringify(await events('lin'))).toContain(SECRET);
    expect(JSON.stringify(await events('ben'))).not.toContain(SECRET);
    expect(onDisk('ben', SECRET)).toBe(false);
    expect(onDisk('ben', OTHER_SECRET)).toBe(false);
    expect((await http(server.url, TOKENS.ben, 'GET', `/v1/blobs/${up.hash}`)).status).toBe(403);
    expect(await clients.ben.readBlob(up.hash)).toMatchObject({ ok: false, code: 'NOT_AUTHORISED' });

    // Lin shares the need: Ben gets it (from the service's snapshot) with its work, and nothing else that is private.
    await ok('lin', cmd('need.shared', { needId: 'n-priv' }));
    await caughtUp('ben');
    const bs = replay(await events('ben'));
    expect(bs.needs['n-priv']).toMatchObject({ code: 'N2', title: `${SECRET} may cut latency`, privateTo: null });
    expect(bs.work['w-priv']).toMatchObject({ needId: 'n-priv', privateTo: null });
    expect(bs.needs['n-priv2']).toBeUndefined();
    expect(bs.needs).toEqual(server.service.view(IDS.ben).needs);
    expect(bs.work).toEqual(server.service.view(IDS.ben).work);
    expect(onDisk('ben', SECRET)).toBe(true);
    expect(onDisk('ben', OTHER_SECRET)).toBe(false);
  });

  it('a need taken from a private input cannot be shared before the input; until then nothing of the input reaches others', async () => {
    const TITLE = 'Interview with the client CFO.md';
    const BODY = 'The CFO wants a payroll export by March';
    const leaks = (x: unknown) => {
      const j = JSON.stringify(x);
      return j.includes(TITLE) || j.includes(BODY);
    };
    await ok('zhou', cmd('input.imported', { inputId: 'in-z', projectId: P, kind: 'md', title: TITLE, date: TODAY, body: [{ id: 'p1', text: BODY }], extracts: [{ id: 'x1', type: 'new', text: 'Payroll export', paraId: 'p1' }], detector: 'rules/1', private: true }));
    await ok('zhou', cmd('extract.accepted', { inputId: 'in-z', extractId: 'x1', needId: 'n-z' }));
    expect(await clients.zhou.submit(cmd('need.shared', { needId: 'n-z' }))).toMatchObject({ kind: 'rejected', code: 'PRIVATE_SOURCE' });
    for (const n of ['lin', 'ben'] as const) await caughtUp(n);
    expect(leaks(server.service.eventsFor(IDS.lin, 0).events)).toBe(false);
    expect(leaks(server.service.view(IDS.lin))).toBe(false);
    expect(onDisk('ben', TITLE) || onDisk('ben', BODY)).toBe(false);

    await ok('zhou', cmd('input.shared', { inputId: 'in-z' }));
    await ok('zhou', cmd('need.shared', { needId: 'n-z' }));
    await caughtUp('ben');
    expect(replay(await events('ben')).needs['n-z']).toMatchObject({ privateTo: null, source: { inputId: 'in-z', ref: TITLE, quote: BODY } });
    expect(leaks(server.service.view(IDS.lin))).toBe(true);
    expect(onDisk('ben', BODY)).toBe(true);
  });

  it('server restart keeps log and blobs; client restart keeps its cache', async () => {
    const before = head();
    const stateBefore = server.service.current;
    await server.close();
    await until(async () => (await clients.lin.snapshot()).status.state === 'offline', 8000, 'lin sees the server down');
    server = await startServer(serverConfig({ dataDir: serverDir.path, pgSchema: schema.name, port }));
    expect(head()).toBe(before);
    expect(server.service.current).toEqual(stateBefore);
    await until(async () => (await clients.lin.snapshot()).status.state === 'online', 8000, 'lin reconnects');
    await ok('lin', make.work('w-3', P, ids.need, 'after restart'));
    await caughtUp('ben');
    expect(replay(await events('ben')).work['w-3']?.text).toBe('after restart');
    expect((await http(server.url, TOKENS.zhou, 'GET', `/v1/blobs/${fileHash}`)).status).toBe(200);

    // Client restart while the server is down: data comes from the local cache.
    const snapBefore = await clients.ben.snapshot();
    await clients.ben.close();
    await server.close();
    const reopened = await ClientNode.open({ dataDir: dirs.ben.path, minBackoffMs: 50, maxBackoffMs: 200 });
    clients.ben = reopened;
    const offline = await reopened.snapshot();
    expect(offline.session?.userId).toBe(IDS.ben);
    expect(offline.locale).toBe('en');
    expect(offline.events).toEqual(snapBefore.events);
    expect(offline.status.cursor).toBe(snapBefore.status.cursor);
    expect((await reopened.readBlob(fileHash)).ok).toBe(true);
    server = await startServer(serverConfig({ dataDir: serverDir.path, pgSchema: schema.name, port }));
    await until(async () => (await reopened.snapshot()).status.state === 'online', 8000, 'ben back online');
  });
});
