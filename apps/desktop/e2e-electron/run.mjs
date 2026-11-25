// Electron end-to-end smoke test, run INSIDE the meetless-xvfb container under Xvfb
// (infra/dev/electron-e2e.sh). Executed with Electron's own Node (ELECTRON_RUN_AS_NODE=1),
// because the container image has no Node. Never run this on a desktop session.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron } from '@playwright/test';
import pg from 'pg';

const desktop = resolve(import.meta.dirname, '..');
const repo = resolve(desktop, '../..');
// Untracked: never into docs/screenshots. Relative paths are from the repo root (blockEnv gives .data/<block>/electron-shots).
const shots = resolve(repo, process.env.MEETLESS_SHOTS_DIR || '.data/electron-shots');
const electronBin = resolve(desktop, 'node_modules/electron/dist/electron');
const DB = process.env.MEETLESS_DATABASE_URL ?? 'postgres://meetless:meetless-dev-only@meetless-pg:5432/meetless';
const schema = `electron_e2e_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const clientDir = '/tmp/meetless-electron-client';
const logDir = '/tmp/meetless-electron-logs';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const { ELECTRON_RUN_AS_NODE: _drop, ...appEnv } = process.env;

rmSync(clientDir, { recursive: true, force: true });
rmSync(logDir, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });

// 1. Sync server (Postgres in meetless-pg), started with Electron-as-Node + tsx.
const server = spawn(electronBin, ['--import', 'tsx', 'src/main.ts'], {
  cwd: resolve(repo, 'apps/server'),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MEETLESS_DATABASE_URL: DB, MEETLESS_PG_SCHEMA: schema, MEETLESS_PORT: '4870', MEETLESS_DATA_DIR: '/tmp/meetless-electron-server', MEETLESS_DEV_AUTH: '1', MEETLESS_OFFICE_URL: 'off' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((res, rej) => {
  let out = '';
  const t = setTimeout(() => rej(new Error(`server did not start: ${out}`)), 30_000);
  const on = (d) => {
    out += d;
    if (/listening on/.test(out)) {
      clearTimeout(t);
      res();
    }
  };
  server.stdout.on('data', on);
  server.stderr.on('data', on);
});
check('server started inside container (Postgres store)', true);

const launch = () =>
  _electron.launch({
    executablePath: electronBin,
    // --no-sandbox: Chromium's sandbox needs user namespaces the container does not grant. Test container only.
    args: ['--no-sandbox', desktop],
    env: { ...appEnv, MEETLESS_CLIENT_DATA_DIR: clientDir, MEETLESS_LOG_DIR: logDir, LANGUAGE: 'zh_CN:zh', LANG: 'zh_CN.UTF-8' },
    timeout: 60_000,
  });

try {
  // 2. First launch: real Electron main + preload + packaged renderer (file://).
  let app = await launch();
  let win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  const isolation = await win.evaluate(() => ({ bridge: typeof window.meetless, require: typeof window.require, process: typeof window.process }));
  check('renderer has the bridge but no Node globals', isolation.bridge === 'object' && isolation.require === 'undefined' && isolation.process === 'undefined', JSON.stringify(isolation));
  const sys = await app.evaluate(({ app: a }) => a.getPreferredSystemLanguages());
  const snap = await win.evaluate(() => window.meetless.snapshot());
  check('main process uses node:sqlite cache', snap.cacheKind === 'sqlite' && snap.host === 'electron', `${snap.cacheKind}/${snap.host}`);
  // App updates go through the main process; a dev run looks nowhere and offers the releases page.
  const upd = await win.evaluate(() => window.meetless.updatesCheck());
  check('update check reaches the main process (dev run: no network, manual install)', upd.ok === true && upd.update.available === null && upd.update.install === 'manual', JSON.stringify(upd));
  await win.getByTestId('signin').waitFor();
  const lang = await win.evaluate(() => document.documentElement.lang);
  check('initial language from system locale', lang === 'zh-CN', `system=${JSON.stringify(sys)} ui=${lang}`);
  await win.screenshot({ path: `${shots}/electron-01-signin-zh-CN.png` });
  // A wrong address must produce a visible error (never "nothing happens") and a log line.
  await win.getByTestId('signin-server').fill('127.0.0.1:4870');
  await win.getByTestId('signin-token').fill('dev-lin');
  await win.getByTestId('signin-token').press('Enter');
  await win.getByTestId('signin-error').waitFor({ timeout: 15_000 });
  check('sign-in error is visible for an address without http://', (await win.getByTestId('signin-error').innerText()).includes('127.0.0.1:4870'));
  await win.getByTestId('signin-server').fill('http://127.0.0.1:4870');
  await win.getByTestId('signin-submit').click();
  await win.locator('[data-testid="sync-status"][data-state="online"]').waitFor({ timeout: 20_000 });
  check('signed in and synced over HTTP/WS', true);
  await win.getByTestId('nav-new-project').click();
  await win.getByTestId('project-name').fill('Electron 容器内验证');
  await win.getByTestId('project-create').click();
  await win.getByTestId('nav-project').filter({ hasText: 'Electron 容器内验证' }).waitFor();
  check('created a project through the UI', true);
  await win.getByTestId('lang-en').click();
  await win.getByTestId('nav-home').filter({ hasText: 'Home' }).waitFor();
  check('switched the UI to English', (await win.evaluate(() => document.documentElement.lang)) === 'en');
  await win.screenshot({ path: `${shots}/electron-02-project-en.png` });
  await app.close();
  const mainLog = existsSync(`${logDir}/main.log`) ? readFileSync(`${logDir}/main.log`, 'utf8') : '';
  check(
    'main process writes a log file with sign-in attempts and no token',
    mainLog.includes('signIn url="127.0.0.1:4870" result=URL_NO_SCHEME') && mainLog.includes('signIn url="http://127.0.0.1:4870" result=ok') && !mainLog.includes('dev-lin'),
    `${mainLog.split('\n').length} lines`,
  );

  // 3. Relaunch with the same data dir: session, cache and language must survive (A01 / A18, Linux only).
  app = await launch();
  win = await app.firstWindow();
  await win.locator('[data-testid="sync-status"]').waitFor({ timeout: 20_000 });
  const offlineFirst = await win.evaluate(() => window.meetless.snapshot());
  check('restart: session and cached events loaded from SQLite', offlineFirst.session?.userId === 'u-lin' && offlineFirst.events.length > 0, `${offlineFirst.events.length} events`);
  await win.getByTestId('nav-project').filter({ hasText: 'Electron 容器内验证' }).waitFor();
  const langAfter = await win.evaluate(() => document.documentElement.lang);
  check('restart: language setting persisted', langAfter === 'en', langAfter);
  await win.locator('[data-testid="sync-status"][data-state="online"]').waitFor({ timeout: 20_000 });
  check('restart: reconnected', true);
  await app.close();
} catch (e) {
  check('electron flow', false, String(e?.message ?? e).split('\n')[0]);
} finally {
  server.kill('SIGTERM');
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  await c.query(`drop schema if exists "${schema}" cascade`);
  await c.end();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\nElectron container e2e: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
