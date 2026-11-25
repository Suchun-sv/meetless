import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectNeeds } from '@meetless/core';
import { buildSample, loadPrototype, PROTOTYPE_FILES, sampleState } from '@meetless/sample';
import { BlobFiles, configFromEnv, DEFAULT_DEV_USERS, loadSample, MemoryBlobMetaStore, MemoryEventStore, SyncService, type Command } from '../src/index';
import { IDS, make, serverConfig, startServer, tempDir, TODAY } from './helpers';

/** The sample loader against the in-memory store double (no Postgres). */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const opts = (locale: 'zh-CN' | 'en') => ({ locale, me: IDS.alex, today: TODAY, repoRoot });

let dir: ReturnType<typeof tempDir>;
let svc: SyncService;
let clock = Date.parse('2026-11-24T09:00:00Z');

beforeEach(async () => {
  dir = tempDir('sample');
  svc = await SyncService.open({
    store: new MemoryEventStore(() => (clock += 1000)),
    blobMeta: new MemoryBlobMetaStore(),
    blobFiles: new BlobFiles(dir.path),
    devUsers: DEFAULT_DEV_USERS,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  dir.rm();
});

/** A copy of the prototype data in which Atlas's HO2 hands off a need that does not exist (N9). */
function brokenRepo(): string {
  const root = join(dir.path, 'repo');
  for (const f of PROTOTYPE_FILES) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    copyFileSync(join(repoRoot, f), join(root, f));
  }
  const collab = join(root, 'design/claude-design-v3/needs3/data-collab.js');
  const src = readFileSync(collab, 'utf8');
  if (!src.includes("{ id: 'HO2', need: 'N2'")) throw new Error('prototype changed: HO2 not found');
  writeFileSync(collab, src.replace("{ id: 'HO2', need: 'N2'", "{ id: 'HO2', need: 'N9'"));
  return root;
}

const codes = (projectId: string) => projectNeeds(svc.current, projectId).map((n) => n.code);

describe('loadSample (memory store)', () => {
  it('loads once; a second load, or a load in the other language, reports loaded:false and writes nothing', async () => {
    const before = svc.head;
    const first = await loadSample(svc, opts('zh-CN'));
    expect(first.loaded).toBe(true);
    expect(first.events).toBe(svc.head - before);
    expect(svc.current.projects['sample-paper']!.sample).toBe(true);
    expect(svc.current.projects['sample-atlas']!.sample).toBe(true);
    // The dev users were already registered: their registrations are not repeated.
    expect(svc.current.users[IDS.alex]!.displayName).toBe('Alex');
    // Same projects, needs and codes as the replayed sample.
    const expected = sampleState(opts('zh-CN')).state;
    expect(Object.keys(svc.current.needs).sort()).toEqual(Object.keys(expected.needs).sort());
    expect(codes('sample-paper')).toEqual(projectNeeds(expected, 'sample-paper').map((n) => n.code));
    expect(codes('sample-atlas')).toEqual(projectNeeds(expected, 'sample-atlas').map((n) => n.code));

    const head = svc.head;
    expect(await loadSample(svc, opts('zh-CN'))).toEqual({ loaded: false, events: 0 });
    expect(await loadSample(svc, opts('en'))).toEqual({ loaded: false, events: 0 });
    expect(svc.head).toBe(head);
    expect(svc.current.projects['sample-paper']!.name).toBe('论文：长上下文缓存压缩');
  });

  it('a log that already holds a project is left alone', async () => {
    await svc.submit(IDS.alex, make.project('P1'));
    const head = svc.head;
    const spy = vi.spyOn(svc, 'appendTrusted');
    expect(await loadSample(svc, opts('en'))).toEqual({ loaded: false, events: 0 });
    expect(spy).not.toHaveBeenCalled();
    expect(svc.head).toBe(head);
    expect(svc.current.projects['sample-paper']).toBeUndefined();
  });

  it('a failing append stops the load and names the command; a failure on the first command leaves no sample project', async () => {
    const real = svc.appendTrusted.bind(svc);
    const seen: Command[] = [];
    vi.spyOn(svc, 'appendTrusted').mockImplementation(async (actorId, cmd) => {
      seen.push(cmd);
      if (cmd.type === 'project.created') throw new Error('store down');
      return real(actorId, cmd);
    });
    await expect(loadSample(svc, opts('zh-CN'))).rejects.toThrow(/sample:1\b.*store down/);
    // Nothing is appended after the failing command.
    expect(seen.at(-1)!.type).toBe('project.created');
    expect(seen.filter((c) => c.type === 'project.created')).toHaveLength(1);
    expect(Object.keys(svc.current.projects)).toEqual([]);
  });

  it('startServer loads the sample after opening the service and before listening', async () => {
    const server = await startServer(serverConfig({ dataDir: dir.path, databaseUrl: null, sample: { locale: 'en', me: IDS.alex }, repoRoot }));
    try {
      expect(server.service.current.projects['sample-atlas']!.name).toBe('Atlas data platform Export');
    } finally {
      await server.close();
    }
  });

  it('a sample that does not replay is refused before anything is written', async () => {
    const bad = brokenRepo();
    const head = svc.head;
    const spy = vi.spyOn(svc, 'appendTrusted');
    await expect(loadSample(svc, { ...opts('zh-CN'), repoRoot: bad })).rejects.toThrow(/nothing written.*sample:\d+ \(handoff\.created\).*need sample-atlas:N9 not found/);
    expect(spy).not.toHaveBeenCalled();
    expect(svc.head).toBe(head);
    expect(Object.keys(svc.current.projects)).toEqual([]);
  });

  it('a partly loaded sample is refused, not taken for loaded', async () => {
    const actions = buildSample(loadPrototype(repoRoot), opts('zh-CN'));
    for (const { actorId, cmd } of actions.slice(0, 40)) await svc.appendTrusted(actorId, cmd);
    expect(svc.current.projects['sample-paper']).toBeDefined();
    const head = svc.head;
    const last = actions.at(-1)!.cmd.id;
    await expect(loadSample(svc, opts('zh-CN'))).rejects.toThrow(`sample data is only partly loaded (missing ${last}); reset the sample schema`);
    await expect(loadSample(svc, opts('en'))).rejects.toThrow(/only partly loaded/);
    expect(svc.head).toBe(head);
  });

  it('startServer refuses to start when the sample cannot load', async () => {
    await expect(startServer(serverConfig({ dataDir: dir.path, databaseUrl: null, sample: { locale: 'en', me: IDS.alex }, repoRoot: brokenRepo() }))).rejects.toThrow(
      /sample data does not replay, nothing written/,
    );
    await expect(startServer(serverConfig({ dataDir: dir.path, databaseUrl: null, sample: { locale: 'en', me: IDS.lin }, repoRoot }))).rejects.toThrow(/me \(u-lin\)/);
  });

  it('a me who is one of the sample people is refused before anything is written', async () => {
    const head = svc.head;
    const spy = vi.spyOn(svc, 'appendTrusted');
    for (const me of [IDS.lin, IDS.prof, IDS.ruo]) {
      await expect(loadSample(svc, { ...opts('en'), me })).rejects.toThrow(`me (${me}) is one of the sample's own people`);
    }
    expect(spy).not.toHaveBeenCalled();
    expect(svc.head).toBe(head);
  });

  it('configFromEnv reads MEETLESS_SAMPLE and MEETLESS_SAMPLE_ME', () => {
    expect(configFromEnv({}).sample).toBeNull();
    expect(configFromEnv({ MEETLESS_SAMPLE: 'zh-CN' }).sample).toEqual({ locale: 'zh-CN', me: 'u-alex' });
    expect(configFromEnv({ MEETLESS_SAMPLE: 'en', MEETLESS_SAMPLE_ME: 'u-sam' }).sample).toEqual({ locale: 'en', me: 'u-sam' });
    expect(() => configFromEnv({ MEETLESS_SAMPLE: 'fr' })).toThrow(/MEETLESS_SAMPLE/);
    expect(configFromEnv({ MEETLESS_REPO_ROOT: '/srv/meetless' }).repoRoot).toBe('/srv/meetless');
    expect(configFromEnv({}).repoRoot).toBe(repoRoot);
  });
});
