import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { DOT_RE, replay, type DomainEvent, type Need } from '@meetless/core';
import type { ClientSnapshot, SubmitResult } from '@meetless/client/bridge';
import { marksBeforeCodes } from '../test/support/markup';
import { bridgeCall, bridgePort, clientUrl, dataDir, type BridgeSpec } from './env';
import { text } from './i18n';
import { startBridgeProc, type Proc } from './procs';

/*
 * The v3 skeleton against a real server with the zh-CN sample loaded (global setup).
 * Client A is Alex (dev-alex) in zh-CN, client B is Zhou (dev-zhou) in en. Each client
 * is its own dev bridge host process with its own data dir and SQLite cache.
 */
const A: BridgeSpec = { name: 'alex', port: bridgePort(1), token: 'e2e-bridge-alex', locale: 'zh-CN' };
const B: BridgeSpec = { name: 'zhou', port: bridgePort(2), token: 'e2e-bridge-zhou', locale: 'en-US' };
const PAPER = 'sample-paper';
const ATLAS = 'sample-atlas';
const GLOBAL: [testid: string, view: string][] = [
  ['nav-home', 'home'],
  ['nav-new-project', 'newProject'],
  ['nav-agents', 'agents'],
];
const SECTIONS = ['dash', 'board', 'inputs', 'artifacts', 'stream', 'deliveries'];

test.describe.configure({ mode: 'serial' });

let procs: Proc[] = [];
let alex: Page;
let zhou: Page;

async function openSignedIn(browser: Browser, b: BridgeSpec, token: string, lang: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(clientUrl(b));
  await expect(page.getByTestId('signin')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  await expectClean(page, 'signin');
  await page.getByTestId('signin-token').fill(token);
  await page.getByTestId('signin-submit').click();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'online');
  return page;
}

/** No dot character in the visible text, and no mark before a need code in the markup. */
async function expectClean(page: Page, label: string): Promise<void> {
  const text = await page.locator('body').innerText();
  expect(DOT_RE.test(text), `${label}: dot character in ${JSON.stringify(text.match(DOT_RE)?.[0])}`).toBe(false);
  // The browser serialises void elements without "/>"; the guard reads them as such only when closed.
  const html = (await page.locator('body').innerHTML()).replace(/<(area|br|col|embed|hr|img|input|link|meta|source|track|wbr)\b([^>]*?)\/?>/g, '<$1$2/>');
  expect(marksBeforeCodes(html), `${label}: mark before a need code`).toEqual([]);
}

async function projectsIn(page: Page): Promise<string[]> {
  return page.getByTestId('nav-project').evaluateAll((els) => els.map((e) => e.getAttribute('data-project') ?? ''));
}

/** Visits every route the sidebar reaches (global views, then each section of each project); calls `each` on every page. */
async function visitAll(page: Page, projects: string[], each: (view: string, project: string | null) => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  for (const [id, view] of GLOBAL) {
    await page.getByTestId(id).click();
    await expect(page.getByTestId(`page-${view}`)).toBeVisible();
    seen.push(view);
    await each(view, null);
  }
  for (const p of projects) {
    await page.locator(`[data-testid="nav-project"][data-project="${p}"]`).click();
    await expect(page.getByTestId('page-dash')).toBeVisible();
    for (const s of SECTIONS) {
      await page.getByTestId(`nav-${s}`).click();
      await expect(page.getByTestId(`page-${s}`)).toBeVisible();
      await expect(page.getByTestId('topbar-confirm')).toBeVisible();
      seen.push(`${p}/${s}`);
      await each(s, p);
    }
  }
  return seen;
}

/** Every file under a client's data dir (session, prefs, the SQLite cache and its WAL), as one buffer. */
function diskBytes(dir: string): Buffer {
  const parts: Buffer[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const f = join(d, name);
      if (statSync(f).isDirectory()) walk(f);
      else parts.push(readFileSync(f));
    }
  };
  walk(dir);
  return Buffer.concat(parts);
}

