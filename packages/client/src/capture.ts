/**
 * U3-owned. The capture service: rule-based capture of commits (bound local
 * repos, and T2's Overleaf git projects), uploaded versions and Notion pages
 * (T3, read live through the Notion MCP with the user's own OAuth) into
 * `work.recorded`, plus the per-artifact status the UI shows.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Artifact, Id, IsoDate, IsoTime, State } from '@meetless/core';
import type { CommandInput, CommitInfo, RepoInfo, SubmitResult } from './bridge';
import { addedLines, gitAuthEnv, OVERLEAF_DEFAULT_SUBJECT, overleafUrlAllowed, repoRecords } from './capture/git-source';
import { commitRecords, planCapture, versionRecords, type CaptureRecord } from './capture/plan';
import { NotionClient, notionServerUrl, notionUrlAllowed } from './capture/notion';
import { CaptureStore } from './capture/store';
import { CAPTURE_LOG_LIMIT, MAX_CAPTURES_PER_RUN, type CaptureCode, type CaptureRunRequest, type CaptureRunResult, type CaptureSource, type CaptureStatus } from './capture/types';
import type { GitRepos } from './git';

export class CaptureError extends Error {
  constructor(readonly code: CaptureCode, message?: string) {
    super(message ?? code);
    this.name = 'CaptureError';
  }
}

/** What `run` needs from the current client state; submission goes through the constructor's `submit`. */
export interface CaptureContext {
  state: State;
  me: Id;
  today: IsoDate;
}

/** Injectable git runner, so tests never shell out for real. The default runs `git` with no shell. */
export type GitExec = (cwd: string, args: string[], env: Record<string, string>) => Promise<string>;

