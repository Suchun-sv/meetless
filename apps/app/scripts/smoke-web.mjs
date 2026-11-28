// Web smoke (dev aid, not a test suite): sign in as the sample user Alex and screenshot the shell.
// Usage: node scripts/smoke-web.mjs <outDir> [baseUrl] [paths...]
// Env: MEETLESS_WEB_URL (the default baseUrl), MEETLESS_SMOKE_TOKEN or MEETLESS_SMOKE_TOKEN_FILE (Alex's
// token), PLAYWRIGHT_FROM (a package.json whose node_modules has playwright; default this package).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_FROM ?? import.meta.url);
const { chromium } = require('playwright');

const out = process.argv[2] ?? '/tmp/ml-expo-shots';
const base = process.argv[3] ?? process.env.MEETLESS_WEB_URL;
if (!base) throw new Error('give a baseUrl or set MEETLESS_WEB_URL');
const paths = process.argv.slice(4);
const token = (process.env.MEETLESS_SMOKE_TOKEN ?? (process.env.MEETLESS_SMOKE_TOKEN_FILE ? readFileSync(process.env.MEETLESS_SMOKE_TOKEN_FILE, 'utf8') : '')).trim();
if (!token) throw new Error('set MEETLESS_SMOKE_TOKEN or MEETLESS_SMOKE_TOKEN_FILE');
const { mkdirSync } = await import('node:fs');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const errors = [];
// SMOKE_WIDTHS=428,1440 picks the viewports (phones under 500 px get 926 tall and 2x).
const sizes = (process.env.SMOKE_WIDTHS ?? '1440,390').split(',').map(Number).map((w) => [w, w < 500 ? 926 : 900]);
for (const [w, h] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'zh-CN', deviceScaleFactor: w < 500 ? 2 : 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`[${w}] ${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${w}] pageerror: ${e.message}`));
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  if (await page.getByTestId('signin-mode-token').count()) {
    await page.screenshot({ path: `${out}/signin-invite-${w}.png` });
    await page.getByTestId('signin-mode-token').click();
  }
  if (await page.getByTestId('signin-token').count()) {
    await page.screenshot({ path: `${out}/signin-${w}.png` });
    await page.getByTestId('signin-token').fill(token);
    await page.getByTestId('signin-submit').click();
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/home-${w}.png` });
  const proj = page.locator('[data-testid^="nav-project-"]').first();
  
  if (await proj.count()) {
    await proj.click();
    await page.waitForTimeout(1200);
    if (w < 500) {
      await page.getByTestId('menu').click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/drawer-project-${w}.png` });
      await page.getByTestId('drawer-scrim').click({ position: { x: 20, y: 400 } });
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: `${out}/project-${w}.png` });
  }
  for (const p of paths) {
    // Pages with live frames (OnlyOffice) never go network-idle.
    await page.goto(base + p, { waitUntil: 'load' });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${out}/${p.replace(/[^a-z0-9]+/gi, '_')}-${w}.png` });
  }
  await ctx.close();
}
await browser.close();
console.log(errors.length ? errors.join('\n') : 'no console errors');
console.log('shots in', out);
