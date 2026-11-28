// Electron smoke for the 「需求」 inbox and 我的 (mobile-v2), INSIDE the Xvfb container (infra/dev/electron-e2e.sh
// with MEETLESS_E2E_SCRIPT=e2e-electron/inbox-smoke.mjs), as the sample user Alex. No commit and no Claude Code
// turn: the file picker, the album picker and a dropped file each add one material to Alex's inbox, removed at the end.
// Env: MEETLESS_SMOKE_SERVER, MEETLESS_SMOKE_TOKEN, MEETLESS_SHOTS_DIR.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron } from '@playwright/test';

const desktop = resolve(import.meta.dirname, '..');
const repo = resolve(desktop, '../..');
const shots = resolve(repo, process.env.MEETLESS_SHOTS_DIR || '.data/electron-shots');
const electronBin = resolve(desktop, 'node_modules/electron/dist/electron');
const server = process.env.MEETLESS_SMOKE_SERVER;
const token = process.env.MEETLESS_SMOKE_TOKEN;
if (!server || !token) throw new Error('MEETLESS_SMOKE_SERVER and MEETLESS_SMOKE_TOKEN are required');
const base = '/tmp/meetless-inbox-smoke';
rmSync(base, { recursive: true, force: true });
mkdirSync(`${base}/files`, { recursive: true });
mkdirSync(shots, { recursive: true });
// Small inputs for the pickers and the drop: a note and a 1x1 PNG.
const note = `${base}/files/smoke-note.txt`;
writeFileSync(note, `Smoke ${Date.now()}：请在 12月20日 前整理一份桌面版收件箱的测试记录。\n`);
const png = `${base}/files/smoke.png`;
writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { ELECTRON_RUN_AS_NODE: _d, MEETLESS_SMOKE_TOKEN: _t, ...appEnv } = process.env;
const app = await _electron.launch({
  executablePath: electronBin,
  args: ['--no-sandbox', desktop],
  env: { ...appEnv, MEETLESS_USER_DATA_DIR: `${base}/userdata`, MEETLESS_CLIENT_DATA_DIR: `${base}/client`, MEETLESS_LOG_DIR: `${base}/logs`, LANGUAGE: 'zh_CN:zh', LANG: 'zh_CN.UTF-8' },
  timeout: 60_000,
});
const win = await app.firstWindow();
win.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()}: ${m.text()} @ ${m.location().url.slice(0, 60)}`));
win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const tid = (id) => win.getByTestId(id);
const shot = (n) => win.screenshot({ path: `${shots}/${n}.png` });
const go = async (path, wait) => {
  await win.evaluate((u) => {
    location.href = u;
  }, `app://meetless${path}`);
  await tid(wait).first().waitFor({ timeout: 30_000 });
  await sleep(1500);
};
const api = (name, input) => win.evaluate(([n, i]) => window.meetless.api(n, i), [name, input]);
const added = new Set();
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(name, false, String(e?.message ?? e).split('\n')[0].slice(0, 240));
    await shot(`fail-${name.replace(/[^a-z0-9]+/gi, '-')}`).catch(() => undefined);
  }
}
const inboxIds = async () => {
  const r = await api('inbox.list', {});
  return r.ok ? [...r.data.pending, ...r.data.recent].map((c) => c.id) : [];
};

