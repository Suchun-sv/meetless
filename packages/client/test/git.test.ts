import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitError, GitRepos } from '../src/index';

/** Local git access for code versions: scoped results, validated inputs, no local paths leak. */
let root: string;
let repo: string;
const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=Ben', '-c', 'user.email=ben@example.invalid', ...a], { cwd: repo, encoding: 'utf8' }).trim();

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'meetless-git-'));
  repo = join(root, 'crm-service');
  mkdirSync(join(repo, 'src'), { recursive: true });
  g('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'src/export.ts'), "export const EXPORT_FIELDS = ['name', 'phone'];\n");
  g('add', '.');
  g('commit', '-q', '-m', 'export v1');
  writeFileSync(join(repo, 'src/export.ts'), "export const EXPORT_FIELDS = ['name', 'phone', 'email'];\n// 12 core fields\n");
  g('commit', '-q', '-am', 'export v2');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('GitRepos', () => {
  it('registers a chosen repo by id and never exposes its path', async () => {
    const repos = new GitRepos(root);
    const info = await repos.register(join(repo, 'src'));
    expect(info).toMatchObject({ name: 'crm-service', branch: 'main' });
    expect(JSON.stringify(info)).not.toContain(root);
    await expect(repos.register(root)).rejects.toMatchObject({ code: 'NOT_A_GIT_REPO' });
  });

  it('log, diff and snapshot are scoped; refs and paths are validated', async () => {
    const repos = new GitRepos(root);
    const { id } = await repos.register(repo);
    const log = await repos.log(id, 'main', 10);
    expect(log.map((c) => c.subject)).toEqual(['export v2', 'export v1']);
    const files = await repos.diffFiles(id, log[1]!.commit, log[0]!.commit);
    expect(files).toEqual([{ path: 'src/export.ts', status: 'M', additions: 2, deletions: 1 }]);
    const snap = await repos.snapshot(id, log[0]!.commit.slice(0, 10), undefined);
    expect(snap).toMatchObject({ format: 'meetless.code-snapshot', commit: log[0]!.commit, baseCommit: log[1]!.commit, repo: 'crm-service', truncated: false });
    expect(snap.files[0]).toMatchObject({ path: 'src/export.ts', status: 'M' });
    expect(snap.files[0]!.content).toContain('12 core fields');
    expect(snap.files[0]!.patch).toContain("+export const EXPORT_FIELDS = ['name', 'phone', 'email'];");
    const first = await repos.snapshot(id, log[1]!.commit, undefined);
    expect(first.baseCommit).toBeNull();
    await expect(repos.resolve(id, '--output=/tmp/x')).rejects.toBeInstanceOf(GitError);
    await expect(repos.patch(id, null, log[0]!.commit, '../../etc/passwd')).rejects.toMatchObject({ code: 'BAD_PATH' });
    await expect(repos.log('repo-unknown')).rejects.toMatchObject({ code: 'REPO_NOT_REGISTERED' });
  });
});
