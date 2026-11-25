import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Id } from '@meetless/core';
import { EVENT_TYPES } from '@meetless/core';
import { InviteService } from './accounts/invites';
import { loadSkillMarkdown, skillPathFromEnv } from './accounts/guide';
import { parseRateLimitEnv, RateLimiter, type RateLimitOpts } from './api/ratelimit';
import { Authenticator, DevAuth, parseDevUsers, type DevUser } from './auth';
import { BlobFiles } from './blobs';
import { buildApp } from './http';
import { startFilesSocket } from './office/files-socket';
import { PdfTextWorker, type PdfTextWorkerOptions } from './office/pdf-text';
import { OfficeTickets } from './office/tickets';
import { OfficeWorker, type OfficeWorkerOptions } from './office/worker';
import { DEFAULT_REPO_ROOT, loadSample, sampleFromEnv, utcToday } from './sample';
import { SyncService, TEAM_STREAM, unknownEventTypeError } from './service';
import { MemoryAccountStore, MemoryBlobMetaStore, MemoryDerivationStore, MemoryEventStore } from './store/memory';
import { firstUnknownEvent, openPostgres } from './store/postgres';
import type { AccountStore } from './store/types';

export const DEFAULT_DATABASE_URL = 'postgres://meetless:meetless-dev-only@127.0.0.1:55433/meetless';

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  /** `null` = in-memory store (unit tests only). */
  databaseUrl: string | null;
  pgSchema: string;
  /** Fixed dev tokens accepted (`MEETLESS_DEV_AUTH=1`; never with NODE_ENV=production). */
  devAuth: boolean;
  /** Dev users registered and accepted; ignored (none registered) while `devAuth` is off. */
  devUsers: DevUser[];
  /** Issue the one-time admin invite on first start. */
  adminInvite: boolean;
  /** Where startup lines meant for the operator go (the admin invite). */
  print: (line: string) => void;
  /** Server clock for token use, call log and dates. */
  now: () => Date;
  /** Public base URL agents use to reach this server (`MEETLESS_AGENT_URL`); null = the request's host. */
  agentUrl: string | null;
  /**
   * How many reverse proxies sit in front of this server (`MEETLESS_TRUST_PROXY`, a hop count;
   * 0 = none). The client address is the one `trustProxy` hops from the right of
   * [...X-Forwarded-For, socket address], so a client-supplied leftmost entry is never trusted.
   */
  trustProxy: number;
  /**
   * Failed-attempt rate limits, keyed by client IP (contract §12.8): `signIn` counts failed
   * bearer-token authentication (`authenticateRequest`, every `/v1/*` route, `/mcp`, the
   * websocket upgrade); `redeem` counts failed `invites.redeem` calls. From
   * `MEETLESS_RATE_SIGNIN` / `MEETLESS_RATE_REDEEM` (`<limit>/<seconds>`), defaulting to
   * 10 failures per 5 minutes and 10 per 10 minutes.
   */
  rateLimits: { signIn: RateLimitOpts; redeem: RateLimitOpts };
  logger: boolean;
  /**
   * Background workers. `office: false` (or omitted) disables the office preview worker.
   * `pdfText`, default `true`: `false` disables the per-page PDF text worker
   * (`MEETLESS_PDF_TEXT=off`); an options object enables it with those options (tests only —
   * `configFromEnv` only ever produces `true`/`false`).
   */
  workers?: { office?: OfficeWorkerOptions | false; pdfText?: boolean | PdfTextWorkerOptions };
  /** Process environment, for settings read by later blocks. */
  env?: Record<string, string | undefined>;
  /** Sample projects to load at start (`MEETLESS_SAMPLE`, `MEETLESS_SAMPLE_ME`); a no-op once the log has projects. */
  sample?: { locale: 'zh-CN' | 'en'; me: Id } | null;
  /** Repo root holding the prototype data (`MEETLESS_REPO_ROOT`). */
  repoRoot?: string;
  /**
   * OnlyOffice view config and file tickets (Task 8; contract §12.6, §12.13). `url` is
   * DocumentServer's own base URL (`off` disables preview entirely); `jwtSecret` signs the
   * `config.token` DocumentServer checks; `publicUrl` is what DocumentServer itself uses to
   * fetch a ticketed file (default: the relay container `meetless-onlyoffice-files`, U3's
   * side of "DocumentServer reachability"); `filesSocket` is where this server listens for
   * `GET /v1/office-files/:ticket` (`off` disables the socket, so no file is ever servable).
   */
  onlyoffice: { url: string | null; jwtSecret: string | null; publicUrl: string; filesSocket: string | null };
}

