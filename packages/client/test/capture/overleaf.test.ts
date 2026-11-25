/**
 * U3-owned. T2: Overleaf through its git URL, with the token kept only on
 * this machine. Tests clone/pull a local bare repo (never git.overleaf.com)
 * and prove the token never reaches the clone, the log, or a bridge result.
 */
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_METHODS, type CommandInput } from '../../src/bridge';
import { CaptureError, CaptureService } from '../../src/capture';
import { gitAuthEnv, OVERLEAF_DEFAULT_SUBJECT, overleafUrlAllowed } from '../../src/capture/git-source';
import { GitRepos } from '../../src/git';
import { ClientNode } from '../../src/node';
import { a, apply, id, s } from './fixture';

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

/** A fresh working clone of `bareDir`, cloned over the filesystem (never a network call). */
function cloneWork(bareDir: string): string {
  const work = dir('meetless-overleaf-work-');
  execFileSync('git', ['clone', '-q', bareDir, work], { env: GIT_ENV, stdio: 'ignore' });
  return work;
}

/** Writes `content` to `fileName` in `work`, commits with `subject`, and pushes it to `origin`. */
function pushCommit(work: string, subject: string, fileName: string, content: string): void {
  writeFileSync(join(work, fileName), content);
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', subject);
  git(work, 'push', '-q', 'origin', 'HEAD');
}

/**
 * A throw-away bare repo (`git init --bare`), standing in for "Overleaf": a
 * local git remote the tests never reach over the network. Seeded with two
 * commits, both subjected like Overleaf's own autosave commits (dropped as a
 * capture candidate); the second adds a line matching need N1 by keywords.
 */
function makeOverleafBareRepo(): string {
  const bare = dir('meetless-overleaf-bare-');
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  const work = cloneWork(bare);
  pushCommit(work, 'Update on Overleaf.', 'README.md', 'intro\n');
  pushCommit(work, 'Update on Overleaf.', 'paper.tex', '\\section{Export date range filter}\n');
  return bare;
}

/** Pushes one more commit to an already-seeded bare repo, to test a later pull. */
function pushMoreCommits(bareDir: string, subject: string, content: string): void {
  const work = cloneWork(bareDir);
  pushCommit(work, subject, 'paper.tex', content);
}

let seq = 0;
function acceptingSubmit() {
  return vi.fn(async (_cmd: CommandInput) => ({ kind: 'accepted' as const, seq: ++seq }));
}

/** Every file under `root` whose bytes contain `needle`, as paths relative to `root`. */
function filesContaining(root: string, needle: string): string[] {
  const want = Buffer.from(needle);
  const out: string[] = [];
  const walk = (abs: string, rel: string) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const childAbs = join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else {
        try {
          if (readFileSync(childAbs).includes(want)) out.push(childRel);
        } catch {
          // unreadable (permissions, a dangling symlink): not a leak we can read either
        }
      }
    }
  };
  walk(root, '');
  return out.sort();
}

