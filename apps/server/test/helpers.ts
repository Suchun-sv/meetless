import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, Socket, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import type { EventPayloads, EventType } from '@meetless/core';
import { DEFAULT_DEV_USERS, startServer, type Authenticator, type ServerConfig, type SyncService } from '../src/index';
import type { AccountStore } from '../src/store/types';

export const TEST_DATABASE_URL =
  process.env.MEETLESS_TEST_DATABASE_URL ?? 'postgres://meetless:meetless-dev-only@127.0.0.1:55433/meetless';

/** Fails loudly (does not skip) when the dev Postgres is not running: these suites are meant to hit real Postgres. */
export async function requirePostgres(): Promise<void> {
  const c = new pg.Client({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 3000 });
  try {
    await c.connect();
    await c.query('select 1');
  } catch (e) {
    throw new Error(`Postgres not reachable at ${TEST_DATABASE_URL} (${(e as Error).message}). Run: infra/dev/deps.sh start`);
  } finally {
    await c.end().catch(() => undefined);
  }
}

/** A throw-away schema per suite so test runs never touch the dev data in schema "meetless". */
export function testSchema(): { name: string; drop(): Promise<void> } {
  const name = `test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  return {
    name,
    async drop() {
      const c = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await c.connect();
      await c.query(`drop schema if exists "${name}" cascade`);
      await c.end();
    },
  };
}

export function tempDir(prefix: string): { path: string; rm(): void } {
  const path = mkdtempSync(join(tmpdir(), `meetless-${prefix}-`));
  return { path, rm: () => rmSync(path, { recursive: true, force: true }) };
}

/** A test server config: dev auth on (fixed dev tokens), no admin invite, nothing printed. */
export function serverConfig(over: Partial<ServerConfig> & { dataDir: string }): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    databaseUrl: TEST_DATABASE_URL,
    pgSchema: 'meetless',
    devAuth: true,
    devUsers: DEFAULT_DEV_USERS,
    adminInvite: false,
    print: () => {},
    now: () => new Date(),
    agentUrl: null,
    trustProxy: 0,
    // Generous on purpose: unrelated tests share one IP (localhost) and must never trip RATE_LIMITED
    // by accident. Tests of the limiter itself (ratelimit.test.ts) override this with small limits.
    rateLimits: { signIn: { limit: 1000, windowMs: 60 * 60_000 }, redeem: { limit: 1000, windowMs: 60 * 60_000 } },
    logger: false,
    // Off by default: most tests never touch OnlyOffice. Task 8's own tests override this.
    onlyoffice: { url: null, jwtSecret: null, publicUrl: 'http://meetless-onlyoffice-files:8080', filesSocket: null },
    ...over,
  };
}

export { startServer };

export interface TestServer {
  base: string;
  svc: SyncService;
  cfg: ServerConfig;
  dataDir: string;
  accounts: AccountStore;
  auth: Authenticator;
  /** The files-socket path actually listening, or `null` when `onlyoffice.filesSocket` was off. */
  filesSocket: string | null;
  stop(): Promise<void>;
}

/**
 * A running server on port 0 over real Postgres. By default it gets its own throw-away
 * schema and data directory, which `stop()` drops and removes. Pass `pgSchema` and/or
 * `dataDir` to reuse them across a restart: those the caller passed are left in place.
 */
export async function withServer(over: Partial<ServerConfig> = {}): Promise<TestServer> {
  await requirePostgres();
  const schema = over.pgSchema === undefined ? testSchema() : null;
  const dir = over.dataDir === undefined ? tempDir('server') : null;
  const cfg = serverConfig({ ...over, dataDir: over.dataDir ?? dir!.path, pgSchema: over.pgSchema ?? schema!.name });
  const cleanup = async () => {
    await schema?.drop();
    dir?.rm();
  };
  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer(cfg);
  } catch (e) {
    await cleanup();
    throw e;
  }
  return {
    base: server.url,
    svc: server.service,
    cfg,
    dataDir: cfg.dataDir,
    accounts: server.accounts,
    auth: server.auth,
    filesSocket: server.filesSocket,
    async stop() {
      await server.close();
      await cleanup();
    },
  };
}

export const TOKENS = {
  alex: 'dev-alex',
  lin: 'dev-lin',
  ben: 'dev-ben',
  zhou: 'dev-zhou',
  eve: 'dev-eve',
  prof: 'dev-prof',
  mia: 'dev-mia',
  ruo: 'dev-ruo',
} as const;
export const IDS = {
  alex: 'u-alex',
  lin: 'u-lin',
  ben: 'u-ben',
  zhou: 'u-zhou',
  eve: 'u-eve',
  prof: 'u-prof',
  mia: 'u-mia',
  ruo: 'u-ruo',
} as const;

export const TODAY = '2026-11-24';

/** A client command (the server adds seq, actorId and recordedAt). */
export function cmd<K extends EventType>(type: K, payload: EventPayloads[K], id: string = randomUUID()): { id: string; type: K; payload: EventPayloads[K] } {
  return { id, type, payload };
}

/** Commands for common v3 objects, so tests read as the story they tell. */
export const make = {
  project: (projectId: string, name = '客户管理系统首版交付') => cmd('project.created', { projectId, name }),
  member: (projectId: string, userId: string) => cmd('project.member_added', { projectId, userId }),
  round: (roundId: string, projectId: string, title = '第 1 轮交付') =>
    cmd('round.created', { roundId, projectId, title, kind: 'hard', start: '2026-11-18', due: '2026-11-28' }),
  need: (needId: string, projectId: string, title: string, opts: { private?: boolean; roundId?: string | null } = {}) =>
    cmd('need.created', {
      needId,
      projectId,
      kind: 'ext',
      title,
      roundId: opts.roundId ?? null,
      source: { src: 'meeting', date: TODAY, quote: title, ref: 'kickoff notes' },
      ...(opts.private ? { private: true } : {}),
    }),
  work: (workId: string, projectId: string, needId: string | null, text: string, opts: { private?: boolean } = {}) =>
    cmd('work.recorded', { workId, projectId, needId, src: 'doc', text, date: TODAY, ...(opts.private ? { private: true } : {}) }),
};

export async function http(base: string, token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

/** Polls until `fn` returns truthy (or throws after `ms`). */
export async function until<T>(fn: () => T | Promise<T>, ms = 8000, what = 'condition'): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  let last: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v as NonNullable<T>;
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}${last ? `: ${String(last)}` : ''}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * A loopback TCP proxy in front of the server, so a test can cut one client's
 * network (all open sockets dropped, new connections refused) and restore it.
 */
export class Cable {
  private server: Server | null = null;
  private sockets = new Set<Socket>();
  port = 0;
  constructor(private readonly targetPort: number) {}

  async plug(): Promise<void> {
    const srv = createServer((client) => {
      const upstream = new Socket();
      upstream.connect(this.targetPort, '127.0.0.1');
      for (const s of [client, upstream]) {
        this.sockets.add(s);
        s.on('close', () => this.sockets.delete(s));
        s.on('error', () => s.destroy());
      }
      client.pipe(upstream).pipe(client);
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => client.destroy());
    });
    await new Promise<void>((r) => srv.listen(this.port, '127.0.0.1', () => r()));
    const a = srv.address();
    this.port = typeof a === 'object' && a ? a.port : this.port;
    this.server = srv;
  }

  async unplug(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    const srv = this.server;
    this.server = null;
    if (srv) await new Promise<void>((r) => srv.close(() => r()));
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }
}