test.beforeAll(async ({ browser }) => {
  // Keep every bridge that did start, so afterAll stops it even when the other one failed.
  const started = await Promise.allSettled([A, B].map((b) => startBridgeProc({ dataDir: dataDir(b), port: b.port, locale: b.locale, token: b.token })));
  procs = started.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const failed = started.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
  alex = await openSignedIn(browser, A, 'dev-alex', 'zh-CN');
  zhou = await openSignedIn(browser, B, 'dev-zhou', 'en');
});
test.afterAll(async () => {
  await alex?.context().close();
  await zhou?.context().close();
  for (const p of procs) await p.stop();
});

test('both clients sign in, see the sample projects and reach every route', async () => {
  expect(await projectsIn(alex)).toEqual([PAPER, ATLAS]);
  expect(await projectsIn(zhou)).toEqual([ATLAS]);
  for (const [page, locale] of [
    [alex, 'zh-CN'],
    [zhou, 'en'],
  ] as const) {
    await expect(page.locator('body')).toContainText(text(locale, 'app.sample'));
    await expect(page.getByTestId('nav-home')).toContainText(text(locale, 'nav.home'));
  }
  const none = async () => undefined;
  expect(await visitAll(alex, [PAPER, ATLAS], none)).toHaveLength(GLOBAL.length + 2 * SECTIONS.length);
  expect(await visitAll(zhou, [ATLAS], none)).toHaveLength(GLOBAL.length + SECTIONS.length);
});

test('Alex’s private hypothesis never appears in Zhou’s page or cache', async () => {
  const snapA = await bridgeCall<ClientSnapshot>(A, 'snapshot');
  const hp1 = Object.values(replay(snapA.events as DomainEvent[]).needs).find((n: Need) => n.projectId === PAPER && n.code === 'Hp1');
  expect(hp1, 'Alex holds his private hypothesis Hp1').toBeDefined();
  expect(hp1!.privateTo).toBe('u-alex');
  // Positive control: the title is on Alex's disk, so the search below can find it.
  expect(diskBytes(dataDir(A)).includes(Buffer.from(hp1!.title))).toBe(true);

  // Alex adds Zhou to the paper, so Zhou receives every shared paper record.
  const added = await bridgeCall<SubmitResult>(A, 'submit', { id: 'e2e-add-zhou-to-paper', type: 'project.member_added', payload: { projectId: PAPER, userId: 'u-zhou' } });
  expect(added.kind).toBe('accepted');
  await expect(zhou.locator(`[data-testid="nav-project"][data-project="${PAPER}"]`)).toBeVisible();

  const snapB = await bridgeCall<ClientSnapshot>(B, 'snapshot');
  const zhouState = replay(snapB.events as DomainEvent[]);
  expect(Object.values(zhouState.needs).some((n) => n.projectId === PAPER && n.code === 'N1'), 'Zhou has the shared paper needs').toBe(true);
  expect(zhouState.needs[hp1!.id]).toBeUndefined();
  const wire = JSON.stringify(snapB);
  for (const s of [hp1!.id, hp1!.title]) expect(wire.includes(s), `snapshot holds ${s}`).toBe(false);

  const texts: string[] = [];
  await visitAll(zhou, [PAPER], async () => void texts.push(await zhou.locator('body').innerText()));
  for (const text of texts) {
    expect(text).not.toContain(hp1!.title);
    expect(text).not.toContain('Hp1');
  }

  const disk = diskBytes(dataDir(B));
  expect(disk.includes(Buffer.from(`"${PAPER}:N1"`)), 'Zhou’s cache holds the shared paper records').toBe(true);
  for (const s of [hp1!.id, hp1!.title]) expect(disk.includes(Buffer.from(s)), `Zhou’s disk holds ${s}`).toBe(false);
});

test('no page in either language contains a dot symbol', async () => {
  for (const [page, label] of [
    [alex, 'zh-CN'],
    [zhou, 'en'],
  ] as const) {
    const visited = await visitAll(page, await projectsIn(page), (view, project) => expectClean(page, `${label} ${project ?? ''}/${view}`));
    expect(visited.length).toBeGreaterThanOrEqual(GLOBAL.length + SECTIONS.length);
  }
});
