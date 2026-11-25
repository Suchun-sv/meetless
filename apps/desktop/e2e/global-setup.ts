import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { E2E, serverUrl } from './env';
import { startServerProc, type Proc } from './procs';

const desktopDir = resolve(import.meta.dirname, '..');

/** Builds the renderer once into `<E2E.root>/web-dist`, which the server serves at `/` for the web specs. */
function buildWebRenderer(outDir: string): void {
  try {
    execFileSync('pnpm', ['exec', 'vite', 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'], { cwd: desktopDir, stdio: 'pipe' });
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`[e2e global setup] vite build failed:\n${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`);
  }
}

const DB = process.env.MEETLESS_TEST_DATABASE_URL ?? 'postgres://meetless:meetless-dev-only@127.0.0.1:55433/meetless';

/**
 * Starts the sync server as its own process on `E2E.base` (Postgres in meetless-pg, a
 * throw-away `e2e_*` schema, the zh-CN sample loaded, dev auth on, no office worker), serving a
 * renderer built once into `<E2E.root>/web-dist` at `/` (the web specs use `webUrl`).
 * Client instances (dev bridge host processes) are started by each spec. Torn down after the
 * run, schema included.
 */
export default async function globalSetup() {
  const root = E2E.root;
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const webDir = resolve(root, 'web-dist');
  buildWebRenderer(webDir);
  const schema = `e2e_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  const procs: Proc[] = [];
  const drop = async () => {
    const c = new pg.Client({ connectionString: DB });
    await c.connect();
    await c.query(`drop schema if exists "${schema}" cascade`);
    await c.end();
  };
  try {
    procs.push(
      await startServerProc({
        MEETLESS_PORT: String(E2E.base),
        MEETLESS_PG_SCHEMA: schema,
        MEETLESS_DATA_DIR: resolve(root, 'server'),
        MEETLESS_DATABASE_URL: DB,
        MEETLESS_DEV_AUTH: '1',
        MEETLESS_SAMPLE: 'zh-CN',
        MEETLESS_OFFICE_URL: 'off',
        MEETLESS_WEB_DIR: webDir,
      }),
    );
    const res = await fetch(`${serverUrl}/health`);
    if (!res.ok) throw new Error('server not healthy');
  } catch (e) {
    // Clean up, but never let a cleanup error hide why start-up failed.
    try {
      for (const p of procs) await p.stop();
      await drop();
    } catch (cleanup) {
      console.error(`[e2e global setup] cleanup after the failed start-up also failed: ${(cleanup as Error)?.message ?? cleanup}`);
    }
    throw e;
  }
  return async () => {
    for (const p of procs.reverse()) await p.stop();
    await drop();
  };
}
