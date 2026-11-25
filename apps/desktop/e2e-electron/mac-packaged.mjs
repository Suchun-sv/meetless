// GUI acceptance run of the PACKAGED macOS app (release/dist/mac-arm64/Meetless.app), driven by
// Playwright's _electron.launch. Opens a real window, so it needs explicit approval for the Mac it
// runs on (docs/MACOS.md). It never touches /Applications, quarantine or Gatekeeper settings, and
// takes no screen capture: screenshots come from the app's own renderer (page.screenshot()).
//
// Needs a sync server on loopback, e.g. an SSH local forward to a server on the dev server:
//   MEETLESS_SYNC_URL=http://127.0.0.1:48710 node e2e-electron/mac-packaged.mjs
// Sign-in: a dev token (MEETLESS_DEV_TOKEN, default dev-lin; the server needs MEETLESS_DEV_AUTH=1),
// or, for a server with dev auth off, an invite code (MEETLESS_INVITE_CODE plus MEETLESS_NAME).
// Evidence (screenshots, app log, ps output, results.json) goes to docs/screenshots/v3/macos/.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from '@playwright/test';

const desktop = resolve(import.meta.dirname, '..');
const repo = resolve(desktop, '../..');
const evidence = resolve(repo, 'docs/screenshots/v3/macos');
const bin = resolve(desktop, process.env.MEETLESS_APP_BIN ?? 'release/dist/mac-arm64/Meetless.app/Contents/MacOS/Meetless');
const serverUrl = process.env.MEETLESS_SYNC_URL;
const inviteCode = process.env.MEETLESS_INVITE_CODE ?? '';
const inviteName = process.env.MEETLESS_NAME ?? 'macOS check';
const token = process.env.MEETLESS_DEV_TOKEN ?? 'dev-lin';
if (!serverUrl || !/^http:\/\/127\.0\.0\.1:\d+$/.test(serverUrl)) throw new Error('MEETLESS_SYNC_URL must be http://127.0.0.1:<port> (loopback only)');
if (!existsSync(bin)) throw new Error(`packaged binary not found: ${bin}`);