const DEFAULT_ONLYOFFICE_URL = 'http://127.0.0.1:55435';
const DEFAULT_ONLYOFFICE_PUBLIC_URL = 'http://meetless-onlyoffice-files:8080';
const ONLYOFFICE_ENV_FILE = 'infra/dev/onlyoffice/.env.local';

/** Strips one matching pair of surrounding `"` or `'` quotes, as a shell-style `.env` file commonly has around a value. */
function unquote(v: string): string {
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) return v.slice(1, -1);
  return v;
}

/** The `MEETLESS_ONLYOFFICE_JWT_SECRET=` line of `<repoRoot>/infra/dev/onlyoffice/.env.local` (U3's untracked file); `null` if the file or the line is absent. */
function onlyofficeJwtSecretFromEnvFile(repoRoot: string): string | null {
  let text: string;
  try {
    text = readFileSync(join(repoRoot, ONLYOFFICE_ENV_FILE), 'utf8');
  } catch {
    return null;
  }
  for (const line of text.split('\n')) {
    const m = /^MEETLESS_ONLYOFFICE_JWT_SECRET=(.*)$/.exec(line.trim());
    if (m) return unquote(m[1]!.trim());
  }
  return null;
}

/** Strips trailing slashes from a configured base URL, so joining `/v1/...` onto it never produces a double slash. */
function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

/** `MEETLESS_TRUST_PROXY`: a hop count, an integer 0 or more (unset or empty = 0, no proxy); throws on anything else. */
export function parseTrustProxy(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 0;
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n)) {
    throw new Error(`MEETLESS_TRUST_PROXY must be the number of reverse proxies in front of the server (0, 1, 2, ...), got ${JSON.stringify(raw)}`);
  }
  return n;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const devAuth = env.MEETLESS_DEV_AUTH === '1';
  if (devAuth && env.NODE_ENV === 'production') throw new Error('MEETLESS_DEV_AUTH=1 is not allowed when NODE_ENV=production');
  const dataDir = resolve(env.MEETLESS_DATA_DIR ?? '.data/server');
  const repoRoot = env.MEETLESS_REPO_ROOT ?? DEFAULT_REPO_ROOT;
  return {
    host: env.MEETLESS_HOST ?? '127.0.0.1',
    port: Number(env.MEETLESS_PORT ?? 4870),
    dataDir,
    databaseUrl: env.MEETLESS_DATABASE_URL ?? DEFAULT_DATABASE_URL,
    pgSchema: env.MEETLESS_PG_SCHEMA ?? 'meetless',
    devAuth,
    devUsers: devAuth ? parseDevUsers(env.MEETLESS_DEV_USERS) : [],
    adminInvite: true,
    print: (line) => console.log(line),
    now: () => new Date(),
    agentUrl: env.MEETLESS_AGENT_URL || null,
    trustProxy: parseTrustProxy(env.MEETLESS_TRUST_PROXY),
    rateLimits: {
      signIn: parseRateLimitEnv(env.MEETLESS_RATE_SIGNIN, 'MEETLESS_RATE_SIGNIN', { limit: 10, windowMs: 5 * 60_000 }),
      redeem: parseRateLimitEnv(env.MEETLESS_RATE_REDEEM, 'MEETLESS_RATE_REDEEM', { limit: 10, windowMs: 10 * 60_000 }),
    },
    logger: env.MEETLESS_LOG === '1',
    workers: {
      office: env.MEETLESS_OFFICE_URL === 'off' ? false : { url: env.MEETLESS_OFFICE_URL ?? 'http://127.0.0.1:55434' },
      pdfText: env.MEETLESS_PDF_TEXT !== 'off',
    },
    env,
    sample: sampleFromEnv(env),
    repoRoot,
    onlyoffice: {
      url: env.MEETLESS_ONLYOFFICE_URL === 'off' ? null : stripTrailingSlashes(env.MEETLESS_ONLYOFFICE_URL ?? DEFAULT_ONLYOFFICE_URL),
      jwtSecret: env.MEETLESS_ONLYOFFICE_JWT_SECRET || onlyofficeJwtSecretFromEnvFile(repoRoot),
      publicUrl: stripTrailingSlashes(env.MEETLESS_PUBLIC_URL ?? DEFAULT_ONLYOFFICE_PUBLIC_URL),
      filesSocket: env.MEETLESS_OFFICE_FILES_SOCKET === 'off' ? null : (env.MEETLESS_OFFICE_FILES_SOCKET ?? join(dataDir, 'office-sock', 'files.sock')),
    },
  };
}

