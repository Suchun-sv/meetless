import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_METHODS, type CommandInput } from '../../src/bridge';
import { CaptureService } from '../../src/capture';
import { GitRepos } from '../../src/git';
import { ClientNode } from '../../src/node';
import { apply, s } from './fixture';

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(() => {
  for (const srv of servers.splice(0)) srv.close();
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

function dir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com' };

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'ignore' });
}

/** A throw-away repo with one commit per message, newest last. */
function makeRepo(messages: string[]): string {
  const repoDir = dir('meetless-capture-repo-');
  git(repoDir, 'init', '-q', '-b', 'main');
  for (const [i, m] of messages.entries()) {
    writeFileSync(join(repoDir, 'file.txt'), `${i}\n`);
    git(repoDir, 'add', '.');
    git(repoDir, 'commit', '-q', '-m', m);
  }
  return repoDir;
}

let seq = 0;
function acceptingSubmit() {
  return vi.fn(async (_cmd: CommandInput) => ({ kind: 'accepted' as const, seq: ++seq }));
}

describe('CaptureService', () => {
  it('run on a bound local repo records commits that name or match a need, through ctx.submit', async () => {
    const repoDir = makeRepo(['N1 add filter', 'bump eslint', 'export date range filter']);
    const dataDir = dir('meetless-capture-svc-');
    const repos = new GitRepos(dataDir);
    const repoId = (await repos.register(repoDir)).id;
    const submit = acceptingSubmit();
    const service = new CaptureService({ dataDir, submit, repos, host: 'dev-bridge' });
    await service.bindRepo('a-code', repoId);

    const res = await service.run({ state: s, me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-code'] });
    expect(res).toMatchObject({ read: 3, recorded: 2, queued: 0, rejected: [], skipped: [] });
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('a second run with no new commits records nothing', async () => {
    const repoDir = makeRepo(['N1 add filter', 'bump eslint', 'export date range filter']);
    const dataDir = dir('meetless-capture-svc-');
    const repos = new GitRepos(dataDir);
    const repoId = (await repos.register(repoDir)).id;
    const submit = acceptingSubmit();
    const service = new CaptureService({ dataDir, submit, repos, host: 'dev-bridge' });
    await service.bindRepo('a-code', repoId);

    const first = await service.run({ state: s, me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-code'] });
    expect(first.recorded).toBe(2);

    // Apply what was actually submitted, so the second run's state already has those work items.
    let state2 = s;
    for (const [cmd] of submit.mock.calls as [CommandInput][]) state2 = apply(state2, 'u-alex', cmd);

    const second = await service.run({ state: state2, me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-code'] });
    expect(second.recorded).toBe(0);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('uploaded versions are read from derived texts; a version without text uses its note', async () => {
    const dataDir = dir('meetless-capture-svc-');
    const repos = new GitRepos(dataDir);
    const submit = acceptingSubmit();
    const service = new CaptureService({ dataDir, submit, repos, host: 'dev-bridge' });

    let st = apply(s, 'u-alex', { id: 'add-artifact', type: 'artifact.created', payload: { artifactId: 'a-doc2', projectId: 'p1', kind: 'docx', title: 'Notes only', where: 'Upload', needIds: [] } });
    st = apply(st, 'u-alex', {
      id: 'add-version',
      type: 'artifact.version_added',
      payload: { artifactId: 'a-doc2', versionId: 'v-notes', label: 'v1', date: '2026-11-22', note: 'export date range filter done' },
    });

    const res = await service.run({ state: st, me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-doc', 'a-doc2'] });
    // a-doc: note ("intro notes", no match) + 2 derived texts (one matches N2) = 3 read, 1 recorded.
    // a-doc2: note only, matches N1 = 1 read, 1 recorded.
    expect(res).toMatchObject({ read: 4, recorded: 2, queued: 0, rejected: [], skipped: [] });
    const texts = (submit.mock.calls as [CommandInput][]).map(([cmd]) => (cmd.payload as { text: string }).text);
    expect(texts.some((t) => t.includes('monthly totals'))).toBe(true);
    expect(texts.some((t) => t.includes('export date range filter done'))).toBe(true);
  });

  it('skips an unbound code artifact with no_repo and an unknown id with not_found', async () => {
    const dataDir = dir('meetless-capture-svc-');
    const repos = new GitRepos(dataDir);
    const submit = acceptingSubmit();
    const service = new CaptureService({ dataDir, submit, repos, host: 'dev-bridge' });

    const res = await service.run({ state: s, me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-code', 'nope'] });
    expect(res.skipped).toEqual([
      { artifactId: 'a-code', code: 'no_repo' },
      { artifactId: 'nope', code: 'not_found' },
    ]);
    expect(submit).not.toHaveBeenCalled();
  });

  it('a bound repo whose directory was deleted is skipped with git_failed', async () => {
    const repoDir = makeRepo(['first commit']);
    const dataDir = dir('meetless-capture-svc-');
    const repos = new GitRepos(dataDir);
    const repoId = (await repos.register(repoDir)).id;
    const submit = acceptingSubmit();
    const service = new CaptureService({ dataDir, submit, repos, host: 'dev-bridge' });
    await service.bindRepo('a-code', repoId);

    // The repo directory disappears (moved, deleted, cleaned up) after it was bound.
    rmSync(repoDir, { recursive: true, force: true });

    const res = await service.run({ state: s, me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-code'] });
    expect(res.skipped).toEqual([{ artifactId: 'a-code', code: 'git_failed' }]);
    expect(submit).not.toHaveBeenCalled();
  });

  it('status lists one source per visible artifact with its readiness', async () => {
    const dataDir = dir('meetless-capture-svc-');
    const repos = new GitRepos(dataDir);
    const submit = acceptingSubmit();
    const service = new CaptureService({ dataDir, submit, repos, host: 'dev-bridge' });

    const st = await service.status(s, 'u-alex', 'p1');
    expect(st.sources.find((x) => x.artifactId === 'a-doc')).toMatchObject({ kind: 'upload', ready: true, code: null });
    expect(st.sources.find((x) => x.artifactId === 'a-code')).toMatchObject({ kind: 'repo', ready: false, code: 'no_repo' });
    expect(st.sources.find((x) => x.artifactId === 'a-priv')).toMatchObject({ kind: 'upload', ready: false, code: 'no_versions' });
    expect(st.sources.find((x) => x.artifactId === 'a-ov')).toMatchObject({ kind: 'overleaf', ready: false, code: 'no_url' });
    expect(st.sources.map((x) => x.artifactId).sort()).toEqual(['a-code', 'a-doc', 'a-ov', 'a-priv']);
    expect(st.overleafToken).toBe(false);
    expect(st.notion).toBe('disconnected');
  });

  it('an Overleaf source with a link and no sync yet names the real gap, never no_url (I2)', async () => {
    const dataDir = dir('meetless-capture-svc-');
    const repos = new GitRepos(dataDir);
    const service = new CaptureService({ dataDir, submit: acceptingSubmit(), repos, host: 'electron' });
    const withUrl = (url: string | null) => ({ ...s, artifacts: { ...s.artifacts, 'a-ov': { ...s.artifacts['a-ov']!, url } } });
    const ov = async (url: string | null) => (await service.status(withUrl(url), 'u-alex', 'p1')).sources.find((x) => x.artifactId === 'a-ov');

    // An https link and no saved token: the token is what is missing.
    expect(await ov('https://git.overleaf.com/abc123DEF')).toMatchObject({ kind: 'overleaf', ready: false, code: 'no_token', syncedAt: null });
    // A link that is not an Overleaf git URL (and, on electron, not a local path either).
    expect(await ov('https://example.com/not-overleaf')).toMatchObject({ ready: false, code: 'bad_url' });
    expect(await ov('/tmp/local-path')).toMatchObject({ ready: false, code: 'bad_url' });
    // Only an empty link is no_url.
    expect(await ov(null)).toMatchObject({ ready: false, code: 'no_url' });
    expect(await ov('  ')).toMatchObject({ ready: false, code: 'no_url' });
    // With a token saved, nothing is missing: not ready (never synced), and no reason (Sync is the next step).
    await service.setOverleafToken('tok-123');
    expect(await ov('https://git.overleaf.com/abc123DEF')).toMatchObject({ ready: false, code: null });
  });

  it('a duplicate submit result is not counted as recorded (M1)', async () => {
    const dataDir = dir('meetless-capture-svc-');
    const repos = new GitRepos(dataDir);
    const submit = vi.fn(async (_cmd: CommandInput) => ({ kind: 'duplicate' as const, seq: 1 }));
    const service = new CaptureService({ dataDir, submit, repos, host: 'dev-bridge' });

    const res = await service.run({ state: s, me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-doc'] });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ recorded: 0, duplicate: 1, queued: 0, rejected: [], skipped: [] });
  });

  it('the 30-capture budget is shared across the artifacts of one run (M1)', async () => {
    const dataDir = dir('meetless-capture-svc-');
    const repos = new GitRepos(dataDir);
    const submit = acceptingSubmit();
    const service = new CaptureService({ dataDir, submit, repos, host: 'dev-bridge' });

    // Two shared docx artifacts with 20 versions each, every version note naming N1: 40 matches.
    let st = s;
    for (const art of ['a-many1', 'a-many2']) {
      st = apply(st, 'u-alex', { id: `add-${art}`, type: 'artifact.created', payload: { artifactId: art, projectId: 'p1', kind: 'docx', title: art, where: 'Upload', needIds: [] } });
      for (let i = 0; i < 20; i++) {
        st = apply(st, 'u-alex', {
          id: `add-${art}-v${i}`,
          type: 'artifact.version_added',
          payload: { artifactId: art, versionId: `${art}-v${i}`, label: `v${i}`, date: '2026-11-22', note: `N1 step ${i}` },
        });
      }
    }

    const res = await service.run({ state: st, me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-many1', 'a-many2'] });
    expect(res.read).toBe(40);
    expect(res.recorded).toBe(30);
    expect(submit).toHaveBeenCalledTimes(30);
    const byArtifact = (submit.mock.calls as [CommandInput][]).map(([cmd]) => (cmd.payload as { text: string }).text.startsWith('a-many1') ? 1 : 2);
    expect(byArtifact.filter((x) => x === 1)).toHaveLength(20);
    expect(byArtifact.filter((x) => x === 2)).toHaveLength(10);
  });

  it('bindings persist across service instances', async () => {
    const repoDir = makeRepo(['first commit']);
    const dataDir = dir('meetless-capture-svc-');
    const repos1 = new GitRepos(dataDir);
    const repoId = (await repos1.register(repoDir)).id;
    const submit = acceptingSubmit();
    const service1 = new CaptureService({ dataDir, submit, repos: repos1, host: 'dev-bridge' });
    await service1.bindRepo('a-code', repoId);

    const repos2 = new GitRepos(dataDir);
    const service2 = new CaptureService({ dataDir, submit, repos: repos2, host: 'dev-bridge' });
    const st = await service2.status(s, 'u-alex', 'p1');
    expect(st.sources.find((x) => x.artifactId === 'a-code')).toMatchObject({ kind: 'repo', ready: true, code: null });
  });

  it('the bridge lists the capture methods; a signed-out node answers not_signed_in', async () => {
    expect(BRIDGE_METHODS).toEqual(expect.arrayContaining(['captureStatus', 'captureBindRepo', 'captureRun']));
    const dataDir = dir('meetless-capture-node-');
    const node = await ClientNode.open({ dataDir, host: 'dev-bridge' });
    expect(await node.captureRun({ projectId: 'p1' })).toEqual({ ok: false, code: 'not_signed_in' });
    expect(await node.captureStatus('p1')).toEqual({ ok: false, code: 'not_signed_in' });
    expect(await node.captureBindRepo('a-code', null)).toEqual({ ok: false, code: 'not_signed_in' });
    await node.close();
  });

  it('a bridge method facing an unexpected error resolves { ok: false, ... } without throwing', async () => {
    const dataDir = dir('meetless-capture-node-');
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/v1/me') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ user: { id: 'u-alex', displayName: 'Alex' } }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const { port } = server.address() as { port: number };

    const node = await ClientNode.open({ dataDir, host: 'dev-bridge' });
    const signedIn = await node.signIn(`http://127.0.0.1:${port}`, 'test-token');
    expect(signedIn.ok).toBe(true);

    // `CaptureService`'s constructor already created `<dataDir>/capture/`. Taking away write
    // permission on it makes the next write inside it (here, `bindRepo`'s `capture.json`) throw
    // a plain fs error, not a `CaptureError` - exactly the "unexpected error" this guards against.
    const captureDir = join(dataDir, 'capture');
    chmodSync(captureDir, 0o500);
    try {
      const res = await node.captureBindRepo('a-code', 'repo-x');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(typeof res.code).toBe('string');
    } finally {
      chmodSync(captureDir, 0o700); // restore write access so afterEach can remove the tree
    }
    await node.close();
  });
});