const defaultExec: GitExec = (cwd, args, env) =>
  new Promise((resolve, reject) => {
    execFile('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env } }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });

export interface CaptureServiceOptions {
  dataDir: string;
  submit: (cmd: CommandInput) => Promise<SubmitResult>;
  repos: GitRepos;
  host: 'electron' | 'dev-bridge';
  log?: (m: string) => void;
  /** Overridable for tests; the real git clone/pull (Overleaf, T2) uses this instead of `GitRepos`. */
  exec?: GitExec;
  /**
   * Overridable for tests (a client pointed at the fake Notion MCP). By default the service
   * builds one on `notionServerUrl(host)`: `MEETLESS_NOTION_MCP_URL` only on `dev-bridge` (R10).
   */
  notion?: NotionClient;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class CaptureService {
  private readonly store: CaptureStore;
  private readonly exec: GitExec;
  private readonly notion: NotionClient;
  /** The Overleaf sync in flight per artifact id (see `syncOverleaf`). */
  private readonly syncing = new Map<Id, Promise<{ repo: RepoInfo; syncedAt: IsoTime }>>();

  constructor(private readonly opts: CaptureServiceOptions) {
    this.store = new CaptureStore(join(opts.dataDir, 'capture'));
    this.exec = opts.exec ?? defaultExec;
    this.notion = opts.notion ?? new NotionClient({ dataDir: opts.dataDir, serverUrl: notionServerUrl(opts.host), host: opts.host, log: opts.log });
  }

  /** The Notion MCP endpoint this service reads from. */
  get notionServerUrl(): string {
    return this.notion.serverUrl;
  }

  /** One source per artifact the user can see in the project, with its readiness. */
  async status(s: State, me: Id, projectId: Id): Promise<CaptureStatus> {
    const artifacts = Object.values(s.artifacts).filter((a) => a.projectId === projectId && (a.privateTo === null || a.privateTo === me));
    const sources: CaptureSource[] = [];
    for (const a of artifacts) sources.push(await this.sourceFor(a));
    return {
      sources,
      overleafToken: this.store.secret('overleafToken') !== null,
      notion: this.notion.status(),
    };
  }

  private async sourceFor(a: Artifact): Promise<CaptureSource> {
    const lastRunAt = this.store.lastRun(a.id);
    if (a.kind === 'code') {
      const binding = this.store.bindings()[a.id];
      let repo: RepoInfo | null = null;
      let code: CaptureCode | null = 'no_repo';
      if (binding) {
        try {
          repo = await this.opts.repos.info(binding.repoId);
          code = null;
        } catch {
          repo = null;
          code = 'no_repo';
        }
      }
      return { artifactId: a.id, kind: 'repo', ready: code === null, code, repo, syncedAt: null, lastRunAt };
    }
    if (a.kind === 'overleaf') {
      const ov = this.store.overleaf(a.id);
      const ready = ov !== null;
      const lastError = this.store.overleafError(a.id);
      // The synced clone is a registered repo, so the UI can list its commits like a bound one.
      let repo: RepoInfo | null = null;
      if (ov) {
        try {
          repo = await this.opts.repos.info(ov.repoId);
        } catch {
          repo = null;
        }
      }
      return { artifactId: a.id, kind: 'overleaf', ready, code: lastError ?? (ready ? null : this.overleafGap(a)), repo, syncedAt: ov?.syncedAt ?? null, lastRunAt };
    }
    if (a.kind === 'notion') {
      // Never reads the page: readiness is the link's shape plus a stored connection.
      const url = (a.url ?? '').trim();
      const code: CaptureCode | null = !url ? 'no_url' : !notionUrlAllowed(url, this.opts.host) ? 'bad_url' : this.notion.status() === 'connected' ? null : 'notion_not_connected';
      return { artifactId: a.id, kind: 'notion', ready: code === null, code, repo: null, syncedAt: null, lastRunAt };
    }
    // pptx, docx, pdf: an upload is ready once it has at least one version to read.
    const ready = a.versions.length > 0;
    return { artifactId: a.id, kind: 'upload', ready, code: ready ? null : 'no_versions', repo: null, syncedAt: null, lastRunAt };
  }

  /**
   * What stops a never-synced Overleaf artifact from syncing, checked the way `doSyncOverleaf`
   * checks it: an empty link, a link this host may not clone, an https link without a saved
   * token; else `null` (nothing is missing, Sync is the next step).
   */
  private overleafGap(a: Artifact): CaptureCode | null {
    const url = (a.url ?? '').trim();
    if (!url) return 'no_url';
    if (!overleafUrlAllowed(url, this.opts.host)) return 'bad_url';
    if (/^https:\/\//i.test(url) && !this.store.secret('overleafToken')) return 'no_token';
    return null;
  }

  /** Binds (or unbinds, with `repoId: null`) the local repo a code artifact captures from. */
  async bindRepo(artifactId: Id, repoId: string | null): Promise<void> {
    this.store.bind(artifactId, repoId);
  }

  /** `<dataDir>/capture/overleaf/<first 16 hex of sha256(artifactId)>`: a stable per-artifact clone directory. */
  private overleafDir(artifactId: Id): string {
    const hex = createHash('sha256').update(artifactId).digest('hex').slice(0, 16);
    return join(this.opts.dataDir, 'capture', 'overleaf', hex);
  }

  /** Stores (or, with `''`/`null`, clears) the Overleaf token. Kept only in `secrets.json` on this machine. */
  async setOverleafToken(token: string | null): Promise<void> {
    const trimmed = token == null ? null : token.trim();
    this.store.setSecret('overleafToken', trimmed === '' ? null : trimmed);
  }

  /**
   * Clones (first sync) or pulls (later syncs) an Overleaf artifact's git
   * project into its per-artifact directory, authenticating only through
   * `gitAuthEnv` (never argv, never a URL). Registers the clone with
   * `repos.register` so later runs read its commits like any other repo.
   */
  async syncOverleaf(a: Artifact): Promise<{ repo: RepoInfo; syncedAt: IsoTime }> {
    // One sync per artifact at a time: a second Sync click, or a capture run that syncs first,
    // awaits the clone or pull already in flight instead of starting a second one in the same
    // directory (whose failure would overwrite the first one's success).
    const inflight = this.syncing.get(a.id);
    if (inflight) return inflight;
    const p = this.syncOnce(a).finally(() => this.syncing.delete(a.id));
    this.syncing.set(a.id, p);
    return p;
  }

  private async syncOnce(a: Artifact): Promise<{ repo: RepoInfo; syncedAt: IsoTime }> {
    try {
      const result = await this.doSyncOverleaf(a);
      this.store.setOverleafError(a.id, null);
      this.opts.log?.(`overleafSync artifactId=${a.id} result=ok`);
      return result;
    } catch (e) {
      const code = e instanceof CaptureError ? e.code : 'git_failed';
      this.store.setOverleafError(a.id, code);
      this.opts.log?.(`overleafSync artifactId=${a.id} result=${code}`);
      throw e instanceof CaptureError ? e : new CaptureError('git_failed');
    }
  }

  private async doSyncOverleaf(a: Artifact): Promise<{ repo: RepoInfo; syncedAt: IsoTime }> {
    const url = (a.url ?? '').trim();
    if (!url) throw new CaptureError('no_url');
    if (!overleafUrlAllowed(url, this.opts.host)) throw new CaptureError('bad_url');
    const token = this.store.secret('overleafToken');
    if (/^https:\/\//i.test(url) && !token) throw new CaptureError('no_token');

    const dir = this.overleafDir(a.id);
    const env = gitAuthEnv(token);
    try {
      if (existsSync(join(dir, '.git'))) {
        await this.exec(dir, ['pull', '--ff-only', '--quiet'], env);
      } else {
        mkdirSync(dirname(dir), { recursive: true, mode: 0o700 });
        await this.exec(dirname(dir), ['clone', '--quiet', url, dir], env);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/authentication|403|401/i.test(msg)) throw new CaptureError('auth_failed');
      throw new CaptureError('git_failed');
    }

    let repo: RepoInfo;
    try {
      repo = await this.opts.repos.register(dir);
    } catch {
      throw new CaptureError('git_failed');
    }
    const syncedAt = nowIso();
    this.store.setOverleaf(a.id, { repoId: repo.id, url, syncedAt });
    return { repo, syncedAt };
  }

  /** Starts the user's own Notion OAuth; the renderer opens `authorizeUrl` in the browser. */
  async notionConnect(): Promise<{ authorizeUrl: string }> {
    return this.notion.connect();
  }

  async notionDisconnect(): Promise<void> {
    await this.notion.disconnect();
  }

  /** A Notion artifact's page, read live and never stored. */
  async notionPage(a: Artifact): Promise<{ paragraphs: string[]; fetchedAt: IsoTime }> {
    return { paragraphs: await this.readNotion(a), fetchedAt: nowIso() };
  }

  /** Closes what the service holds open (a pending Notion authorization). */
  async close(): Promise<void> {
    await this.notion.close();
  }

  private async readNotion(a: Artifact): Promise<string[]> {
    if (a.kind !== 'notion') throw new CaptureError('bad_url');
    const url = (a.url ?? '').trim();
    if (!url) throw new CaptureError('no_url');
    try {
      const paragraphs = await this.notion.fetchPage(url);
      this.opts.log?.(`notionFetch artifactId=${a.id} result=ok paragraphs=${paragraphs.length}`);
      return paragraphs;
    } catch (e) {
      const code = e instanceof CaptureError ? e.code : 'notion_failed';
      this.opts.log?.(`notionFetch artifactId=${a.id} result=${code}`);
      throw e instanceof CaptureError ? e : new CaptureError('notion_failed');
    }
  }

  /** One record per distinct paragraph: key `n:<first 16 hex of sha256(text)>`, dated the run's day. */
  private async notionRecords(a: Artifact, today: IsoDate): Promise<CaptureRecord[]> {
    const out: CaptureRecord[] = [];
    const seen = new Set<string>();
    for (const text of await this.readNotion(a)) {
      const key = `n:${createHash('sha256').update(text).digest('hex').slice(0, 16)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, src: 'doc', date: today, label: 'Notion', candidates: [text] });
    }
    return out;
  }

  private async recordsFor(a: Artifact, ctx: CaptureContext): Promise<CaptureRecord[]> {
    if (a.kind === 'code') {
      const binding = this.store.bindings()[a.id];
      if (!binding) throw new CaptureError('no_repo');
      try {
        return await repoRecords(this.opts.repos, binding.repoId);
      } catch {
        // The bound repo's directory may have been moved, deleted, or stopped being a git repo
        // since binding; `GitRepos` raises a plain `GitError` for that (and for any other git
        // failure). Either way `run` should skip this artifact, not reject the whole run.
        throw new CaptureError('git_failed');
      }
    }
    if (a.kind === 'overleaf') {
      const { repo } = await this.syncOverleaf(a);
      let commits: CommitInfo[];
      try {
        commits = await this.opts.repos.log(repo.id, 'HEAD', CAPTURE_LOG_LIMIT);
      } catch {
        throw new CaptureError('git_failed');
      }
      const dir = this.overleafDir(a.id);
      const extra: Record<string, string[]> = {};
      for (const c of commits) extra[c.commit] = await addedLines(this.exec, dir, c.commit).catch(() => []);
      const adjusted = commits.map((c) => (OVERLEAF_DEFAULT_SUBJECT.test(c.subject.trim()) ? { ...c, subject: '' } : c));
      return commitRecords(adjusted, extra);
    }
    if (a.kind === 'notion') return this.notionRecords(a, ctx.today);
    const records = versionRecords(a);
    if (records.length === 0) throw new CaptureError('no_versions');
    return records;
  }

  /**
   * Resolves the artifacts to capture (an explicit list, or every visible
   * artifact of the project), reads each by kind, plans `work.recorded`
   * commands and submits them in order, then records `lastRun` for every
   * artifact that was actually read.
   */
  async run(ctx: CaptureContext, req: CaptureRunRequest): Promise<CaptureRunResult> {
    const { state, me } = ctx;
    const artifactIds =
      req.artifactIds ??
      Object.values(state.artifacts)
        .filter((a) => a.projectId === req.projectId && (a.privateTo === null || a.privateTo === me))
        .map((a) => a.id);

    let read = 0;
    let recorded = 0;
    let duplicate = 0;
    let queued = 0;
    const rejected: { workId: Id; code: string }[] = [];
    const skipped: { artifactId: Id; code: CaptureCode }[] = [];
    let budget = MAX_CAPTURES_PER_RUN;

    for (const artifactId of artifactIds) {
      const a = state.artifacts[artifactId];
      if (!a) {
        skipped.push({ artifactId, code: 'not_found' });
        continue;
      }
      let records: CaptureRecord[];
      try {
        records = await this.recordsFor(a, ctx);
      } catch (e) {
        if (e instanceof CaptureError) {
          skipped.push({ artifactId, code: e.code });
          continue;
        }
        throw e;
      }
      read += records.length;
      const cmds = budget > 0 ? planCapture(state, me, a, records, { needId: req.needId, max: budget }) : [];
      budget -= cmds.length;
      for (const cmd of cmds) {
        const r = await this.opts.submit(cmd);
        if (r.kind === 'accepted') recorded++;
        else if (r.kind === 'duplicate') duplicate++;
        else if (r.kind === 'queued') queued++;
        else if (r.kind === 'rejected') rejected.push({ workId: cmd.payload.workId, code: r.code });
      }
      this.store.setLastRun(artifactId, nowIso());
    }
    return { read, recorded, duplicate, queued, rejected, skipped };
  }
}