describe('git-source: Overleaf helpers', () => {
  it('overleafUrlAllowed always allows the Overleaf git URL, and a local path only on dev-bridge', () => {
    expect(overleafUrlAllowed('https://git.overleaf.com/abc123', 'electron')).toBe(true);
    expect(overleafUrlAllowed('https://git.overleaf.com/abc123', 'dev-bridge')).toBe(true);
    expect(overleafUrlAllowed('/tmp/some/repo', 'electron')).toBe(false);
    expect(overleafUrlAllowed('/tmp/some/repo', 'dev-bridge')).toBe(true);
    expect(overleafUrlAllowed('file:///tmp/some/repo', 'dev-bridge')).toBe(true);
    expect(overleafUrlAllowed('not a url', 'dev-bridge')).toBe(false);
  });

  it('gitAuthEnv carries the token only as a Basic auth header, via GIT_CONFIG_*; null is {}', () => {
    expect(gitAuthEnv(null)).toEqual({});
    expect(gitAuthEnv('tok-123')).toEqual({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://git.overleaf.com/.extraHeader',
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from('git:tok-123').toString('base64')}`,
    });
  });

  it('OVERLEAF_DEFAULT_SUBJECT matches Overleaf\'s own autosave commit subject, with or without the period', () => {
    expect(OVERLEAF_DEFAULT_SUBJECT.test('Update on Overleaf.')).toBe(true);
    expect(OVERLEAF_DEFAULT_SUBJECT.test('update on overleaf')).toBe(true);
    expect(OVERLEAF_DEFAULT_SUBJECT.test('Update on Overleaf: added intro')).toBe(false);
  });
});

describe('CaptureService.syncOverleaf / run (Overleaf)', () => {
  it('syncs a local bare repo on the dev-bridge host and captures added lines that match a need', async () => {
    const bareDir = makeOverleafBareRepo();
    const dataDir = dir('meetless-overleaf-svc-');
    const repos = new GitRepos(dataDir);
    const submit = acceptingSubmit();
    const service = new CaptureService({ dataDir, submit, repos, host: 'dev-bridge' });

    const st = apply(s, 'u-alex', { id: 'add-ov-1', type: 'artifact.created', payload: { artifactId: 'a-ov1', projectId: 'p1', kind: 'overleaf', title: 'Paper', where: 'Overleaf', url: bareDir, needIds: [] } });

    const res = await service.run({ state: st, me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-ov1'] });
    expect(res).toMatchObject({ recorded: 1, skipped: [] });
    expect(submit).toHaveBeenCalledTimes(1);
    const [cmd] = submit.mock.calls[0] as [CommandInput];
    expect((cmd.payload as { needId: string }).needId).toBe(id('N1'));
  });

  it('the electron host refuses a local path with bad_url and makes no git call', async () => {
    const dataDir = dir('meetless-overleaf-svc-');
    const repos = new GitRepos(dataDir);
    const submit = acceptingSubmit();
    const exec = vi.fn(async (_cwd: string, _args: string[], _env: Record<string, string>) => '');
    const service = new CaptureService({ dataDir, submit, repos, host: 'electron', exec });

    const art = { ...a('a-ov'), url: '/tmp/not-allowed-on-electron' };
    await expect(service.syncOverleaf(art)).rejects.toMatchObject({ code: 'bad_url' });
    expect(exec).not.toHaveBeenCalled();
  });

  it('an https Overleaf URL without a saved token is skipped with no_token and makes no git call', async () => {
    const dataDir = dir('meetless-overleaf-svc-');
    const repos = new GitRepos(dataDir);
    const submit = acceptingSubmit();
    const exec = vi.fn(async (_cwd: string, _args: string[], _env: Record<string, string>) => '');
    const service = new CaptureService({ dataDir, submit, repos, host: 'dev-bridge', exec });

    const art = { ...a('a-ov'), url: 'https://git.overleaf.com/abc123DEF' };
    await expect(service.syncOverleaf(art)).rejects.toMatchObject({ code: 'no_token' });
    expect(exec).not.toHaveBeenCalled();
  });

  it('passes the token to git only through GIT_CONFIG_* env', async () => {
    const dataDir = dir('meetless-overleaf-svc-');
    const repos = new GitRepos(dataDir);
    const submit = acceptingSubmit();
    const exec = vi.fn(async (_cwd: string, _args: string[], _env: Record<string, string>) => '');
    const service = new CaptureService({ dataDir, submit, repos, host: 'dev-bridge', exec });
    await service.setOverleafToken('tok-123');

    const art = { ...a('a-ov'), url: 'https://git.overleaf.com/abc123DEF' };
    await service.syncOverleaf(art).catch(() => {});

    expect(exec).toHaveBeenCalledTimes(1);
    const call = exec.mock.calls[0]!;
    expect(call[2].GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${Buffer.from('git:tok-123').toString('base64')}`);
    expect(call[1].some((arg: string) => arg.includes('tok-123'))).toBe(false);
  });

  it('the token never lands in the clone, the log or a bridge result', async () => {
    const bareDir = makeOverleafBareRepo();
    const dataDir = dir('meetless-overleaf-leak-');
    const repos = new GitRepos(dataDir);
    const submit = acceptingSubmit();
    const logLines: string[] = [];
    const service = new CaptureService({ dataDir, submit, repos, host: 'dev-bridge', log: (m) => logLines.push(m) });
    await service.setOverleafToken('tok-123');

    const st = apply(s, 'u-alex', { id: 'add-ov-2', type: 'artifact.created', payload: { artifactId: 'a-ov2', projectId: 'p1', kind: 'overleaf', title: 'Paper', where: 'Overleaf', url: bareDir, needIds: [] } });
    const res = await service.run({ state: st, me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-ov2'] });
    expect(res.skipped).toEqual([]);

    expect(filesContaining(dataDir, 'tok-123')).toEqual(['capture/secrets.json']);
    expect(logLines.length).toBeGreaterThan(0);
    expect(logLines.join('\n')).not.toContain('tok-123');
    expect(statSync(join(dataDir, 'capture', 'secrets.json')).mode & 0o777).toBe(0o600);

    const server = createServer((req, res2) => {
      if (req.method === 'GET' && req.url === '/v1/me') {
        res2.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ user: { id: 'u-alex', displayName: 'Alex' } }));
        return;
      }
      res2.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const { port } = server.address() as { port: number };

    const node = await ClientNode.open({ dataDir, host: 'dev-bridge' });
    const signedIn = await node.signIn(`http://127.0.0.1:${port}`, 'test-token');
    expect(signedIn.ok).toBe(true);

    const status = await node.captureStatus('p1');
    expect(status.ok).toBe(true);
    if (status.ok) expect(status.status.overleafToken).toBe(true);
    expect(JSON.stringify(status)).not.toContain('tok-123');
    await node.close();
  });

  it('a pull after new commits captures only the new ones', async () => {
    const bareDir = makeOverleafBareRepo();
    const dataDir = dir('meetless-overleaf-svc-');
    const repos = new GitRepos(dataDir);
    const submit = acceptingSubmit();
    const service = new CaptureService({ dataDir, submit, repos, host: 'dev-bridge' });

    const st = apply(s, 'u-alex', { id: 'add-ov-3', type: 'artifact.created', payload: { artifactId: 'a-ov3', projectId: 'p1', kind: 'overleaf', title: 'Paper', where: 'Overleaf', url: bareDir, needIds: [] } });

    const first = await service.run({ state: st, me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-ov3'] });
    expect(first.recorded).toBe(1);

    let state2 = st;
    for (const [cmd] of submit.mock.calls as [CommandInput][]) state2 = apply(state2, 'u-alex', cmd);

    pushMoreCommits(bareDir, 'Update on Overleaf.', '\\section{Group by month totals}\n');

    const second = await service.run({ state: state2, me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-ov3'] });
    expect(second.recorded).toBe(1);
    expect(submit).toHaveBeenCalledTimes(2);
    const [lastCmd] = submit.mock.calls[1] as [CommandInput];
    expect((lastCmd.payload as { needId: string }).needId).toBe(id('N2'));
  });

  it('a git authentication error maps to auth_failed', async () => {
    const dataDir = dir('meetless-overleaf-svc-');
    const repos = new GitRepos(dataDir);
    const submit = acceptingSubmit();
    const exec = vi.fn(async (_cwd: string, _args: string[], _env: Record<string, string>) => {
      throw new Error('fatal: Authentication failed for https://git.overleaf.com/abc123DEF/');
    });
    const service = new CaptureService({ dataDir, submit, repos, host: 'dev-bridge', exec });
    await service.setOverleafToken('tok-123');

    const art = { ...a('a-ov'), url: 'https://git.overleaf.com/abc123DEF' };
    await expect(service.syncOverleaf(art)).rejects.toMatchObject({ code: 'auth_failed' });
  });

  it('a plain git failure (not an auth error) maps to git_failed', async () => {
    const dataDir = dir('meetless-overleaf-svc-');
    const repos = new GitRepos(dataDir);
    const submit = acceptingSubmit();
    const exec = vi.fn(async (_cwd: string, _args: string[], _env: Record<string, string>) => {
      throw new Error('fatal: repository not found');
    });
    const service = new CaptureService({ dataDir, submit, repos, host: 'dev-bridge', exec });

    const art = { ...a('a-ov'), url: '/tmp/does-not-exist-anyway' };
    await expect(service.syncOverleaf(art)).rejects.toMatchObject({ code: 'git_failed' });
  });

  it('an unreachable artifact with an empty url is skipped with no_url', async () => {
    const dataDir = dir('meetless-overleaf-svc-');
    const repos = new GitRepos(dataDir);
    const submit = acceptingSubmit();
    const service = new CaptureService({ dataDir, submit, repos, host: 'dev-bridge' });

    await expect(service.syncOverleaf(a('a-ov'))).rejects.toMatchObject({ code: 'no_url' });
  });

  it('clearing the token removes it from secrets.json', async () => {
    const dataDir = dir('meetless-overleaf-svc-');
    const repos = new GitRepos(dataDir);
    const submit = acceptingSubmit();
    const service = new CaptureService({ dataDir, submit, repos, host: 'dev-bridge' });

    await service.setOverleafToken('tok-123');
    const secretsFile = join(dataDir, 'capture', 'secrets.json');
    expect(JSON.parse(readFileSync(secretsFile, 'utf8'))).toMatchObject({ overleafToken: 'tok-123' });

    await service.setOverleafToken('');
    expect(JSON.parse(readFileSync(secretsFile, 'utf8')).overleafToken).toBeUndefined();

    await service.setOverleafToken('tok-456');
    await service.setOverleafToken(null);
    expect(JSON.parse(readFileSync(secretsFile, 'utf8')).overleafToken).toBeUndefined();
  });

  it('secrets.json is created at mode 0600 even under a permissive umask (R16)', async () => {
    const dataDir = dir('meetless-overleaf-svc-');
    const repos = new GitRepos(dataDir);
    const submit = acceptingSubmit();
    const service = new CaptureService({ dataDir, submit, repos, host: 'dev-bridge' });

    const prevUmask = process.umask(0o022);
    try {
      await service.setOverleafToken('tok-789');
    } finally {
      process.umask(prevUmask);
    }
    expect(statSync(join(dataDir, 'capture', 'secrets.json')).mode & 0o777).toBe(0o600);
  });

  it('status reports the overleaf kind, ready once synced, and the last failure code otherwise', async () => {
    const bareDir = makeOverleafBareRepo();
    const dataDir = dir('meetless-overleaf-svc-');
    const repos = new GitRepos(dataDir);
    const submit = acceptingSubmit();
    const service = new CaptureService({ dataDir, submit, repos, host: 'dev-bridge' });

    const okArt = { ...a('a-ov'), url: bareDir };
    let st = await service.status(s, 'u-alex', 'p1');
    expect(st.sources.find((x) => x.artifactId === 'a-ov')).toMatchObject({ kind: 'overleaf', ready: false, repo: null });
    const synced = await service.syncOverleaf(okArt);
    st = await service.status(s, 'u-alex', 'p1');
    expect(st.sources.find((x) => x.artifactId === 'a-ov')).toMatchObject({ kind: 'overleaf', ready: true, code: null });
    // The synced clone is reported as the source's repo, so the UI lists its commits.
    expect(st.sources.find((x) => x.artifactId === 'a-ov')?.repo?.id).toBe(synced.repo.id);

    // A later sync fails (bad url); `ready` stays true (it synced at least once), `code` reports the failure.
    const badArt = { ...a('a-ov'), url: 'nope not a url' };
    await service.syncOverleaf(badArt).catch(() => {});
    st = await service.status(s, 'u-alex', 'p1');
    expect(st.sources.find((x) => x.artifactId === 'a-ov')).toMatchObject({ kind: 'overleaf', ready: true, code: 'bad_url' });
  });

  it('concurrent syncs of one artifact share one git call and one result (I4)', async () => {
    const bareDir = makeOverleafBareRepo();
    const dataDir = dir('meetless-overleaf-svc-');
    const repos = new GitRepos(dataDir);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const exec = vi.fn(async (cwd: string, args: string[], env: Record<string, string>) => {
      await gate;
      return execFileSync('git', args, { cwd, env: { ...GIT_ENV, ...env }, encoding: 'utf8' });
    });
    const service = new CaptureService({ dataDir, submit: acceptingSubmit(), repos, host: 'dev-bridge', exec });
    const art = { ...a('a-ov'), url: bareDir };

    // A double click on Sync, plus a capture run that syncs first: three callers, one clone.
    const first = service.syncOverleaf(art);
    const second = service.syncOverleaf(art);
    const run = service.run({ state: { ...s, artifacts: { ...s.artifacts, 'a-ov': art } }, me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-ov'] });
    release();
    const [r1, r2, res] = await Promise.all([first, second, run]);
    expect(r2).toEqual(r1);
    expect(res.skipped).toEqual([]);
    expect(exec.mock.calls.filter(([, args]) => args[0] === 'clone' || args[0] === 'pull')).toHaveLength(1);
    const st = await service.status(s, 'u-alex', 'p1');
    expect(st.sources.find((x) => x.artifactId === 'a-ov')).toMatchObject({ ready: true, code: null });

    // Once settled, the next sync runs again (a pull).
    await service.syncOverleaf(art);
    expect(exec.mock.calls.filter(([, args]) => args[0] === 'clone' || args[0] === 'pull')).toHaveLength(2);
  });

  it('the bridge lists the overleaf methods', () => {
    expect(BRIDGE_METHODS).toEqual(expect.arrayContaining(['overleafSetToken', 'overleafSync']));
  });

  it('a signed-out node answers not_signed_in for both overleaf bridge methods', async () => {
    const dataDir = dir('meetless-overleaf-node-');
    const node = await ClientNode.open({ dataDir, host: 'dev-bridge' });
    expect(await node.overleafSetToken('tok-123')).toEqual({ ok: false, code: 'not_signed_in' });
    expect(await node.overleafSync('a-ov')).toEqual({ ok: false, code: 'not_signed_in' });
    await node.close();
  });
});

describe('CaptureError (Overleaf codes)', () => {
  it('carries its code as a plain property', () => {
    const e = new CaptureError('auth_failed');
    expect(e.code).toBe('auth_failed');
    expect(e).toBeInstanceOf(Error);
  });
});
