import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { CommitInfo, DiffFile, RepoInfo } from './bridge';

/**
 * Local git access for code versions. Runs ONLY in the main process (or the dev
 * bridge host). The renderer never sees a local path: it gets a repo id plus
 * the scoped data it asked for (log, a diff, a file range, a snapshot). Every
 * repository was explicitly chosen by the user (PRD §11.3); commits and paths
 * are validated before they reach git, and git runs without a shell.
 */
export const LIMITS = { files: 60, fileBytes: 200 * 1024, patchBytes: 100 * 1024, tree: 3000, logMax: 200 };

/**
 * The JSON shape uploaded as a blob by `ClientNode.repoSnapshot` (media type
 * `application/vnd.meetless.code-snapshot+json`). Opaque to the server; not
 * part of `@meetless/core` since it never appears in an event payload.
 */
export interface CodeSnapshotFile {
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | 'unchanged';
  additions: number;
  deletions: number;
  patch: string | null;
  content: string | null;
  truncated: boolean;
}

export interface CodeSnapshot {
  format: 'meetless.code-snapshot';
  formatVersion: 1;
  repo: string;
  commit: string;
  branch: string | null;
  baseCommit: string | null;
  subject: string;
  author: string;
  committedAt: string;
  tree: { path: string; size: number }[];
  files: CodeSnapshotFile[];
  truncated: boolean;
}

const COMMIT = /^[0-9a-f]{7,40}$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,200}$/;

export class GitError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * A repo the user picks can set `diff.external` or a `textconv` driver in its own `.git/config`;
 * git would run that command when we diff. Every diff and show passes these.
 */
const NO_EXT = ['--no-ext-diff', '--no-textconv'];

function git(cwd: string, args: string[], maxBuffer = 8 * 1024 * 1024): Promise<string> {
  return new Promise((res, rej) => {
    execFile('git', ['-c', 'core.quotepath=off', ...args], { cwd, maxBuffer, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout) => {
      if (err) rej(new GitError('GIT_FAILED'));
      else res(stdout);
    });
  });
}

function checkPath(p: string): string {
  if (typeof p !== 'string' || p.length === 0 || p.length > 1000 || p.includes('\0') || p.startsWith('/') || p.split('/').includes('..')) throw new GitError('BAD_PATH');
  return p;
}

const publicRemote = (url: string) => url.replace(/\/\/[^@/]+@/, '//').replace(/\.git$/, '').trim();

export class GitRepos {
  private readonly storeFile: string;
  private repos: Record<string, string>;

  constructor(dataDir: string) {
    this.storeFile = join(dataDir, 'repos.json');
    this.repos = existsSync(this.storeFile) ? (JSON.parse(readFileSync(this.storeFile, 'utf8')) as Record<string, string>) : {};
  }

