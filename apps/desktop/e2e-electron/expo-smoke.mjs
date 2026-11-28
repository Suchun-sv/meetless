// Electron smoke for the Expo renderer (MEETLESS_UI=expo), run INSIDE the Xvfb container
// (infra/dev/electron-e2e.sh) with Electron's own Node. Signs in to the trial server as the sample
// user Alex and screenshots Home. Env: MEETLESS_SMOKE_SERVER, MEETLESS_SMOKE_TOKEN, MEETLESS_SHOTS_DIR.
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron } from '@playwright/test';

const desktop = resolve(import.meta.dirname, '..');
const repo = resolve(desktop, '../..');
const shots = resolve(repo, process.env.MEETLESS_SHOTS_DIR || '.data/electron-shots');
const electronBin = resolve(desktop, 'node_modules/electron/dist/electron');
const server = process.env.MEETLESS_SMOKE_SERVER;
const token = process.env.MEETLESS_SMOKE_TOKEN;
if (!server || !token) throw new Error('MEETLESS_SMOKE_SERVER and MEETLESS_SMOKE_TOKEN are required');
const clientDir = '/tmp/meetless-expo-client';
const logDir = '/tmp/meetless-expo-logs';
rmSync(clientDir, { recursive: true, force: true });
rmSync(logDir, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const { ELECTRON_RUN_AS_NODE: _drop, MEETLESS_SMOKE_TOKEN: _t, ...appEnv } = process.env;
const errors = [];

const app = await _electron.launch({
  executablePath: electronBin,
  // --no-sandbox: Chromium's sandbox needs user namespaces the container does not grant. Test container only.
  args: ['--no-sandbox', desktop],
  env: { ...appEnv, MEETLESS_CLIENT_DATA_DIR: clientDir, MEETLESS_LOG_DIR: logDir, LANGUAGE: 'zh_CN:zh', LANG: 'zh_CN.UTF-8' },
  timeout: 60_000,
});
try {
  const win = await app.firstWindow();
  win.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()}: ${m.text()}`));
  win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await win.waitForLoadState('domcontentloaded');
  check('renderer is the Expo export on app://meetless', win.url().startsWith('app://meetless/'), win.url());
  // Metro's prelude defines a bare `process` ({ env }) on the web too; Node's would have versions.node.
  const iso = await win.evaluate(() => ({ bridge: typeof window.meetless, shell: window.meetlessShell ?? null, require: typeof window.require, node: typeof window.process?.versions?.node }));
  check('bridge and capabilities, no Node globals', iso.bridge === 'object' && iso.require === 'undefined' && iso.node === 'undefined' && iso.shell?.capabilities?.includes('localGit'), JSON.stringify(iso));
  const snap = await win.evaluate(() => window.meetless.snapshot());
  check('ClientNode with the SQLite cache', snap.cacheKind === 'sqlite' && snap.host === 'electron', `${snap.cacheKind}/${snap.host}`);

  await win.getByTestId('signin').waitFor({ timeout: 30_000 });
  await win.screenshot({ path: `${shots}/expo-01-signin.png` });
  // Sign-in opens on the invite tab (as the old renderer did); the token form is the other one.
  if (await win.getByTestId('signin-mode-token').count()) await win.getByTestId('signin-mode-token').click();
  await win.getByTestId('signin-server').fill(server);
  await win.getByTestId('signin-token').fill(token);
  await win.getByTestId('signin-submit').click();
  await win.getByTestId('nav-home').waitFor({ timeout: 30_000 });
  await win.waitForTimeout(3000);
  await win.screenshot({ path: `${shots}/expo-02-home.png` });
  const signedIn = await win.evaluate(() => window.meetless.snapshot().then((s) => s.session?.displayName ?? null));
  check('signed in, Home shows', !!signedIn, String(signedIn));

  // A deep link survives a reload: the protocol's single-page fallback serves index.html for routes.
  const proj = win.locator('[data-testid^="nav-project-"]').first();
  if (await proj.count()) {
    await proj.click();
    await win.waitForTimeout(1500);
    const path = await win.evaluate(() => location.pathname);
    await win.reload();
    await win.getByTestId('nav-home').waitFor({ timeout: 30_000 });
    await win.waitForTimeout(2000);
    const after = await win.evaluate(() => location.pathname);
    check('route kept across a reload', path !== '/' && after === path, `${path} -> ${after}`);
    await win.screenshot({ path: `${shots}/expo-03-project-reloaded.png` });
  }
  // MEETLESS_SMOKE_PATHS: more pages to open and screenshot, comma-separated; `path#testID` also waits for
  // that element, and `path#testID>clickID` then clicks another one (e.g. to open a panel) before the shot.
  for (const entry of (process.env.MEETLESS_SMOKE_PATHS ?? '').split(',').filter(Boolean)) {
    const [path, rest] = entry.split('#');
    const [testId, clickId] = (rest ?? '').split('>');
    const before = errors.filter((e) => e.startsWith('pageerror')).length;
    await win.evaluate((u) => {
      location.href = u;
    }, `app://meetless${path}`);
    await win.getByTestId('nav-home').waitFor({ timeout: 30_000 });
    let found = true;
    if (testId) found = await win.getByTestId(testId).first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
    if (found && clickId) {
      await win.getByTestId(clickId).first().click();
      await win.waitForTimeout(2500);
    }
    await win.waitForTimeout(2000);
    await win.screenshot({ path: `${shots}/expo-path${path.replace(/[^a-z0-9]+/gi, '_')}.png` });
    const crashed = errors.filter((e) => e.startsWith('pageerror')).length > before;
    check(`opens ${path}${testId ? ` with ${testId}` : ''}`, found && !crashed, crashed ? 'page error' : found ? '' : `${testId} not found`);
  }
  const csp = errors.filter((e) => /Content Security Policy|Refused to/.test(e));
  check('no CSP violations', csp.length === 0, csp.slice(0, 3).join(' | '));
} catch (e) {
  check('smoke run', false, String(e?.stack ?? e));
} finally {
  if (errors.length) console.log(`console:\n${errors.slice(0, 30).join('\n')}`);
  await app.close().catch(() => undefined);
}
console.log(failed ? `${failed} FAILED` : 'ALL PASS', `shots in ${shots}`);
process.exit(failed ? 1 : 0);
