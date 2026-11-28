import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { noDots, type Id, type Project } from '@meetless/core';
import type { CcEvent, CcHandoffCommand, CcItem, CcStatus } from '@meetless/api';
import { hashSecret, newToken } from '../accounts/secrets';
import { ApiError, type ApiDeps } from '../api/frame';
import type { CcProjectRow, CcSessionRow, StoredEvent } from '../store/types';
import type { CcConfig } from './config';
import { claudeMd, linkRepo, mcpJson, settingsJson, slugFor, syncMaterials, writeIfChanged } from './files';
import { backgroundAgent, claudeProcess, type Elsewhere } from './procs';
import { findTranscript, inputPreview, pageOf, readHistory, toolSummary } from './transcript';

type Pushed = CcEvent extends infer E ? (E extends unknown ? Omit<E, 'seq'> : never) : never;
type Decision = { behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string };

interface Turn {
  id: string;
  projectId: Id;
  startedAt: string;
  folder: string;
  events: CcEvent[];
  done: boolean;
  cancelled: boolean;
  child: ChildProcess | null;
  waiters: Set<() => void>;
  sessionId: string | null;
}

interface Approval {
  projectId: Id;
  turnId: string;
  timer: NodeJS.Timeout;
  decide: (allow: boolean, why?: string) => void;
}

const APPROVAL_MS = 10 * 60_000;
const POLL_MS = 20_000;
const BATCH_MS = 150;
const SYNC_DELAY_MS = 5_000;
const FIRST_RUN = '第一次在终端打开会有一次初始化（主题、信任此文件夹、启用 meetless MCP）';
/** The environment a session gets: nothing of the server's own (database URL, model keys, office secret). */
const ENV_KEEP = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR', 'TZ', 'XDG_RUNTIME_DIR', 'http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy', 'no_proxy', 'NO_PROXY'];

/** Claude Code's directory name for a cwd under `<config>/projects/`. */
const encodeCwd = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

/**
 * One real Claude Code session per project (phase 1). Each project has a folder under the cc home
 * (bound by id in `ml_cc_projects`; a rename moves it), regenerated from the state. The owner's
 * turns run `claude -p` in that folder with the session's own login (CLAUDE_CONFIG_DIR) and only
 * the meetless MCP; anything outside the allowed set asks through `requestApproval`, which the
 * owner answers in the app. History is read from the session's transcript, so turns run elsewhere
 * (a terminal, Remote Control) show too, and a session in use elsewhere refuses turns here.
 */
export class CcManager {
  private turns = new Map<Id, Turn>();
  private approvals = new Map<string, Approval>();
  private timers = new Map<Id, NodeJS.Timeout>();
  private agentsCache = new Map<Id, { at: number; hit: Elsewhere | null }>();
  private stopSync: (() => void) | null = null;

  constructor(
    private readonly deps: ApiDeps,
    readonly cfg: CcConfig,
  ) {}

  /** Backfills every project's folder (files only: no token, no session) and keeps them in step with the state. */
  start(): void {
    mkdirSync(this.cfg.home, { recursive: true });
    this.stopSync = this.deps.service.onAppended((e: StoredEvent) => {
      if (e.projectId) this.schedule(e.projectId);
    });
    void (async () => {
      let n = 0;
      for (const id of Object.keys(this.deps.service.current.projects)) {
        try {
          await this.syncFiles(id);
          n++;
        } catch (err) {
          this.log(`cc backfill ${id}: ${(err as Error).message}`);
        }
        await new Promise((r) => setImmediate(r));
      }
      this.log(`cc: ${n} project folders under ${this.cfg.home}`);
    })();
  }

  stop(): void {
    this.stopSync?.();
    for (const t of this.timers.values()) clearTimeout(t);
    for (const turn of this.turns.values()) turn.child?.kill('SIGTERM');
  }

  private log(m: string): void {
    this.deps.cfg.print(m);
  }

  private schedule(projectId: Id): void {
    clearTimeout(this.timers.get(projectId));
    this.timers.set(
      projectId,
      setTimeout(() => {
        this.timers.delete(projectId);
        if (this.turns.get(projectId)?.done === false) return this.schedule(projectId);
        this.syncFiles(projectId).catch((e: unknown) => this.log(`cc sync ${projectId}: ${(e as Error).message}`));
      }, SYNC_DELAY_MS),
    );
  }