  private save() {
    const tmp = `${this.storeFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.repos, null, 2));
    renameSync(tmp, this.storeFile);
  }

  private dir(id: string): string {
    const d = this.repos[id];
    if (!d) throw new GitError('REPO_NOT_REGISTERED');
    return d;
  }

  /** Registers a directory the user chose. Returns its id. */
  async register(dir: string): Promise<RepoInfo> {
    const top = (await git(dir, ['rev-parse', '--show-toplevel']).catch(() => {
      throw new GitError('NOT_A_GIT_REPO');
    })).trim();
    const id = `repo-${createHash('sha256').update(top).digest('hex').slice(0, 16)}`;
    this.repos[id] = top;
    this.save();
    return this.info(id);
  }

  async list(): Promise<RepoInfo[]> {
    const out: RepoInfo[] = [];
    for (const id of Object.keys(this.repos)) out.push(await this.info(id).catch(() => ({ id, name: '?', head: null, branch: null })));
    return out;
  }

  async info(id: string): Promise<RepoInfo> {
    const d = this.dir(id);
    const remote = await git(d, ['config', '--get', 'remote.origin.url']).catch(() => '');
    const head = (await git(d, ['rev-parse', '--verify', '--quiet', 'HEAD']).catch(() => '')).trim() || null;
    const branch = (await git(d, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => '')).trim() || null;
    return { id, name: remote.trim() ? publicRemote(remote) : basename(d), head, branch };
  }

  /** Resolves a commit-ish the renderer passed (hex id or branch name) to a full commit id. */
  async resolve(id: string, ref: string): Promise<string> {
    if (!COMMIT.test(ref) && !BRANCH.test(ref)) throw new GitError('BAD_REF');
    if (ref.startsWith('-')) throw new GitError('BAD_REF');
    const out = (await git(this.dir(id), ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).catch(() => '')).trim();
    if (!/^[0-9a-f]{40}$/.test(out)) throw new GitError('COMMIT_NOT_FOUND');
    return out;
  }

  async log(id: string, ref = 'HEAD', limit = 50): Promise<CommitInfo[]> {
    const c = await this.resolve(id, ref);
    const raw = await git(this.dir(id), ['log', `--max-count=${Math.min(Math.max(1, limit), LIMITS.logMax)}`, '--format=%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1e', c]);
    return raw
      .split('\x1e')
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => {
        const [commit, parents, author, date, subject] = r.split('\x1f');
        return { commit: commit!, parents: (parents ?? '').split(' ').filter(Boolean), author: author ?? '', date: date ?? '', subject: subject ?? '' };
      });
  }

  async diffFiles(id: string, base: string | null, head: string): Promise<DiffFile[]> {
    const h = await this.resolve(id, head);
    const b = base ? await this.resolve(id, base) : null;
    const d = this.dir(id);
    const args = b ? ['diff', ...NO_EXT, '--numstat', '-M', b, h] : ['show', ...NO_EXT, '--numstat', '--format=', h];
    const status = b ? ['diff', ...NO_EXT, '--name-status', '-M', b, h] : ['show', ...NO_EXT, '--name-status', '--format=', h];
    const [num, st] = await Promise.all([git(d, args), git(d, status)]);
    const statusOf = new Map<string, string>();
    for (const line of st.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      statusOf.set(parts[parts.length - 1]!, parts[0]![0]!);
    }
    return num
      .split('\n')
      .filter(Boolean)
      .slice(0, LIMITS.files)
      .map((line) => {
        const [a, del, ...rest] = line.split('\t');
        const path = rest.join('\t').replace(/^.*=> /, '').replace(/[{}]/g, '');
        return { path, status: statusOf.get(path) ?? 'M', additions: Number(a) || 0, deletions: Number(del) || 0 };
      });
  }

  async patch(id: string, base: string | null, head: string, path: string): Promise<{ patch: string; truncated: boolean }> {
    const h = await this.resolve(id, head);
    const b = base ? await this.resolve(id, base) : null;
    const out = await git(this.dir(id), b ? ['diff', ...NO_EXT, '-M', b, h, '--', checkPath(path)] : ['show', ...NO_EXT, '--format=', h, '--', checkPath(path)]);
    return out.length > LIMITS.patchBytes ? { patch: out.slice(0, LIMITS.patchBytes), truncated: true } : { patch: out, truncated: false };
  }

  async file(id: string, commit: string, path: string): Promise<{ content: string | null; truncated: boolean }> {
    const c = await this.resolve(id, commit);
    const buf = await git(this.dir(id), ['show', ...NO_EXT, `${c}:${checkPath(path)}`], 32 * 1024 * 1024).catch(() => null);
    if (buf === null) return { content: null, truncated: false };
    if (buf.includes('\0')) return { content: null, truncated: false };
    return buf.length > LIMITS.fileBytes ? { content: buf.slice(0, LIMITS.fileBytes), truncated: true } : { content: buf, truncated: false };
  }

  /**
   * Builds the code snapshot of `commit` vs `base` (default: first parent). Changed
   * files with their patch and content, plus pinned `paths`. Limits are reported.
   */
  async snapshot(id: string, commit: string, base: string | null | undefined, paths: string[] = []): Promise<CodeSnapshot> {
    const info = await this.info(id);
    const c = await this.resolve(id, commit);
    const [meta] = await this.log(id, c, 1);
    const b = base === undefined ? (meta?.parents[0] ?? null) : base ? await this.resolve(id, base) : null;
    const d = this.dir(id);
    const treeRaw = await git(d, ['ls-tree', '-r', '-l', c]);
    const treeAll = treeRaw
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [left, path] = l.split('\t');
        const size = Number(left!.trim().split(/\s+/)[3]) || 0;
        return { path: path!, size };
      });
    let truncated = treeAll.length > LIMITS.tree;
    const changed = b ? await this.diffFiles(id, b, c) : treeAll.slice(0, LIMITS.files).map((t) => ({ path: t.path, status: 'A', additions: 0, deletions: 0 }));
    if (!b && treeAll.length > LIMITS.files) truncated = true;
    const want = new Map<string, DiffFile>();
    for (const f of changed) want.set(f.path, f);
    for (const p of paths) if (!want.has(checkPath(p))) want.set(p, { path: p, status: 'unchanged', additions: 0, deletions: 0 });
    const files: CodeSnapshotFile[] = [];
    for (const f of [...want.values()].slice(0, LIMITS.files)) {
      const deleted = f.status === 'D';
      const content = deleted ? { content: null, truncated: false } : await this.file(id, c, f.path);
      const patch = b && f.status !== 'unchanged' ? await this.patch(id, b, c, f.path) : null;
      if (!b && content.content !== null) f.additions = content.content.split('\n').length;
      files.push({
        path: f.path,
        status: (['A', 'M', 'D', 'R'].includes(f.status) ? f.status : f.status === 'unchanged' ? 'unchanged' : 'M') as CodeSnapshotFile['status'],
        additions: f.additions,
        deletions: f.deletions,
        patch: patch?.patch ?? null,
        content: content.content,
        truncated: content.truncated || !!patch?.truncated,
      });
    }
    if (want.size > LIMITS.files) truncated = true;
    return {
      format: 'meetless.code-snapshot',
      formatVersion: 1,
      repo: info.name,
      commit: c,
      branch: info.branch,
      baseCommit: b,
      subject: meta?.subject ?? '',
      author: meta?.author ?? '',
      committedAt: meta?.date ?? '',
      tree: treeAll.slice(0, LIMITS.tree),
      files,
      truncated,
    };
  }
}
