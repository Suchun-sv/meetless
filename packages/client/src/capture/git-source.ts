/**
 * U3-owned. The local-repo half of capture sources, plus (T2) the Overleaf
 * git half: a project's Overleaf git URL is cloned/pulled with a token kept
 * only on this machine, never written to the repo, the log or the server.
 */
import type { GitRepos } from '../git';
import type { GitExec } from '../capture';
import { commitRecords, type CaptureRecord } from './plan';
import { CAPTURE_LOG_LIMIT, OVERLEAF_GIT_URL } from './types';

/** The last `CAPTURE_LOG_LIMIT` commits of a bound repo's `HEAD`, newest first. */
export async function repoRecords(repos: GitRepos, repoId: string): Promise<CaptureRecord[]> {
  const commits = await repos.log(repoId, 'HEAD', CAPTURE_LOG_LIMIT);
  return commitRecords(commits);
}

/**
 * `OVERLEAF_GIT_URL` is always allowed. A bare absolute path or `file://` URL
 * (used by tests, and only by tests) is allowed only on the dev-bridge host:
 * the Electron host never clones an arbitrary local path.
 */
export function overleafUrlAllowed(url: string, host: 'electron' | 'dev-bridge'): boolean {
  if (OVERLEAF_GIT_URL.test(url)) return true;
  if (host !== 'dev-bridge') return false;
  return url.startsWith('file://') || url.startsWith('/');
}

/**
 * Env that makes `git` send the Overleaf token as a Basic auth header,
 * without it ever appearing in argv, a URL, or `.git/config`: `GIT_CONFIG_*`
 * only affects the one invocation it is passed to. `null` (no saved token)
 * is `{}` - plain, unauthenticated git.
 */
export function gitAuthEnv(token: string | null): Record<string, string> {
  if (!token) return {};
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://git.overleaf.com/.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`git:${token}`).toString('base64')}`,
  };
}

/** Overleaf's own commit subject for its autosave commits; dropped as a capture candidate. */
export const OVERLEAF_DEFAULT_SUBJECT = /^update on overleaf\.?$/i;

/**
 * `+` lines a commit added to tex/bib/md/txt files (never `+++` file headers),
 * trimmed, kept only from 12 characters (skips stray `+`/whitespace noise).
 */
export async function addedLines(exec: GitExec, dir: string, sha: string, max = 40): Promise<string[]> {
  const out = await exec(dir, ['show', '--format=', '--unified=0', '--no-color', '--no-ext-diff', '--no-textconv', sha, '--', '*.tex', '*.bib', '*.md', '*.txt'], {});
  const lines: string[] = [];
  for (const raw of out.split('\n')) {
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
    const line = raw.slice(1).trim();
    if (line.length < 12) continue;
    lines.push(line);
    if (lines.length >= max) break;
  }
  return lines;
}