  // ---------------------------------------------------------------- access

  private project(projectId: Id): Project {
    const p = this.deps.service.current.projects[projectId];
    if (!p) throw new ApiError('NOT_FOUND');
    return p;
  }

  private requireReader(userId: Id, projectId: Id): Project {
    const p = this.project(projectId);
    if (!this.deps.service.readable(userId).has(projectId)) throw new ApiError('NOT_A_MEMBER');
    return p;
  }

  /** The owner is the project's creator: the only one who talks to its session, and only when listed in MEETLESS_CC_USERS. */
  private requireOwner(userId: Id, projectId: Id): Project {
    const p = this.requireReader(userId, projectId);
    if (!this.cfg.users.has(p.createdBy)) throw new ApiError('NOT_AVAILABLE');
    if (p.createdBy !== userId) throw new ApiError('NOT_AUTHORISED');
    return p;
  }

  private now(): string {
    return this.deps.cfg.now().toISOString();
  }

  // ---------------------------------------------------------------- folder

  private folderPath(row: CcProjectRow): string {
    return join(this.cfg.home, row.folder);
  }

  private async session(projectId: Id): Promise<CcSessionRow | null> {
    return (await this.deps.accounts.ccSessions(projectId))[0] ?? null;
  }

  /** The project's folder row, created on first use, moved when the project was renamed (unless its session is in use). */
  private async binding(projectId: Id): Promise<CcProjectRow> {
    const p = this.project(projectId);
    const want = slugFor(p.name, p.id);
    let row = await this.deps.accounts.ccProject(projectId);
    if (!row) {
      row = { projectId, folder: want, repoPath: null, tokenId: null, updatedAt: this.now() };
      await this.deps.accounts.putCcProject(row);
    } else if (row.folder !== want && !existsSync(join(this.cfg.home, want)) && this.turns.get(projectId)?.done !== false && !(await this.elsewhere(projectId, row))) {
      row = await this.move(row, want);
    }
    mkdirSync(this.folderPath(row), { recursive: true });
    return row;
  }

  /** A rename: the folder, its transcripts under the config dir (their directory follows the cwd) and session.json. */
  private async move(row: CcProjectRow, to: string): Promise<CcProjectRow> {
    const from = this.folderPath(row);
    const dest = join(this.cfg.home, to);
    if (existsSync(from)) renameSync(from, dest);
    const projects = join(this.cfg.configDir, 'projects');
    const oldT = join(projects, encodeCwd(from));
    const newT = join(projects, encodeCwd(dest));
    if (existsSync(oldT) && !existsSync(newT)) renameSync(oldT, newT);
    const next = { ...row, folder: to, updatedAt: this.now() };
    await this.deps.accounts.putCcProject(next);
    for (const s of await this.deps.accounts.ccSessions(row.projectId)) {
      const t = findTranscript(this.cfg.configDir, s.sessionId) ?? join(newT, `${s.sessionId}.jsonl`);
      await this.deps.accounts.putCcSession({ ...s, transcriptPath: t });
    }
    const latest = await this.session(row.projectId);
    if (latest) this.writeSessionJson(dest, latest);
    this.log(`cc: moved ${row.folder} -> ${to}`);
    return next;
  }

  private writeSessionJson(folder: string, s: CcSessionRow): void {
    writeIfChanged(join(folder, '.meetless', 'session.json'), `${JSON.stringify({ sessionId: s.sessionId, name: s.name, transcriptPath: s.transcriptPath, createdAt: s.createdAt }, null, 2)}\n`);
  }

  /** CLAUDE.md, settings, materials and the repo link, from the owner's own view (nothing private to anyone else). */
  async syncFiles(projectId: Id): Promise<void> {
    const p = this.project(projectId);
    const row = await this.binding(projectId);
    const folder = this.folderPath(row);
    const view = this.deps.service.view(p.createdBy);
    const vp = view.projects[projectId] ?? p;
    writeIfChanged(join(folder, 'CLAUDE.md'), claudeMd(view, vp));
    writeIfChanged(join(folder, '.claude', 'settings.json'), settingsJson(row.repoPath));
    linkRepo(folder, row.repoPath);
    syncMaterials(folder, view, projectId, this.deps.service.blobFiles);
  }

