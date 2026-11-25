import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DomainError, replay, viewFor, type DomainEvent, type Need } from '@meetless/core';
import { BlobFiles, DEFAULT_DEV_USERS, MemoryBlobMetaStore, MemoryEventStore, sha256, SyncService } from '../src/index';
import { cmd, IDS, make, tempDir, TODAY } from './helpers';

/** Unit tests of the service logic against the in-memory store double (no network, no Postgres). */
let dir: ReturnType<typeof tempDir>;
let store: MemoryEventStore;
let blobMeta: MemoryBlobMetaStore;
let svc: SyncService;
let clock = Date.parse('2026-11-24T09:00:00Z');

const open = () => SyncService.open({ store, blobMeta, blobFiles: new BlobFiles(dir.path), devUsers: DEFAULT_DEV_USERS });

/** The error code a promise rejects with ('no error' if it resolves). */
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    const c = (e as { code?: unknown }).code;
    if (typeof c === 'string') return c;
    throw e;
  }
  return 'no error';
}

beforeEach(async () => {
  dir = tempDir('svc');
  store = new MemoryEventStore(() => (clock += 1000));
  blobMeta = new MemoryBlobMetaStore();
  svc = await open();
});
afterEach(() => dir.rm());

const P = 'P1';
const SECRET = 'RoPE extrapolation';
const OTHER_SECRET = 'salary table for the client';

/** Alex leads P1 with Lin and Ben; Eve is an outsider. Alex keeps two private needs with work, and a private note on a shared need. */
async function privateWork() {
  await svc.submit(IDS.alex, make.project(P));
  await svc.submit(IDS.alex, make.member(P, IDS.lin));
  await svc.submit(IDS.alex, make.member(P, IDS.ben));
  await svc.submit(IDS.alex, make.need('n1', P, '支持导出 CSV'));
  await svc.submit(IDS.alex, make.need('np', P, `${SECRET} may cut latency`, { private: true }));
  await svc.submit(IDS.alex, make.work('wp', P, 'np', `${SECRET} small run`));
  await svc.submit(IDS.alex, make.need('np2', P, `${OTHER_SECRET} draft`, { private: true }));
  await svc.submit(IDS.alex, make.work('wp2', P, 'np2', `${OTHER_SECRET} first pass`));
  await svc.submit(IDS.alex, make.work('w-note', P, 'n1', `${OTHER_SECRET} scratch note`, { private: true }));
}

const has = (events: DomainEvent[], text: string) => JSON.stringify(events).includes(text);