const tmp = mkdtempSync(join(tmpdir(), 'meetless-gui-'));
const userData = join(tmp, 'userdata');
const clientDir = join(tmp, 'client');
const logFile = join(tmp, 'meetless-main.log');
mkdirSync(evidence, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
};
const psLines = [];
const ps = (label, pid) => {
  let out;
  try {
    out = execFileSync('ps', ['-o', 'pid,ppid,stat,etime,rss,command', '-p', String(pid)], { encoding: 'utf8' });
  } catch (e) {
    out = (e.stdout ?? '') || `(no process ${pid})\n`;
  }
  psLines.push(`## ${label} (pid ${pid})\n${out}`);
  return out;
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const waitGone = async (pid, ms = 15_000) => {
  const end = Date.now() + ms;
  while (alive(pid) && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
  return !alive(pid);
};

const { ELECTRON_RUN_AS_NODE: _drop, ...baseEnv } = process.env;
const launch = () =>
  _electron.launch({
    executablePath: bin,
    args: [],
    env: {
      ...baseEnv,
      MEETLESS_LAUNCH_INACTIVE: '1',
      MEETLESS_USER_DATA_DIR: userData,
      MEETLESS_CLIENT_DATA_DIR: clientDir,
      MEETLESS_LOG_FILE: logFile,
    },
    timeout: 60_000,
  });
const lang = (win) => win.evaluate(() => document.documentElement.lang);
// v3: the sidebar's user row has one button per language (shell/Sidebar.tsx, testid lang-<locale>).
const switchLang = async (win, to) => {
  await win.getByTestId(`lang-${to}`).click();
  await win.waitForFunction((l) => document.documentElement.lang === l, to, { timeout: 10_000 });
};

const projectName = `macOS 验收 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
let app = null;
let finalLang = null;
try {
  // 1. First launch from the build output dir.
  app = await launch();
  const pid1 = app.process().pid;
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  ps('first launch', pid1);
  const info = await app.evaluate(({ app: a, BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { name: a.getName(), version: a.getVersion(), packaged: a.isPackaged, appPath: a.getAppPath(), windows: BrowserWindow.getAllWindows().length, focused: w?.isFocused() ?? null, visible: w?.isVisible() ?? null };
  });
  check('packaged app launched from build dir', info.packaged && info.appPath.endsWith('app.asar') && bin.includes('/release/dist/'), info);
  await win.getByTestId('signin').waitFor({ timeout: 30_000 });
  const iso = await win.evaluate(() => ({ bridge: typeof window.meetless, require: typeof window.require, process: typeof window.process }));
  check('window rendered; renderer has the bridge but no Node globals', iso.bridge === 'object' && iso.require === 'undefined' && iso.process === 'undefined', iso);
  const snap0 = await win.evaluate(() => window.meetless.snapshot());
  check('main process uses node:sqlite cache', snap0.cacheKind === 'sqlite' && snap0.host === 'electron', `${snap0.cacheKind}/${snap0.host}`);
  const lang0 = await lang(win);
  check('initial UI language from system locale', lang0 === 'zh-CN' || lang0 === 'en', `system=${JSON.stringify(snap0.systemLocales)} ui=${lang0}`);
  await win.screenshot({ path: join(evidence, `01-signin-${lang0}.png`) });

  // 2. Sign in against the loopback sync server (invite code, else dev token), then sync.
  await win.getByTestId('signin-server').fill(serverUrl);
  if (inviteCode) {
    await win.getByTestId('signin-name').fill(inviteName);
    await win.getByTestId('signin-code').fill(inviteCode);
    await win.getByTestId('signin-redeem').click();
  } else {
    await win.getByTestId('signin-token').fill(token);
    await win.getByTestId('signin-submit').click();
  }
  await win.locator('[data-testid="sync-status"][data-state="online"]').waitFor({ timeout: 30_000 });
  const me = (await win.evaluate(() => window.meetless.snapshot())).session?.userId ?? null;
  check(`${inviteCode ? 'invite' : 'dev'} sign-in and sync online`, me !== null, `${serverUrl} as ${me}`);
  await win.getByTestId('nav-new-project').click();
  await win.getByTestId('project-name').fill(projectName);
  await win.getByTestId('project-create').click();
  await win.getByTestId('nav-project').filter({ hasText: projectName }).waitFor({ timeout: 20_000 });
  const snap1 = await win.evaluate(() => window.meetless.snapshot());
  check('project created and synced state shown', snap1.events.length > 0 && snap1.status.state === 'online', `${snap1.events.length} server-accepted events`);

  // 3. Language switch both ways; end on the language that is NOT the system default.
  const other = lang0 === 'zh-CN' ? 'en' : 'zh-CN';
  await switchLang(win, other);
  await win.screenshot({ path: join(evidence, `02-project-${other}.png`) });
  await switchLang(win, lang0);
  await win.screenshot({ path: join(evidence, `03-project-${lang0}.png`) });
  await switchLang(win, other);
  finalLang = other;
  check('language switched zh-CN <-> en', (await lang(win)) === other, `${lang0} -> ${other} -> ${lang0} -> ${other}`);

  // 4. Quit and verify the process is gone.
  await app.close();
  app = null;
  check('quit: process exited', await waitGone(pid1), `pid ${pid1}`);
  ps('after first quit', pid1);

  // 5. Relaunch with the same temp data dirs: session, cache and language retained.
  app = await launch();
  const pid2 = app.process().pid;
  const win2 = await app.firstWindow();
  await win2.locator('[data-testid="sync-status"]').waitFor({ timeout: 30_000 });
  ps('relaunch', pid2);
  const snap2 = await win2.evaluate(() => window.meetless.snapshot());
  check('relaunch: session and cached events loaded from SQLite', snap2.session?.userId === me && snap2.events.length >= snap1.events.length, `${snap2.events.length} events, user ${snap2.session?.userId}`);
  await win2.getByTestId('nav-project').filter({ hasText: projectName }).waitFor({ timeout: 20_000 });
  const lang2 = await lang(win2);
  check('relaunch: language setting retained', lang2 === finalLang, lang2);
  await win2.locator('[data-testid="sync-status"][data-state="online"]').waitFor({ timeout: 30_000 });
  check('relaunch: reconnected to sync', true);
  await win2.screenshot({ path: join(evidence, `04-relaunch-${lang2}.png`) });
  await app.close();
  app = null;
  check('quit after relaunch: process exited', await waitGone(pid2), `pid ${pid2}`);
  ps('after second quit', pid2);
} catch (e) {
  check('gui flow', false, String(e?.message ?? e).split('\n')[0]);
} finally {
  if (app) {
    const pid = app.process().pid;
    await app.close().catch(() => {});
    if (!(await waitGone(pid, 5_000))) process.kill(pid, 'SIGKILL');
  }
  if (existsSync(logFile)) copyFileSync(logFile, join(evidence, 'meetless-main.log'));
  writeFileSync(join(evidence, 'ps.txt'), psLines.join('\n'));
  writeFileSync(join(evidence, 'results.json'), `${JSON.stringify({ when: new Date().toISOString(), bin, serverUrl, results }, null, 2)}\n`);
  rmSync(tmp, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\nmacOS packaged GUI run: ${results.length - failed} passed, ${failed} failed (temp dir ${tmp} removed)`);
process.exit(failed ? 1 : 0);