  /** The project-scoped agent token in `.mcp.json`: minted on the owner's first turn, never for projects nobody opened. */
  private async ensureToken(p: Project, row: CcProjectRow): Promise<CcProjectRow> {
    const file = join(this.folderPath(row), '.mcp.json');
    if (row.tokenId && existsSync(file)) return row;
    if (row.tokenId) {
      // The plaintext is gone with the file: replace the token.
      await this.deps.accounts.revokeToken(row.tokenId, p.createdBy, this.now());
      this.deps.auth.revoked(row.tokenId);
    }
    const token = newToken('agent');
    const id = `tok-${randomUUID()}` as Id;
    await this.deps.accounts.createToken({
      id,
      kind: 'agent',
      userId: p.createdBy,
      label: noDots(`Claude Code ${p.name}`).slice(0, 40),
      tokenHash: hashSecret(token),
      createdAt: this.now(),
      lastUsedAt: null,
      revokedAt: null,
      projectId: p.id,
    });
    writeIfChanged(file, mcpJson(this.cfg.mcpUrl, token), 0o600);
    const next = { ...row, tokenId: id, updatedAt: this.now() };
    await this.deps.accounts.putCcProject(next);
    return next;
  }

  // ---------------------------------------------------------------- status

  private childEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const k of ENV_KEEP) if (process.env[k] !== undefined) env[k] = process.env[k];
    const local = '127.0.0.1,localhost,::1';
    for (const k of ['no_proxy', 'NO_PROXY']) env[k] = env[k] ? `${env[k]},${local}` : local;
    env.PATH = [join(homedir(), '.local/bin'), env.PATH ?? '/usr/local/bin:/usr/bin:/bin'].join(':');
    env.CLAUDE_CONFIG_DIR = this.cfg.configDir;
    // No claude.ai connectors, no update checks; approvals may wait up to ten minutes.
    env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false';
    env.DISABLE_AUTOUPDATER = '1';
    env.MCP_TOOL_TIMEOUT = String(APPROVAL_MS + 60_000);
    return env;
  }

  /** The session held by a claude process elsewhere (terminal, `--bg`, Remote Control), or a leftover lock. */
  private async elsewhere(projectId: Id, row?: CcProjectRow | null): Promise<Elsewhere | null> {
    const r = row ?? (await this.deps.accounts.ccProject(projectId));
    if (!r) return null;
    const folder = this.folderPath(r);
    const s = await this.session(projectId);
    const turn = this.turns.get(projectId);
    const skip = new Set<number>(turn && !turn.done && turn.child?.pid ? [turn.child.pid] : []);
    const hit = claudeProcess({ configDir: this.cfg.configDir, sessionId: s?.sessionId ?? null, name: s?.name ?? null, folder, skip });
    if (hit) return hit;
    try {
      const lock = JSON.parse(readFileSync(join(folder, '.meetless', 'lock'), 'utf8')) as { pid?: number };
      if (lock.pid && !skip.has(lock.pid) && existsSync(`/proc/${lock.pid}`)) return { pid: lock.pid, how: '另一个 Meetless 进程' };
    } catch {
      // no lock
    }
    if (!s) return null;
    const cached = this.agentsCache.get(projectId);
    if (cached && Date.now() - cached.at < 5000) return cached.hit;
    const bg = await backgroundAgent({ claudeBin: this.cfg.claudeBin, env: this.childEnv(), sessionId: s.sessionId, folder });
    this.agentsCache.set(projectId, { at: Date.now(), hit: bg });
    return bg;
  }

  async status(userId: Id, projectId: Id): Promise<CcStatus> {
    const p = this.requireReader(userId, projectId);
    const row = await this.deps.accounts.ccProject(projectId);
    const s = await this.session(projectId);
    const turn = this.turns.get(projectId);
    const base = { available: this.cfg.users.has(p.createdBy), owner: p.createdBy === userId, session: s ? { id: s.sessionId, name: s.name } : null, repoPath: row?.repoPath ?? null };
    if (turn && !turn.done) return { ...base, state: 'running_here', turn: { id: turn.id, startedAt: turn.startedAt } };
    const away = await this.elsewhere(projectId, row);
    if (away) return { ...base, state: 'in_use_elsewhere', detail: `正在${away.how}使用`, turn: null };
    return { ...base, state: 'idle', turn: null };
  }

  // ---------------------------------------------------------------- turns

  private push(turn: Turn, e: Pushed): void {
    turn.events.push({ ...e, seq: turn.events.length } as CcEvent);
    for (const w of turn.waiters) w();
    turn.waiters.clear();
  }

  async turn(userId: Id, projectId: Id, text: string): Promise<{ turnId: string; next: number }> {
    const p = this.requireOwner(userId, projectId);
    const msg = text.trim();
    if (!msg || msg.length > 20_000) throw new ApiError('BAD_REQUEST');
    if (this.turns.get(projectId)?.done === false) throw new ApiError('TURN_RUNNING');
    let row = await this.binding(projectId);
    if (await this.elsewhere(projectId, row)) throw new ApiError('IN_USE_ELSEWHERE');
    row = await this.ensureToken(p, row);
    await this.syncFiles(projectId);
    const folder = this.folderPath(row);
    const s = await this.session(projectId);
    const name = s?.name ?? `meetless ${p.name}`;
    const args = ['-p', msg];
    if (s) args.push('--resume', s.sessionId);
    else args.push('-n', name);
    args.push(
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--strict-mcp-config',
      '--mcp-config',
      '.mcp.json',
      '--setting-sources',
      'project,local',
      '--permission-prompt-tool',
      'mcp__meetless__approve',
    );
    const turn: Turn = { id: `turn-${randomUUID()}`, projectId, startedAt: this.now(), folder, events: [], done: false, cancelled: false, child: null, waiters: new Set(), sessionId: s?.sessionId ?? null };
    this.turns.set(projectId, turn);
    this.push(turn, { type: 'user', id: turn.id, text: msg });
    const child = spawn(this.cfg.claudeBin, args, { cwd: folder, env: this.childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    turn.child = child;
    mkdirSync(join(folder, '.meetless'), { recursive: true });
    writeFileSync(join(folder, '.meetless', 'lock'), JSON.stringify({ pid: child.pid ?? null, turnId: turn.id, startedAt: turn.startedAt }));
    this.log(`cc turn ${projectId} ${s ? 'resume' : 'new'}`);
    const parse = this.parser(turn, p, name);
    let buf = '';
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (d: string) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) parse(line);
      }
    });
    let stderr = '';
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (d: string) => {
      stderr = (stderr + d).slice(-2000);
    });
    const finish = (code: number | null, err?: Error) => {
      if (turn.done) return;
      if (buf.trim()) parse(buf);
      if (!turn.events.some((e) => e.type === 'result' || e.type === 'error')) {
        const message = err?.message ?? (stderr.trim().split('\n').pop() || `claude exited with ${code}`);
        this.push(turn, { type: 'error', code: turn.cancelled ? 'CANCELLED' : 'CC_EXITED', message: turn.cancelled ? '已停止' : message.slice(0, 300) });
      }
      for (const a of this.approvals.values()) if (a.turnId === turn.id) a.decide(false, '对话已结束');
      rmSync(join(folder, '.meetless', 'lock'), { force: true });
      turn.done = true;
      turn.child = null;
      for (const w of turn.waiters) w();
      turn.waiters.clear();
      void this.afterTurn(turn);
    };
    child.on('error', (e) => finish(null, e));
    child.on('close', (code) => finish(code));
    return { turnId: turn.id, next: 0 };
  }

  /** stream-json lines -> CcEvents: text deltas, one line per tool step, its outcome, the result. */
  private parser(turn: Turn, p: Project, name: string): (line: string) => void {
    let msg = '';
    const streamed = new Set<string>();
    return (line) => {
      let e: Record<string, unknown>;
      try {
        e = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      if (e.type === 'system' && e.subtype === 'init' && typeof e.session_id === 'string') {
        const id = e.session_id;
        turn.sessionId = id;
        this.push(turn, { type: 'session', sessionId: id });
        void this.recordSession(p, turn.folder, id, name);
      } else if (e.type === 'stream_event') {
        const ev = e.event as { type?: string; message?: { id?: string }; delta?: { type?: string; text?: string } };
        if (ev.type === 'message_start') msg = ev.message?.id ?? `m${turn.events.length}`;
        else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          streamed.add(msg);
          this.push(turn, { type: 'text', id: msg, delta: ev.delta.text });
        }
      } else if (e.type === 'assistant') {
        const m = e.message as { id?: string; content?: { type?: string; text?: string; id?: string; name?: string; input?: unknown }[] };
        for (const b of m.content ?? []) {
          if (b.type === 'text' && b.text && !streamed.has(m.id ?? '')) this.push(turn, { type: 'text', id: m.id ?? msg, delta: b.text });
          if (b.type === 'tool_use' && b.id && b.name) this.push(turn, { type: 'tool', id: b.id, name: b.name, summary: toolSummary(b.name, b.input, turn.folder) });
        }
      } else if (e.type === 'user') {
        const m = e.message as { content?: unknown };
        if (Array.isArray(m.content)) {
          for (const b of m.content as { type?: string; tool_use_id?: string; is_error?: boolean }[]) {
            if (b.type === 'tool_result' && b.tool_use_id) this.push(turn, { type: 'tool_result', id: b.tool_use_id, ok: !b.is_error });
          }
        }
      } else if (e.type === 'result') {
        const cost = typeof e.total_cost_usd === 'number' ? e.total_cost_usd : undefined;
        const ms = typeof e.duration_ms === 'number' ? e.duration_ms : undefined;
        if (e.is_error) this.push(turn, { type: 'error', code: 'CC_ERROR', message: String(e.result ?? e.subtype ?? 'error').slice(0, 300) });
        this.push(turn, { type: 'result', ...(cost === undefined ? {} : { costUsd: cost }), ...(ms === undefined ? {} : { durationMs: ms }) });
      }
    };
  }

  private async recordSession(p: Project, folder: string, sessionId: string, name: string): Promise<void> {
    try {
      const known = (await this.deps.accounts.ccSessions(p.id)).find((s) => s.sessionId === sessionId);
      const row: CcSessionRow = known ?? {
        projectId: p.id,
        sessionId,
        name,
        transcriptPath: join(this.cfg.configDir, 'projects', encodeCwd(folder), `${sessionId}.jsonl`),
        createdAt: this.now(),
      };
      if (!known) await this.deps.accounts.putCcSession(row);
      this.writeSessionJson(folder, row);
    } catch (e) {
      this.log(`cc session record ${p.id}: ${(e as Error).message}`);
    }
  }

  private async afterTurn(turn: Turn): Promise<void> {
    if (!turn.sessionId) return;
    const s = (await this.deps.accounts.ccSessions(turn.projectId)).find((x) => x.sessionId === turn.sessionId);
    if (s && !existsSync(s.transcriptPath)) {
      const found = findTranscript(this.cfg.configDir, s.sessionId);
      if (found) {
        const row = { ...s, transcriptPath: found };
        await this.deps.accounts.putCcSession(row);
        this.writeSessionJson(turn.folder, row);
      }
    }
  }

  async events(userId: Id, projectId: Id, turnId: string | undefined, after: number): Promise<{ events: CcEvent[]; next: number; done: boolean }> {
    this.requireReader(userId, projectId);
    const turn = this.turns.get(projectId);
    if (!turn || (turnId && turn.id !== turnId)) return { events: [], next: after, done: true };
    const from = Math.max(0, Math.min(after, turn.events.length));
    if (turn.events.length <= from && !turn.done) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(done, POLL_MS);
        function done() {
          clearTimeout(t);
          resolve();
        }
        turn.waiters.add(done);
      });
      if (!turn.done) await new Promise((r) => setTimeout(r, BATCH_MS));
    }
    return { events: turn.events.slice(from), next: turn.events.length, done: turn.done };
  }

  async cancel(userId: Id, projectId: Id): Promise<{ cancelled: boolean }> {
    this.requireOwner(userId, projectId);
    const turn = this.turns.get(projectId);
    if (!turn || turn.done || !turn.child) return { cancelled: false };
    turn.cancelled = true;
    const child = turn.child;
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 3000).unref();
    return { cancelled: true };
  }

  // ---------------------------------------------------------------- approvals

  /**
   * `mcp__meetless__approve` (the session's --permission-prompt-tool): a card in the running
   * turn, answered by the owner, or refused after ten minutes. Answers in the tool's JSON shape.
   */
  async requestApproval(projectId: Id, toolName: string, input: Record<string, unknown>): Promise<Decision> {
    const turn = this.turns.get(projectId);
    if (!turn || turn.done) return { behavior: 'deny', message: '这个操作需要在 Meetless 里批准，当前没有进行中的对话。' };
    const approvalId = `ap-${randomUUID()}`;
    const expiresAt = new Date(this.deps.cfg.now().getTime() + APPROVAL_MS).toISOString();
    this.push(turn, { type: 'permission', approvalId, tool: toolName, input: inputPreview(toolName, input, turn.folder), expiresAt });
    return new Promise<Decision>((resolve) => {
      const decide = (allow: boolean, why?: string) => {
        const a = this.approvals.get(approvalId);
        if (!a) return;
        clearTimeout(a.timer);
        this.approvals.delete(approvalId);
        this.push(turn, { type: 'permission_done', approvalId, behavior: allow ? 'allow' : 'deny' });
        resolve(allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: why ?? '项目负责人拒绝了这个操作。' });
      };
      const timer = setTimeout(() => decide(false, '超过 10 分钟没有批准，按拒绝处理。'), APPROVAL_MS);
      this.approvals.set(approvalId, { projectId, turnId: turn.id, timer, decide });
    });
  }

  async approve(userId: Id, projectId: Id, approvalId: string, allow: boolean): Promise<{ ok: true }> {
    this.requireOwner(userId, projectId);
    const a = this.approvals.get(approvalId);
    if (!a || a.projectId !== projectId) throw new ApiError('NOT_FOUND');
    a.decide(allow);
    return { ok: true };
  }

  // ---------------------------------------------------------------- history, handoff, repo

  async history(userId: Id, projectId: Id, before: string | undefined, limit: number | undefined): Promise<{ items: CcItem[]; before: string | null }> {
    this.requireReader(userId, projectId);
    const s = await this.session(projectId);
    const row = await this.deps.accounts.ccProject(projectId);
    if (!s || !row) return { items: [], before: null };
    const file = existsSync(s.transcriptPath) ? s.transcriptPath : findTranscript(this.cfg.configDir, s.sessionId);
    if (!file) return { items: [], before: null };
    return pageOf(readHistory(file, this.folderPath(row)), before, Math.min(Math.max(limit ?? 50, 1), 200));
  }

  async handoff(userId: Id, projectId: Id): Promise<{ commands: CcHandoffCommand[] }> {
    const p = this.requireOwner(userId, projectId);
    const s = await this.session(projectId);
    const row = await this.deps.accounts.ccProject(projectId);
    if (!s || !row || !this.cfg.sshHost) return { commands: [] };
    const home = homedir();
    const tilde = (path: string) => (path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path);
    const env = (path: string) => (path.startsWith(`${home}/`) ? `$HOME/${path.slice(home.length + 1)}` : path);
    const quote = (x: string) => x.replace(/['"\\$`]/g, '');
    const base = `cd ${tilde(this.folderPath(row))} && env CLAUDE_CONFIG_DIR=${env(this.cfg.configDir)} ${tilde(this.cfg.claudeBin)}`;
    const name = quote(`meetless ${p.name}`);
    // --desktop is left out: it opens the Claude Desktop app and refuses to run on a headless host.
    return {
      commands: [
        { kind: 'terminal', command: `ssh -t ${this.cfg.sshHost} '${base} --resume ${s.sessionId}'`, note: `在终端里接着这个会话（需要能 ssh 到服务器）。${FIRST_RUN}` },
        {
          kind: 'remote',
          command: `ssh -t ${this.cfg.sshHost} '${base} --remote-control "${name}" --resume ${s.sessionId}'`,
          note: `从 claude.ai/code 或 Claude 手机 App 接着用，需要登录同一个个人 Claude 账号。${FIRST_RUN}`,
        },
      ],
    };
  }

  async setRepo(userId: Id, projectId: Id, repoPath: string | null): Promise<{ repoPath: string | null }> {
    this.requireOwner(userId, projectId);
    let path = repoPath === null || repoPath.trim() === '' ? null : repoPath.trim().replace(/\/+$/, '');
    if (path !== null) {
      // Only under the configured repo roots (by its real path), never the cc home or the session login.
      let ok = false;
      try {
        if (isAbsolute(path) && statSync(path).isDirectory()) {
          path = realpathSync(path);
          const under = (root: string) => path === root || path!.startsWith(`${root}/`);
          ok = this.cfg.repoRoots.some(under) && !under(this.cfg.home) && !under(this.cfg.configDir);
        }
      } catch {
        ok = false;
      }
      if (!ok) throw new ApiError('BAD_REQUEST');
    }
    const row = await this.binding(projectId);
    await this.deps.accounts.putCcProject({ ...row, repoPath: path, updatedAt: this.now() });
    await this.syncFiles(projectId);
    return { repoPath: path };
  }
}
