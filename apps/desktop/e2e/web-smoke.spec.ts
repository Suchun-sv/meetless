import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DOT_CHARS } from '@meetless/core';
import { webUrl } from './env';
import { text } from './i18n';
import { horizontalOverflow } from './support/overflow';

/*
 * The web on a phone (design 2026-11-25 §7, Task 7 cut to one smoke): the server's own page at
 * 390x844 in zh-CN. Sign in with the dev token, the home dashboard, the nav drawer to the sample
 * project, a need as a full-screen page with its back button; no sideways overflow and no dot
 * character on any of them; the session cookie is HttpOnly and never visible to script.
 * With MEETLESS_SHOTS_WEB=1 it also writes docs/screenshots/v3/mobile/{home,project,need}.png.
 */
const SHOTS = process.env.MEETLESS_SHOTS_WEB === '1';
const OUT = resolve(import.meta.dirname, '../../../docs/screenshots/v3/mobile');
const PROJECT = 'sample-paper';
const W = 390;

test.use({ viewport: { width: W, height: 844 }, locale: 'zh-CN', isMobile: true, hasTouch: true });

async function check(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  expect(await page.evaluate(() => document.documentElement.scrollWidth), `${name}: document width`).toBeLessThanOrEqual(W);
  expect(await horizontalOverflow(page), `${name}: sideways overflow`).toEqual([]);
  const body = await page.evaluate(() => document.body.innerText);
  expect(
    DOT_CHARS.filter((c) => body.includes(c)),
    `${name}: dot characters`,
  ).toEqual([]);
  if (SHOTS) {
    mkdirSync(OUT, { recursive: true });
    await page.waitForTimeout(250); // let transitions settle
    await page.screenshot({ path: resolve(OUT, `${name}.png`) });
  }
}

test('phone: sign in on the web, home, nav drawer to the project, a need page and back', async ({ page, context }) => {
  await page.goto(webUrl);
  await expect(page.getByTestId('signin')).toBeVisible();
  await expect(page.getByTestId('signin-server')).toHaveCount(0); // the server is the page's own origin
  await page.getByTestId('signin-token').fill('dev-alex');
  await page.getByTestId('signin-submit').click();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'online');

  // The session cookie is HttpOnly and script never sees it.
  const session = (await context.cookies(webUrl)).find((c) => c.name === 'ml_session');
  expect(session?.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('ml_session');

  // Home: the dashboard with the sidebar folded away behind the menu button.
  await expect(page.getByTestId('composer')).toBeVisible();
  await expect(page.locator('.wg').first()).toBeVisible();
  await expect(page.locator('.side')).toBeHidden();
  await expect(page.getByTestId('nav-toggle')).toBeVisible();
  await expect(page.getByTestId('nav-toggle')).toHaveAttribute('aria-label', text('zh-CN', 'web.menu'));
  await check(page, 'home');

  // The nav drawer opens over a scrim and closes on the choice of a destination.
  await page.getByTestId('nav-toggle').click();
  await expect(page.locator('.side')).toBeVisible();
  await expect(page.getByTestId('nav-scrim')).toBeVisible();
  await expect(page.getByTestId('nav-toggle')).toHaveAttribute('aria-expanded', 'true');
  await page.locator(`[data-testid="nav-project"][data-project="${PROJECT}"]`).click();
  await expect(page.getByTestId('nav-scrim')).toHaveCount(0);
  await expect(page.locator('.side')).toBeHidden();
  await expect(page.locator(`[data-card]`).first()).toBeVisible();
  await check(page, 'project');

  // Board, then a need: a full-screen page whose back button returns to the board.
  await page.getByTestId('nav-toggle').click();
  await page.getByTestId('nav-board').click();
  await expect(page.getByTestId('page-board')).toBeVisible();
  await page.getByTestId('need-card').first().click();
  const drawer = page.getByTestId('drawer');
  await expect(drawer).toBeVisible();
  const box = (await drawer.boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.width).toBe(W);
  expect(box.height).toBe(844);
  await expect(page.getByTestId('drawer-back')).toBeVisible();
  await expect(page.getByTestId('drawer-back')).toHaveText(text('zh-CN', 'web.back'));
  await check(page, 'need');
  await page.getByTestId('drawer-back').click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByTestId('page-board')).toBeVisible();
});