try {
  await win.waitForLoadState('domcontentloaded');
  await step('sign-in', async () => {
    await tid('signin').waitFor({ timeout: 30_000 });
    if (await tid('signin-mode-token').count()) await tid('signin-mode-token').click();
    await tid('signin-server').fill(server);
    await tid('signin-token').fill(token);
    await tid('signin-submit').click();
    await tid('nav-home').waitFor({ timeout: 30_000 });
    check('sign-in as Alex', true);
  });
  await step('我的 calendar paging', async () => {
    await go('/', 'page-home');
    const cal = tid('mine-cal-pages');
    if (!(await cal.count())) {
      await shot('01-mine');
      check('我的 renders (no calendar pager on this width)', true);
      return;
    }
    const before = await tid('mine-calendar').innerText();
    await shot('01-mine');
    const box = await cal.boundingBox();
    await win.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    await win.mouse.down();
    await win.mouse.move(box.x + box.width * 0.15, box.y + box.height / 2, { steps: 12 });
    await win.mouse.up();
    await sleep(1200);
    const after = await tid('mine-calendar').innerText();
    await shot('02-mine-paged');
    check('我的 calendar pages on a swipe', before !== after, after.split('\n')[0]);
  });
  const before = new Set(await inboxIds());
  await step('需求 tab', async () => {
    await go('/inbox', 'inbox');
    await sleep(1500);
    const cards = await tid('inbox-card').count();
    await shot('03-inbox');
    check('需求 lists the server materials', cards > 0, `${cards} cards`);
  });
  await step('open a material (B3)', async () => {
    await tid('inbox-card').first().click();
    await tid('material').first().waitFor({ timeout: 30_000 });
    await sleep(2000);
    const b3 = (await tid('rv-suggest').count()) + (await tid('rv-items').count()) + (await tid('rv-split').count());
    await shot('04-material');
    check('a pending material opens on its review (B3)', b3 > 0, `${b3} review blocks`);
  });
  await step('file picker', async () => {
    await go('/inbox', 'inbox');
    const [chooser] = await Promise.all([win.waitForEvent('filechooser', { timeout: 15_000 }), tid('inbox-file').click()]);
    await chooser.setFiles(note);
    await sleep(4000);
    await shot('05-file-picked');
    const now = await inboxIds();
    const fresh = now.filter((id) => !before.has(id));
    fresh.forEach((id) => added.add(id));
    check('文件 picker opens and the picked file comes in', fresh.length >= 1, `${fresh.length} new`);
  });
  await step('album picker', async () => {
    await go('/inbox', 'inbox');
    const [chooser] = await Promise.all([win.waitForEvent('filechooser', { timeout: 15_000 }), tid('inbox-album').click()]);
    await chooser.setFiles(png);
    await sleep(4000);
    await shot('06-album-picked');
    const fresh = (await inboxIds()).filter((id) => !before.has(id) && !added.has(id));
    fresh.forEach((id) => added.add(id));
    check('相册 picker opens without a crash', true, `${fresh.length} new`);
  });
  await step('drag and drop', async () => {
    await go('/inbox', 'inbox');
    const n0 = (await inboxIds()).length;
    await win.evaluate(() => {
      const el = document.querySelector('[data-testid="inbox"]');
      const dt = new DataTransfer();
      dt.items.add(new File([`拖进来的测试 ${Date.now()}：12月22日 前检查拖放。`], 'dropped.txt', { type: 'text/plain' }));
      for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await sleep(5000);
    await shot('07-dropped');
    const ids = await inboxIds();
    ids.filter((id) => !before.has(id)).forEach((id) => added.add(id));
    check('a dropped file comes in (or at least nothing breaks)', ids.length > n0, `${n0} -> ${ids.length}`);
  });
  await step('board', async () => {
    await go('/p/sample-paper/board', 'need-card');
    await shot('08-board');
    check('board renders', (await tid('need-card').count()) > 0);
  });
  await step('need detail', async () => {
    await go(`/p/sample-paper/need/${encodeURIComponent('sample-paper:N4')}`, 'drawer');
    await shot('09-need');
    check('need detail opens', true);
  });
  // Take back what the pickers and the drop added (no commit was made): once analysed, remove them.
  for (const id of added) {
    for (let i = 0; i < 40; i++) {
      const r = await api('inbox.remove', { materialId: id });
      if (r.ok) break;
      await sleep(3000);
    }
  }
  const left = (await inboxIds()).filter((id) => added.has(id));
  check('smoke materials removed again', left.length === 0, `${added.size} added, ${left.length} left`);
  const csp = errors.filter((e) => /Content Security Policy|Refused to/.test(e));
  check('no CSP violations', csp.length === 0, csp.slice(0, 2).join(' | '));
  const pe = errors.filter((e) => e.startsWith('pageerror'));
  check('no page errors', pe.length === 0, pe.slice(0, 2).join(' | '));
} catch (e) {
  check('inbox smoke', false, String(e?.stack ?? e));
} finally {
  if (errors.length) console.log(`console:\n${errors.slice(0, 20).join('\n')}`);
  await app.close().catch(() => undefined);
}
console.log(failed ? `${failed} FAILED` : 'ALL PASS', `shots in ${shots}`);
process.exit(failed ? 1 : 0);
