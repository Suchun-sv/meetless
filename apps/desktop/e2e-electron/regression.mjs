// Electron regression run for a major version (the Expo UI), INSIDE the Xvfb container
// (infra/dev/electron-e2e.sh with MEETLESS_E2E=regression), on Electron's own Node, as the sample user Alex.
// Writes go only to MEETLESS_TEST_PROJECT. The server is reached through a forwarder in this process
// (the server's name resolves to 127.0.0.1 here), so the run can take the network away for the offline step.
// Env: MEETLESS_SMOKE_SERVER, MEETLESS_SMOKE_TOKEN, MEETLESS_SMOKE_UPSTREAM (host:port the forwarder dials),
// MEETLESS_OFFICE_UPSTREAM (host:port of a DocumentServer, served on 127.0.0.1:55435), MEETLESS_TEST_PROJECT,
// MEETLESS_TEST_ARTIFACT (an Office artifact in it), MEETLESS_SHOTS_DIR.
import { createServer as createHttp } from 'node:http';
import { createServer, connect } from 'node:net';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron } from '@playwright/test';

const desktop = resolve(import.meta.dirname, '..');
const repo = resolve(desktop, '../..');
const shots = resolve(repo, process.env.MEETLESS_SHOTS_DIR || '.data/electron-shots');
const electronBin = resolve(desktop, 'node_modules/electron/dist/electron');
const server = process.env.MEETLESS_SMOKE_SERVER;
const token = process.env.MEETLESS_SMOKE_TOKEN;
const upstream = process.env.MEETLESS_SMOKE_UPSTREAM;
const T = process.env.MEETLESS_TEST_PROJECT;
const ART = process.env.MEETLESS_TEST_ARTIFACT;
if (!server || !token || !upstream || !T) throw new Error('MEETLESS_SMOKE_SERVER, MEETLESS_SMOKE_TOKEN, MEETLESS_SMOKE_UPSTREAM and MEETLESS_TEST_PROJECT are required');
const SAMPLE = process.env.MEETLESS_SAMPLE_PROJECT || 'sample-paper';
const SAMPLE_NEED = process.env.MEETLESS_SAMPLE_NEED || 'sample-paper:N4';
const base = '/tmp/meetless-regression';
rmSync(base, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A TCP forwarder 127.0.0.1:port -> target; stop() drops every connection (the network goes away). */
function forwarder(port, target) {
  const [host, tport] = [target.slice(0, target.lastIndexOf(':')), Number(target.slice(target.lastIndexOf(':') + 1))];
  const socks = new Set();
  let srv = null;
  const start = () =>
    new Promise((res) => {
      srv = createServer((c) => {
        const u = connect(tport, host);
        socks.add(c).add(u);
        const drop = () => (c.destroy(), u.destroy(), socks.delete(c), socks.delete(u));
        c.on('error', drop).on('close', drop);
        u.on('error', drop).on('close', drop);
        c.pipe(u).pipe(c);
      }).listen(port, '127.0.0.1', res);
    });
  const stop = () =>
    new Promise((res) => {
      for (const s of socks) s.destroy();
      socks.clear();
      srv ? srv.close(() => res()) : res();
      srv = null;
    });
  return { start, stop };
}

const net = forwarder(Number(new URL(server).port || 443), upstream);
await net.start();
if (process.env.MEETLESS_OFFICE_UPSTREAM) await forwarder(55435, process.env.MEETLESS_OFFICE_UPSTREAM).start();

// A newer release for the update callout: the updater's manifest and notes, as GitHub would serve them.
const releases = createHttp((req, res) => {
  if (req.url?.endsWith('/latest/download/latest-linux.yml')) return void res.end('version: 9.9.0\nfiles:\n  - url: Meetless-9.9.0.AppImage\n    sha512: x\n    size: 1\n');
  if (req.url?.endsWith('/api/releases/tags/v9.9.0')) return void res.end(JSON.stringify({ body: '- 回归检查用的假版本' }));
  res.writeHead(404).end();
}).listen(47999, '127.0.0.1');

const { ELECTRON_RUN_AS_NODE: _d, MEETLESS_SMOKE_TOKEN: _t, ...appEnv } = process.env;
let app;
let win;
async function launch() {
  app = await _electron.launch({
    executablePath: electronBin,
    // --no-sandbox: Chromium's sandbox needs user namespaces the container does not grant. Test container only.
    args: ['--no-sandbox', desktop],
    env: {
      ...appEnv,
      MEETLESS_USER_DATA_DIR: `${base}/userdata`,
      MEETLESS_CLIENT_DATA_DIR: `${base}/client`,
      MEETLESS_LOG_DIR: `${base}/logs`,
      MEETLESS_UPDATE_BASE: 'http://127.0.0.1:47999',
      LANGUAGE: 'zh_CN:zh',
      LANG: 'zh_CN.UTF-8',
    },
    timeout: 60_000,
  });
  win = await app.firstWindow();
  win.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()}: ${m.text()} @ ${m.location().url.slice(0, 80)}`));
  win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await win.waitForLoadState('domcontentloaded');
}
const shot = (name) => win.screenshot({ path: `${shots}/${name}.png` });
const tid = (id) => win.getByTestId(id);
async function go(path, wait) {
  await win.evaluate((u) => {
    location.href = u;
  }, `app://meetless${path}`);
  await tid('nav-home').waitFor({ timeout: 30_000 });
  if (wait) await tid(wait).first().waitFor({ timeout: 30_000 });
  await sleep(1500);
}
const snapshot = () => win.evaluate(() => window.meetless.snapshot());
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(name, false, String(e?.message ?? e).split('\n')[0].slice(0, 300));
    await shot(`fail-${name.replace(/[^a-z0-9]+/gi, '-')}`).catch(() => undefined);
  }
}