describe('SyncService (memory store double)', () => {
  it('registers dev users once; gap-free seq; monotonic recordedAt', async () => {
    expect(svc.head).toBe(DEFAULT_DEV_USERS.length);
    for (const id of Object.values(IDS)) expect(svc.current.users[id], id).toBeDefined();
    expect(svc.current.users[IDS.alex]).toEqual({ id: IDS.alex, displayName: 'Alex', locale: 'zh-CN' });
    expect(svc.current.users[IDS.mia]?.locale).toBe('en');

    const r = await svc.submit(IDS.alex, make.project(P));
    expect(r.status).toBe('accepted');
    expect(r.event.seq).toBe(DEFAULT_DEV_USERS.length + 1);
    expect(r.event.actorId).toBe(IDS.alex);

    // Reopening the same log registers nobody again.
    const again = await open();
    expect(again.head).toBe(svc.head);
    const all = (await store.readAfter('team', 0)).map((s) => s.event);
    expect(all.map((e) => e.seq)).toEqual(all.map((_, i) => i + 1));
    const times = all.map((e) => Date.parse(e.recordedAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(replay(svc.eventsFor(IDS.alex, 0).events).projects[P]?.name).toBe('客户管理系统首版交付');
  });

  it('validates through core; a rejected command appends nothing', async () => {
    await svc.submit(IDS.alex, make.project(P));
    const head = svc.head;
    expect(await code(svc.submit(IDS.ben, make.member(P, IDS.ben)))).toBe('NOT_A_MEMBER');
    expect(await code(svc.submit(IDS.alex, make.need('n', 'nope', 'x')))).toBe('NOT_FOUND');
    expect(await code(svc.submit(IDS.alex, { id: randomUUID(), type: 'no.such' as never, payload: {} }))).toBe('UNKNOWN_EVENT_TYPE');
    expect(await code(svc.submit(IDS.alex, { ...make.project('P2'), id: 'short' }))).toBe('INVALID_EVENT');
    expect(await code(svc.submit(IDS.alex, { ...make.project('P2'), payload: null as never }))).toBe('INVALID_EVENT');
    expect(svc.head).toBe(head);
  });

  it('project.renamed: any member renames, a non-member is refused, and every member receives the new name', async () => {
    await svc.submit(IDS.alex, make.project(P));
    await svc.submit(IDS.alex, make.member(P, IDS.lin));
    const head = svc.head;
    expect(await code(svc.submit(IDS.eve, cmd('project.renamed', { projectId: P, name: 'Hijacked' })))).toBe('NOT_A_MEMBER');
    expect(await code(svc.submit(IDS.lin, cmd('project.renamed', { projectId: P, name: '   ' })))).toBe('INVALID_EVENT');
    expect(await code(svc.submit(IDS.lin, cmd('project.renamed', { projectId: P, name: 'x'.repeat(81) })))).toBe('INVALID_EVENT');
    expect(svc.head).toBe(head);

    const r = await svc.submit(IDS.lin, cmd('project.renamed', { projectId: P, name: ' 客户管理 · 二期 ' }));
    expect(r.status).toBe('accepted');
    expect(svc.current.projects[P]!.name).toBe('客户管理 二期');
    for (const id of [IDS.alex, IDS.lin]) {
      expect(svc.eventsFor(id, 0).events.some((e) => e.id === r.event.id)).toBe(true);
      expect(svc.view(id).projects[P]!.name).toBe('客户管理 二期');
    }
    expect(svc.eventsFor(IDS.eve, 0).events.some((e) => e.id === r.event.id)).toBe(false);
    expect(svc.view(IDS.eve).projects[P]).toBeUndefined();
  });

  it('dedupes by id, also concurrently; another actor cannot reuse an id', async () => {
    const c = make.project(P);
    const [a, b, d] = await Promise.all([svc.submit(IDS.alex, c), svc.submit(IDS.alex, c), svc.submit(IDS.alex, c)]);
    expect([a.status, b.status, d.status].sort()).toEqual(['accepted', 'duplicate', 'duplicate']);
    expect(new Set([a.event.seq, b.event.seq, d.event.seq]).size).toBe(1);
    expect(svc.eventsFor(IDS.alex, 0).events.filter((e) => e.id === c.id)).toHaveLength(1);
    expect(await code(svc.submit(IDS.ben, c))).toBe('ALREADY_EXISTS');
  });

  it('a private need and its work reach only the owner', async () => {
    await privateWork();
    for (const id of [IDS.lin, IDS.ben, IDS.eve]) {
      const page = svc.eventsFor(id, 0);
      expect(page.events.some((e) => e.type === 'need.created' && e.payload.needId === 'np')).toBe(false);
      expect(page.events.some((e) => e.type === 'work.recorded' && e.payload.workId === 'wp')).toBe(false);
      expect(has(page.events, SECRET) || has(page.events, OTHER_SECRET)).toBe(false);
      // The resume cursor still advances past the filtered events.
      expect(page.cursor).toBe(svc.head);
    }
    expect(svc.eventsFor(IDS.lin, 0).events.some((e) => e.type === 'need.created' && e.payload.needId === 'n1')).toBe(true);
    expect(has(svc.eventsFor(IDS.alex, 0).events, SECRET)).toBe(true);
    expect(Object.keys(svc.view(IDS.lin).needs)).toEqual(['n1']);
    expect(Object.keys(svc.view(IDS.lin).work)).toEqual([]);
    expect(Object.keys(svc.view(IDS.alex).needs).sort()).toEqual(['n1', 'np', 'np2']);
    expect(svc.view(IDS.eve).projects[P]).toBeUndefined();
  });

  it('need.shared carries a service-filled snapshot; a member who never saw the need replays to it and its work', async () => {
    await privateWork();
    // The client sends a forged snapshot that would leak the other private need and notes: it is replaced.
    const forged = { need: { ...svc.current.needs['np2']!, id: 'np' } as Need, work: [svc.current.work['wp2']!, svc.current.work['w-note']!] };
    const r = await svc.submit(IDS.alex, cmd('need.shared', { needId: 'np', snapshot: forged }));
    expect(r.status).toBe('accepted');
    const shared = r.event.type === 'need.shared' ? r.event.payload : null;
    expect(shared?.snapshot?.need).toMatchObject({ id: 'np', title: `${SECRET} may cut latency`, privateTo: IDS.alex });
    expect(shared?.snapshot?.work.map((w) => w.id)).toEqual(['wp']);
    expect(JSON.stringify(r.event)).not.toContain(OTHER_SECRET);

    const lin = svc.eventsFor(IDS.lin, 0).events;
    expect(has(lin, OTHER_SECRET)).toBe(false);
    const linState = replay(lin);
    expect(replay(svc.eventsFor(IDS.lin, 0).events).needs['np']!.code).toMatch(/^N\d+$/);
    expect(linState.needs['np']).toMatchObject({ code: 'N2', privateTo: null });
    expect(linState.work['wp']).toMatchObject({ needId: 'np', privateTo: null });
    expect(linState.work['w-note']).toBeUndefined();
    expect(linState.needs).toEqual(svc.view(IDS.lin).needs);
    expect(linState.work).toEqual(svc.view(IDS.lin).work);

    // Others cannot share Alex's private need, nor create a need from a snapshot they made up.
    const head = svc.head;
    expect(await code(svc.submit(IDS.lin, cmd('need.shared', { needId: 'np2', snapshot: { need: svc.current.needs['np2']!, work: [] } })))).toBe('NOT_FOUND');
    const madeUp = { ...svc.current.needs['n1']!, id: 'n-made-up', privateTo: IDS.lin, title: 'made up' };
    expect(await code(svc.submit(IDS.lin, cmd('need.shared', { needId: 'n-made-up', snapshot: { need: madeUp, work: [] } })))).toBe('NOT_FOUND');
    expect(svc.head).toBe(head);
  });

  it('clients cannot append service-only types or work with via; appendTrusted can', async () => {
    await privateWork();
    const head = svc.head;
    const via = { client: 'claude-code', tokenId: 'tok-1' };
    expect(await code(svc.submit(IDS.alex, cmd('user.registered', { userId: 'u-x', displayName: 'X', locale: 'en' })))).toBe('NOT_AUTHORISED');
    expect(await code(svc.submit(IDS.alex, cmd('proposal.created', { proposalId: 'pr1', projectId: P, kind: 'ext', title: 'x', via })))).toBe('NOT_AUTHORISED');
    expect(await code(svc.submit(IDS.alex, cmd('handoff.context_fetched', { handoffId: 'h', version: 1, client: null })))).toBe('NOT_AUTHORISED');
    expect(
      await code(svc.submit(IDS.alex, cmd('artifactVersion.derived', { artifactId: 'a', versionId: 'v', status: 'ready', pageHashes: [], texts: [], error: null, converter: null }))),
    ).toBe('NOT_AUTHORISED');
    expect(await code(svc.submit(IDS.alex, cmd('work.recorded', { ...make.work('w-mcp', P, 'n1', 'via MCP').payload, via })))).toBe('NOT_AUTHORISED');
    expect(await code(svc.submit('system:office', make.work('w-sys', P, 'n1', 'as the service')))).toBe('NOT_AUTHORISED');
    expect(svc.head).toBe(head);
    expect((await svc.submit(IDS.alex, cmd('work.recorded', { ...make.work('w-app', P, 'n1', 'from the app').payload, via: null }))).status).toBe('accepted');

    // In-process callers (S's endpoints, the sample loader) may.
    const w = await svc.appendTrusted(IDS.alex, cmd('work.recorded', { ...make.work('w-mcp', P, 'n1', 'via MCP').payload, via }));
    expect(w.status).toBe('accepted');
    expect(svc.current.work['w-mcp']?.via).toEqual(via);
    expect((await svc.appendTrusted(IDS.alex, cmd('proposal.created', { proposalId: 'pr1', projectId: P, kind: 'ext', title: 'from MCP', via }))).status).toBe('accepted');
    expect((await svc.appendTrusted('system', cmd('user.registered', { userId: 'u-new', displayName: 'New', locale: 'en' }))).status).toBe('accepted');
    expect(await code(svc.appendTrusted(IDS.alex, { id: randomUUID(), type: 'no.such' as never, payload: {} }))).toBe('UNKNOWN_EVENT_TYPE');
    // The snapshot fill is the same for trusted appends.
    const s = await svc.appendTrusted(IDS.alex, cmd('need.shared', { needId: 'np2', snapshot: { need: svc.current.needs['n1']!, work: [] } }));
    expect(s.event.type === 'need.shared' && s.event.payload.snapshot?.need.id).toBe('np2');
    expect(s.event.type === 'need.shared' && s.event.payload.snapshot?.work.map((x) => x.id)).toEqual(['wp2']);
  });

  it('a private input’s blob is readable only by its owner until the input is shared', async () => {
    await privateWork();
    const bytes = new TextEncoder().encode(`minutes: ${SECRET}`);
    const hash = sha256(bytes);
    expect((await svc.putBlob(IDS.alex, hash, bytes, 'text/markdown')).created).toBe(true);
    expect(await code(svc.putBlob(IDS.alex, hash, new TextEncoder().encode('tampered'), 'text/plain'))).toBe('INVALID_CONTENT_HASH');
    await svc.submit(
      IDS.alex,
      cmd('input.imported', { inputId: 'in1', projectId: P, kind: 'md', title: 'My notes.md', date: TODAY, blobHash: hash, body: [{ id: 'p1', text: SECRET }], extracts: [], detector: 'rules/1', private: true }),
    );
    expect(await svc.canReadBlob(IDS.alex, hash)).toBe(true);
    expect(await svc.canReadBlob(IDS.lin, hash)).toBe(false);
    expect(await svc.canReadBlob(IDS.eve, hash)).toBe(false);

    const r = await svc.submit(IDS.alex, cmd('input.shared', { inputId: 'in1' }));
    expect(r.event.type === 'input.shared' && r.event.payload.snapshot?.input).toMatchObject({ id: 'in1', blobHash: hash });
    expect(await svc.canReadBlob(IDS.lin, hash)).toBe(true);
    expect(await svc.canReadBlob(IDS.eve, hash)).toBe(false);
    expect(replay(svc.eventsFor(IDS.lin, 0).events).inputs['in1']).toEqual(svc.view(IDS.lin).inputs['in1']);
  });

  it('a private artifact’s file and preview pages are readable only by its owner until it is shared', async () => {
    await privateWork();
    const file = new TextEncoder().encode('%PDF private draft');
    const page = new TextEncoder().encode('PNG page 1');
    await svc.putBlob(IDS.alex, sha256(file), file, 'application/pdf');
    const pageHash = await svc.putDerivedBlob('system:office', page, 'image/png');
    await svc.submit(IDS.alex, cmd('artifact.created', { artifactId: 'a1', projectId: P, kind: 'pdf', title: 'Draft', where: 'local', needIds: [], private: true }));
    await svc.submit(IDS.alex, cmd('artifact.version_added', { artifactId: 'a1', versionId: 'v1', label: 'v1', date: TODAY, note: '', blobHash: sha256(file), mediaType: 'application/pdf' }));
    await svc.appendSystem('system:office', cmd('artifactVersion.derived', { artifactId: 'a1', versionId: 'v1', status: 'ready', pageHashes: [pageHash], texts: ['p1'], error: null, converter: 'test' }));
    for (const h of [sha256(file), pageHash]) {
      expect(await svc.canReadBlob(IDS.alex, h)).toBe(true);
      expect(await svc.canReadBlob(IDS.lin, h)).toBe(false);
    }
    const r = await svc.submit(IDS.alex, cmd('artifact.shared', { artifactId: 'a1' }));
    expect(r.event.type === 'artifact.shared' && r.event.payload.snapshot?.artifact.versions[0]?.derived?.pageHashes).toEqual([pageHash]);
    for (const h of [sha256(file), pageHash]) expect(await svc.canReadBlob(IDS.lin, h)).toBe(true);
    expect(await svc.canReadBlob(IDS.eve, pageHash)).toBe(false);
    expect(replay(svc.eventsFor(IDS.lin, 0).events).artifacts['a1']).toEqual(svc.view(IDS.lin).artifacts['a1']);
  });

  it('a command may attach only a blob its actor uploaded or can already read', async () => {
    await privateWork();
    const bytes = new TextEncoder().encode(`minutes: ${SECRET}`);
    const hash = sha256(bytes);
    await svc.putBlob(IDS.alex, hash, bytes, 'text/markdown');
    await svc.submit(IDS.alex, cmd('input.imported', { inputId: 'in1', projectId: P, kind: 'md', title: 'My notes.md', date: TODAY, blobHash: hash, body: [], extracts: [], detector: 'rules/1', private: true }));
    await svc.submit(IDS.lin, cmd('artifact.created', { artifactId: 'a-lin', projectId: P, kind: 'pdf', title: 'Lin draft', where: 'local', needIds: [] }));
    const head = svc.head;
    // Lin knows the hash of Alex's private file but has neither uploaded it nor can read it.
    const attach = (id: string, h: string) => cmd('artifact.version_added', { artifactId: 'a-lin', versionId: id, label: id, date: TODAY, note: '', blobHash: h });
    expect(await code(svc.submit(IDS.lin, attach('v1', hash)))).toBe('NOT_AUTHORISED');
    expect(await code(svc.appendTrusted(IDS.lin, attach('v1', hash)))).toBe('NOT_AUTHORISED');
    expect(await code(svc.submit(IDS.lin, cmd('input.imported', { inputId: 'in-lin', projectId: P, kind: 'md', title: 'x', date: TODAY, blobHash: hash, body: [], extracts: [], detector: 'rules/1' })))).toBe('NOT_AUTHORISED');
    expect(await code(svc.submit(IDS.lin, attach('v2', `sha256:${'0'.repeat(64)}`)))).toBe('NOT_AUTHORISED');
    expect(svc.head).toBe(head);
    expect(await svc.canReadBlob(IDS.lin, hash)).toBe(false);

    // Once Alex shares the input, Lin can read the file and so may attach it.
    await svc.submit(IDS.alex, cmd('input.shared', { inputId: 'in1' }));
    expect((await svc.submit(IDS.lin, attach('v1', hash))).status).toBe('accepted');
    // Her own upload is always attachable.
    const own = new TextEncoder().encode('lin draft v2');
    await svc.putBlob(IDS.lin, sha256(own), own, 'application/pdf');
    expect((await svc.submit(IDS.lin, attach('v2', sha256(own)))).status).toBe('accepted');
  });

  it('opening a log with an unknown event type fails and names the type', async () => {
    const old = new MemoryEventStore();
    await old.append('team', 'e1', 0, (ctx) => ({
      event: { seq: ctx.seq, id: 'e1', type: 'user.registered', actorId: 'system', recordedAt: ctx.recordedAt, payload: { userId: 'u-old', displayName: 'Old', locale: 'en' } } as DomainEvent,
      projectId: null,
      privateTo: null,
    }));
    await old.append('team', 'e2', 1, (ctx) => ({
      event: { seq: ctx.seq, id: 'e2', type: 'requirement.created', actorId: 'u-old', recordedAt: ctx.recordedAt, payload: {} } as unknown as DomainEvent,
      projectId: 'P-old',
      privateTo: null,
    }));
    const opening = SyncService.open({ store: old, blobMeta, blobFiles: new BlobFiles(dir.path), devUsers: DEFAULT_DEV_USERS });
    await expect(opening).rejects.toThrow('event 2 has type requirement.created, unknown to this version; this schema predates this version, reset it');
    // Nothing was written: the dev users were not registered.
    expect(await old.head('team')).toBe(2);
  });

  it('opening a log with an event that no longer replays fails, names it and tells the user to reset the schema', async () => {
    const old = new MemoryEventStore();
    await old.append('team', 'e1', 0, (ctx) => ({
      event: { seq: ctx.seq, id: 'e1', type: 'user.registered', actorId: 'system', recordedAt: ctx.recordedAt, payload: { userId: 'u-old', displayName: 'Old', locale: 'en' } } as DomainEvent,
      projectId: null,
      privateTo: null,
    }));
    // A need in a project the log never created: this version's core refuses it.
    await old.append('team', 'e2', 1, (ctx) => ({
      event: { seq: ctx.seq, id: 'e2', type: 'need.created', actorId: 'u-old', recordedAt: ctx.recordedAt, payload: { needId: 'n', projectId: 'P-gone', kind: 'ext', title: 'x', roundId: null, source: { src: 'doc', date: '2026-11-24', quote: '', ref: '' } } } as DomainEvent,
      projectId: 'P-gone',
      privateTo: null,
    }));
    const opening = SyncService.open({ store: old, blobMeta, blobFiles: new BlobFiles(dir.path), devUsers: DEFAULT_DEV_USERS });
    await expect(opening).rejects.toThrow('event 2 (need.created) does not replay on this version: NOT_FOUND: project P-gone not found; this schema predates this version, reset it');
    expect(await old.head('team')).toBe(2);
  });

  it('opening a log whose stored scope differs from the scope rules fails, names the seq and both scopes, and writes nothing (M2)', async () => {
    const old = new MemoryEventStore();
    const put = (seq: number, type: string, actorId: string, payload: unknown, projectId: string | null, privateTo: string | null) =>
      old.append('team', `e${seq}`, seq - 1, (ctx) => ({ event: { seq: ctx.seq, id: `e${seq}`, type, actorId, recordedAt: ctx.recordedAt, payload } as DomainEvent, projectId, privateTo }));
    await put(1, 'user.registered', 'system', { userId: 'u-old', displayName: 'Old', locale: 'en' }, null, null);
    await put(2, 'project.created', 'u-old', { projectId: 'P-old', name: 'Old' }, 'P-old', null);
    // A private need stored as if it were shared (a bug in an older scope rule): every member would receive it.
    const need = { needId: 'n-old', projectId: 'P-old', kind: 'ext', title: 'Private draft', roundId: null, private: true, source: { src: 'doc', date: '2026-11-24', quote: '', ref: '' } };
    await put(3, 'need.created', 'u-old', need, 'P-old', null);
    const opening = SyncService.open({ store: old, blobMeta, blobFiles: new BlobFiles(dir.path), devUsers: DEFAULT_DEV_USERS });
    await expect(opening).rejects.toThrow(
      'event 3 (need.created): stored scope project=P-old privateTo=null differs from the computed scope project=P-old privateTo=u-old; this schema predates privacy scopes, reset it',
    );
    expect(await old.head('team')).toBe(3);

    // The same log with the right scope opens.
    const good = new MemoryEventStore();
    for (const se of (await old.readAfter('team', 0)).map((x, i) => (i === 2 ? { ...x, privateTo: 'u-old' } : x))) await good.append('team', se.event.id, se.event.seq - 1, () => se);
    const svc2 = await SyncService.open({ store: good, blobMeta, blobFiles: new BlobFiles(dir.path), devUsers: DEFAULT_DEV_USERS });
    expect(svc2.current.needs['n-old']!.privateTo).toBe('u-old');
  });

  it('flags a cursor from another log', async () => {
    expect(svc.eventsFor(IDS.lin, svc.head + 5).reset).toBe(true);
    expect(svc.eventsFor(IDS.lin, -1).reset).toBe(true);
    expect(svc.eventsFor(IDS.lin, 2, 10, 'other-log').reset).toBe(true);
    expect(svc.eventsFor(IDS.lin, 2, 10, svc.epoch).reset).toBe(false);
    expect(viewFor(svc.current, IDS.lin)).toEqual(svc.view(IDS.lin));
  });
});