export interface RunningServer {
  app: FastifyInstance;
  service: SyncService;
  /** `null` when `workers.office` was `false`/omitted. */
  office: OfficeWorker | null;
  /** `null` when `workers.pdfText` was `false`. */
  pdfText: PdfTextWorker | null;
  accounts: AccountStore;
  auth: Authenticator;
  url: string;
  /** The files-socket path actually listening, or `null` when `onlyoffice.filesSocket` was `off`. */
  filesSocket: string | null;
  close(): Promise<void>;
}

/**
 * Opens the stores and the service, then listens. A Postgres schema whose log
 * holds an event type this version does not know is refused with the seq, the
 * type and the schema name, before any migration or other write.
 * That no-write guarantee covers unknown event types only: there is no full
 * replay pre-check, so a known type whose payload no longer replays is refused
 * by `SyncService.open` after migrations have run (still before any event is
 * appended or served).
 */
export async function startServer(cfg: ServerConfig): Promise<RunningServer> {
  // Read before anything else is allocated (contract §12.1, §12.10): a missing skill file
  // fails startup cleanly, with no store or worker left dangling, rather than a silently
  // empty agent.guide and MCP `instructions`.
  const skillMarkdown = loadSkillMarkdown(skillPathFromEnv(cfg.env ?? {}));
  await mkdir(cfg.dataDir, { recursive: true });
  const where = cfg.databaseUrl ? ` (schema ${cfg.pgSchema})` : '';
  if (cfg.databaseUrl) {
    const bad = await firstUnknownEvent(cfg.databaseUrl, cfg.pgSchema, TEAM_STREAM, EVENT_TYPES);
    if (bad) throw unknownEventTypeError(bad.seq, bad.type, where);
  }
  const stores = cfg.databaseUrl
    ? await openPostgres({ connectionString: cfg.databaseUrl, schema: cfg.pgSchema })
    : { events: new MemoryEventStore(), blobs: new MemoryBlobMetaStore(), derivations: new MemoryDerivationStore(), accounts: new MemoryAccountStore() };
  // With dev auth off no dev user is registered or accepted, whatever devUsers holds.
  const devUsers = cfg.devAuth ? cfg.devUsers : [];
  let service: SyncService;
  let sample: { loaded: boolean; events: number } | null = null;
  try {
    service = await SyncService.open({
      store: stores.events,
      blobMeta: stores.blobs,
      blobFiles: new BlobFiles(cfg.dataDir),
      devUsers,
      derivations: stores.derivations,
    });
    if (cfg.sample) sample = await loadSample(service, { ...cfg.sample, today: utcToday(), repoRoot: cfg.repoRoot ?? DEFAULT_REPO_ROOT });
  } catch (e) {
    await stores.accounts.close();
    await stores.blobs.close();
    await stores.events.close();
    throw new Error(`${(e as Error).message}${where}`, { cause: e });
  }
  const officeCfg = cfg.workers?.office;
  const office = officeCfg ? new OfficeWorker(service, officeCfg) : null;
  office?.start();
  const pdfTextCfg = cfg.workers?.pdfText ?? true;
  const pdfText = pdfTextCfg === false ? null : new PdfTextWorker(service, pdfTextCfg === true ? undefined : pdfTextCfg);
  pdfText?.start();
  const accounts = stores.accounts;
  const auth = new Authenticator(accounts, cfg.devAuth ? new DevAuth(devUsers) : null, cfg.now);
  // One pair of limiters for the server's lifetime, shared by the typed frame, the /v1 routes and the websocket upgrade.
  const rateLimits = {
    signIn: new RateLimiter(cfg.rateLimits.signIn, () => cfg.now().getTime()),
    redeem: new RateLimiter(cfg.rateLimits.redeem, () => cfg.now().getTime()),
  };
  // One OfficeTickets for the server's lifetime, shared by office.config (issues) and the files socket (verifies):
  // a ticket from any other OfficeTickets instance (another server's secret) never verifies here.
  const officeTickets = new OfficeTickets();
  const app = await buildApp({ service, accounts, auth, cfg, rateLimits, officeTickets, skillMarkdown });
  if (sample) app.log.info({ sample: cfg.sample, ...sample }, sample.loaded ? 'sample data loaded' : 'sample data not loaded: the log already has projects');
  if (cfg.adminInvite) await new InviteService({ service, accounts, auth, cfg, rateLimits, skillMarkdown }).ensureAdminInvite();
  const filesSocketPath = cfg.onlyoffice.filesSocket;
  // "Ours" exactly when it is the default path for this dataDir: only then do we keep its
  // directory at 0700 across restarts unconditionally (see `startFilesSocket`'s `ownDir`).
  const ownsFilesSocketDir = filesSocketPath === join(cfg.dataDir, 'office-sock', 'files.sock');
  let filesSocket: { close(): Promise<void> } | null = null;
  try {
    // Both of these can fail on their own (a refused files-socket start — a non-socket file
    // at the path, or a custom directory not already 0700 — as well as the TCP listener
    // failing to bind, e.g. the port is already taken). Either way nothing above here can be
    // left dangling: the workers, the files socket (if it did start) and the stores all need
    // to come down before this rethrows, exactly as `close()` would do.
    filesSocket = filesSocketPath
      ? await startFilesSocket({ path: filesSocketPath, tickets: officeTickets, blobMeta: stores.blobs, blobFiles: new BlobFiles(cfg.dataDir), ownDir: ownsFilesSocketDir })
      : null;
    await app.listen({ host: cfg.host, port: cfg.port });
  } catch (e) {
    await office?.stop();
    await pdfText?.stop();
    await filesSocket?.close();
    await accounts.close().catch(() => undefined);
    await stores.blobs.close().catch(() => undefined);
    await stores.events.close().catch(() => undefined);
    throw e;
  }
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : cfg.port;
  let closed = false;
  return {
    app,
    service,
    office,
    pdfText,
    accounts,
    auth,
    url: `http://${cfg.host}:${port}`,
    filesSocket: filesSocketPath,
    async close() {
      if (closed) return;
      closed = true;
      await office?.stop();
      await pdfText?.stop();
      await filesSocket?.close();
      await app.close();
      await accounts.close();
      await stores.blobs.close();
      await stores.events.close();
    },
  };
}