try {
  await launch();
  await step('sign-in', async () => {
    await tid('signin').waitFor({ timeout: 30_000 });
    await shot('01-signin');
    if (await tid('signin-mode-token').count()) await tid('signin-mode-token').click();
    await tid('signin-server').fill(server);
    await tid('signin-token').fill(token);
    await tid('signin-submit').click();
    await tid('nav-home').waitFor({ timeout: 30_000 });
    const s = await snapshot();
    check('sign-in as Alex (ClientNode, SQLite cache)', s.session?.displayName === 'Alex' && s.cacheKind === 'sqlite', `${s.session?.displayName}/${s.cacheKind}`);
  });
  await step('我的', async () => {
    await tid('page-home').waitFor({ timeout: 30_000 });
    await sleep(2500);
    await shot('02-home');
    check('我的 renders', true);
  });
  await step('update callout', async () => {
    await tid('update-callout').waitFor({ timeout: 30_000 });
    const text = await tid('update-callout').innerText();
    await shot('03-update-callout');
    check('update callout shows a newer release', /9\.9\.0/.test(text), text.replace(/\s+/g, ' ').slice(0, 80));
  });
  await step('board', async () => {
    await go(`/p/${SAMPLE}/board`, 'need-card');
    await shot('04-board');
    check('board renders need cards', (await tid('need-card').count()) > 0, `${await tid('need-card').count()} cards`);
  });
  await step('need detail', async () => {
    await go(`/p/${SAMPLE}/need/${encodeURIComponent(SAMPLE_NEED)}`, 'drawer');
    await shot('05-need-detail');
    check('need detail opens', true);
  });
  // Accepting an extract is extract.accepted; a new need comes with it (needId), a repeat joins the one it repeats.
  const accepted = async () => (await snapshot()).events.filter((e) => e.type === 'extract.accepted').map((e) => e.payload?.needId ?? null);
  const before = await accepted().catch(() => []);
  await step('paste import', async () => {
    await go(`/p/${T}/import`, 'imp-text');
    await tid('imp-title').fill(`回归检查 ${new Date().toISOString().slice(0, 16)}`);
    const run = Date.now().toString(36);
    await tid('imp-text').fill(`周会记录：Alex 负责在下周五前完成回归检查 ${run} 的报告初稿，并整理一份桌面版 ${run} 问题清单。`);
    await shot('06-import');
    await tid('imp-go').click();
    await win.waitForURL((u) => !u.pathname.endsWith('/import'), { timeout: 90_000 });
    await sleep(1500);
    check('paste import goes through', true, new URL(win.url()).pathname);
  });
  await step('confirm accept', async () => {
    await go(`/p/${T}/confirm`, 'x-accept');
    await shot('07-confirm');
    const n = await tid('x-accept').count();
    await tid('x-accept').first().click();
    let after = before;
    for (let i = 0; i < 30 && after.length <= before.length; i++) {
      await sleep(1000);
      after = await accepted();
    }
    await shot('08-confirm-accepted');
    const left = await tid('x-accept').count();
    check('confirm, accept: the extract becomes a need', after.length > before.length && left === n - 1, `${n} -> ${left} to confirm; accepted ${before.length} -> ${after.length}`);
  });
  await step('ask the Agent', async () => {
    await go(`/p/${T}`, 'composer-text');
    const n = await tid('msg-a').count();
    await tid('composer-text').fill('这个项目现在有哪些需求？');
    await tid('composer-send').click();
    await win.waitForFunction((k) => document.querySelectorAll('[data-testid="msg-a"]').length > k, n, { timeout: 90_000 });
    await sleep(2000);
    await shot('09-agent');
    check('the project Agent answers', true);
  });
  await step('handoff', async () => {
    const ids = (await accepted()).filter(Boolean);
    const need = ids[ids.length - 1];
    await go(`/p/${T}/handoff?need=${encodeURIComponent(need)}`, 'ho-send');
    await shot('10-handoff');
    check('handoff form opens for the new need', true, need);
  });
  await step('deliveries', async () => {
    await go(`/p/${SAMPLE}/deliveries`, 'page-deliveries');
    await shot('11-deliveries');
    check('deliveries renders', true);
  });
  if (ART) {
    await step('artifact OnlyOffice', async () => {
      await go(`/p/${T}/artifacts/${encodeURIComponent(ART)}`, 'oo-frame');
      // The editor frame is DocumentServer's own (127.0.0.1:55435) inside our host page.
      let editor = null;
      for (let i = 0; i < 40 && !editor; i++) {
        await sleep(1000);
        editor = win.frames().find((f) => f.url().startsWith('http://127.0.0.1:55435/') && /documenteditor|web-apps\/apps/.test(f.url())) ?? null;
      }
      await sleep(6000);
      const fallback = await win.getByText('OnlyOffice 不可用').count();
      await shot('12-artifact-onlyoffice');
      check('artifact opens in OnlyOffice', !!editor && fallback === 0, editor ? editor.url().slice(0, 80) : 'no editor frame');
    });
  }
  await step('quit and reopen keeps the route', async () => {
    const path = `/p/${SAMPLE}/deliveries`;
    await go(path, 'page-deliveries');
    await app.close();
    await launch();
    await tid('nav-home').waitFor({ timeout: 30_000 });
    await sleep(2000);
    await shot('13-reopened');
    const now = new URL(win.url()).pathname;
    check('quit and reopen comes back on the route', now === path, `${path} -> ${now}`);
  });
  await step('offline from the local cache', async () => {
    await net.stop();
    await app.close();
    await launch();
    await tid('nav-home').waitFor({ timeout: 30_000 });
    await go(`/p/${SAMPLE}/board`, 'need-card');
    await sleep(3000);
    const s = await snapshot();
    const cards = await tid('need-card').count();
    await shot('14-offline-board');
    check('offline: signed in, board from SQLite', s.status.state !== 'online' && s.session && s.events.length > 0 && cards > 0, `${s.status.state}, ${s.events.length} cached events, ${cards} cards`);
    await net.start();
    let state = s.status.state;
    for (let i = 0; i < 40 && state !== 'online'; i++) {
      await sleep(1000);
      state = (await snapshot()).status.state;
    }
    check('back online after the network returns', state === 'online', state);
  });
  const csp = errors.filter((e) => /Content Security Policy|Refused to/.test(e));
  check('no CSP violations', csp.length === 0, csp.slice(0, 3).join(' | '));
  const pageErrors = errors.filter((e) => e.startsWith('pageerror'));
  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (e) {
  check('regression run', false, String(e?.stack ?? e));
} finally {
  if (errors.length) console.log(`console:\n${errors.slice(0, 40).join('\n')}`);
  await app?.close().catch(() => undefined);
  releases.close();
  await net.stop();
}
console.log(failed ? `${failed} FAILED` : 'ALL PASS', `shots in ${shots}`);
process.exit(failed ? 1 : 0);
