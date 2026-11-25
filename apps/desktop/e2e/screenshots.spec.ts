import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { replay, type DomainEvent } from '@meetless/core';
import type { ClientSnapshot } from '@meetless/client/bridge';
import type { Locale } from '@meetless/i18n';
import { bridgeCall, bridgePort, clientUrl, dataDir, serverUrl, type BridgeSpec } from './env';
import { startBridgeProc, type Proc } from './procs';

/*
 * Screenshots of every v3 page and main overlay, one set per language, for the page-by-page
 * comparison with the prototype (design §10). Skipped unless MEETLESS_SHOTS_V3=1. Alex (dev-alex,
 * zh-CN) and Zhou (dev-zhou, en) on the zh-CN sample's Atlas project, at 1440x900, written to
 * docs/screenshots/v3/<locale>-<page>.png.
 *
 * Bridge slots 9 and 6: this file sorts before signin.spec.ts (6) and story.spec.ts (9, 6), and
 * stops its bridges in afterAll, so in a full run the slots are free again when those start.
 */
const SHOTS = process.env.MEETLESS_SHOTS_V3 === '1';
const OUT = resolve(import.meta.dirname, '../../../docs/screenshots/v3');
const ATLAS = 'sample-atlas';
const VIEWPORT = { width: 1440, height: 900 };
const CLIENTS: { spec: BridgeSpec; locale: Locale; lang: string; token: string }[] = [
  { spec: { name: 'shots-zh', port: bridgePort(9), token: 'e2e-shots-zh', locale: 'zh-CN' }, locale: 'zh-CN', lang: 'zh-CN', token: 'dev-alex' },
  { spec: { name: 'shots-en', port: bridgePort(6), token: 'e2e-shots-en', locale: 'en' }, locale: 'en', lang: 'en', token: 'dev-zhou' },
];

test.describe.configure({ mode: 'serial' });
test.skip(!SHOTS, 'screenshots only with MEETLESS_SHOTS_V3=1');

let procs: Proc[] = [];

test.beforeAll(async () => {
  if (!SHOTS) return;
  mkdirSync(OUT, { recursive: true });
  const started = await Promise.allSettled(CLIENTS.map(({ spec }) => startBridgeProc({ dataDir: dataDir(spec), port: spec.port, locale: spec.locale, token: spec.token })));
  procs = started.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const failed = started.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
});
test.afterAll(async () => {
  for (const p of procs) await p.stop();
});

async function shot(page: Page, locale: Locale, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(250); // let transitions settle
  await page.screenshot({ path: resolve(OUT, `${locale}-${name}.png`) });
}

async function go(page: Page, testid: string, view: string): Promise<void> {
  await page.getByTestId(testid).click();
  await expect(page.getByTestId(`page-${view}`)).toBeVisible();
}

async function openAtlas(page: Page): Promise<void> {
  await page.locator(`[data-testid="nav-project"][data-project="${ATLAS}"]`).click();
  await expect(page.getByTestId('page-dash')).toBeVisible();
}

async function close(page: Page, overlay: string): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId(overlay)).toBeHidden();
}

async function shootAll(browser: Browser, c: (typeof CLIENTS)[number]): Promise<void> {
  const { spec, locale, lang, token } = c;
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  try {
    await page.goto(clientUrl(spec));
    await expect(page.getByTestId('signin')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.getByTestId('signin-server')).toHaveValue(serverUrl);
    await shot(page, locale, 'signin');
    await page.getByTestId('signin-token').fill(token);
    await page.getByTestId('signin-submit').click();
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'online');

    await go(page, 'nav-home', 'home');
    await shot(page, locale, 'home');
    await openAtlas(page);
    await shot(page, locale, 'dash');

    await go(page, 'nav-board', 'board');
    await page.getByTestId('board-mode-rounds').click();
    await shot(page, locale, 'board-rounds');
    await page.getByTestId('board-mode-lineage').click();
    await expect(page.getByTestId('lineage')).toBeVisible();
    await shot(page, locale, 'board-lineage');
    await page.getByTestId('board-mode-rounds').click();

    // N2 has a handoff and a fetched context in the sample: the richest drawer.
    const state = replay((await bridgeCall<ClientSnapshot>(spec, 'snapshot')).events as DomainEvent[]);
    const n2 = Object.values(state.needs).find((n) => n.projectId === ATLAS && n.code === 'N2');
    expect(n2, 'Atlas N2').toBeDefined();
    await page.locator(`[data-testid="need-card"][data-need="${n2!.id}"]`).click();
    const drawer = page.locator(`[data-testid="drawer"][data-need="${n2!.id}"]`);
    await expect(drawer).toBeVisible();
    await shot(page, locale, 'drawer');
    await drawer.getByTestId('dr-handoff').click();
    await expect(page.getByTestId('overlay-handoff')).toBeVisible();
    await shot(page, locale, 'handoff');
    await close(page, 'overlay-handoff');
    await drawer.getByTestId('dr-link').click();
    await expect(page.getByTestId('overlay-link')).toBeVisible();
    await shot(page, locale, 'link');
    await close(page, 'overlay-link');
    await page.getByTestId('topbar-confirm').click();
    await expect(page.getByTestId('overlay-confirm')).toBeVisible();
    await shot(page, locale, 'confirm');
    await close(page, 'overlay-confirm');

    for (const view of ['inputs', 'artifacts', 'stream', 'deliveries']) {
      await openAtlas(page);
      await go(page, `nav-${view}`, view);
      await shot(page, locale, view);
    }
    await openAtlas(page);
    await go(page, 'nav-members', 'members');
    await shot(page, locale, 'members');
    await go(page, 'nav-rounds', 'rounds');
    await shot(page, locale, 'rounds');
    await go(page, 'nav-agents', 'agents');
    await shot(page, locale, 'agents');
    await go(page, 'nav-new-project', 'newProject');
    await shot(page, locale, 'new-project');
  } finally {
    await ctx.close();
  }
}

for (const c of CLIENTS) {
  test(`screenshots in ${c.locale}`, async ({ browser }) => {
    test.setTimeout(120_000);
    await shootAll(browser, c);
  });
}
