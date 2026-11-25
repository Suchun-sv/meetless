import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { projectInputs, replay, type DomainEvent, type Input, type State } from '@meetless/core';
import type { ClientSnapshot } from '@meetless/client/bridge';
import type { Locale } from '@meetless/i18n';
import { bridgeCall, bridgePort, clientUrl, dataDir, type BridgeSpec } from './env';
import { text } from './i18n';
import { startBridgeProc, type Proc } from './procs';

/*
 * U3 inputs between two clients against the real server with the zh-CN sample (global setup).
 * Client A is Alex (dev-alex) in zh-CN on bridge slot 7, client B is Zhou (dev-zhou) in en on
 * slot 8, each its own dev bridge host process with its own data dir. Imports go through the
 * server's `inputs.import`, which runs the rule-based detection.
 */
const A: BridgeSpec = { name: 'u3ia', port: bridgePort(7), token: 'e2e-bridge-u3ia', locale: 'zh-CN' };
const B: BridgeSpec = { name: 'u3ib', port: bridgePort(8), token: 'e2e-bridge-u3ib', locale: 'en-US' };
const ATLAS = 'sample-atlas';
const LA: Locale = 'zh-CN';

test.describe.configure({ mode: 'serial' });

let procs: Proc[] = [];
let alex: Page;
let zhou: Page;

async function openSignedIn(browser: Browser, b: BridgeSpec, token: string, lang: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(clientUrl(b));
  await expect(page.getByTestId('signin')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  await page.getByTestId('signin-token').fill(token);
  await page.getByTestId('signin-submit').click();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'online');
  return page;
}

async function openInputs(page: Page): Promise<void> {
  await page.locator(`[data-testid="nav-project"][data-project="${ATLAS}"]`).click();
  await expect(page.getByTestId('page-dash')).toBeVisible();
  await page.getByTestId('nav-inputs').click();
  await expect(page.getByTestId('page-inputs')).toBeVisible();
}

async function stateOf(b: BridgeSpec): Promise<State> {
  const snap = await bridgeCall<ClientSnapshot>(b, 'snapshot');
  return replay(snap.events as DomainEvent[]);
}

async function atlasInputs(b: BridgeSpec): Promise<Input[]> {
  return projectInputs(await stateOf(b), ATLAS);
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

const item = (page: Page, title: string): Locator => page.getByTestId('in-item').filter({ hasText: title });

/** Writes a Markdown note through the in-write modal; returns the new input's id (the item it selects). */
async function writeMarkdown(page: Page, title: string, body: string, onlyMe: boolean): Promise<string> {
  await page.getByTestId('in-write').click();
  const modal = page.getByTestId('md-modal');
  await expect(modal).toBeVisible();
  await modal.getByTestId('md-title').fill(title);
  await modal.getByTestId('md-text').fill(body);
  if (onlyMe) await modal.getByTestId('md-priv-only').check();
  await modal.getByTestId('md-go').click();
  await expect(modal).toBeHidden();
  const row = item(page, title);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveClass(/\bon\b/);
  return (await row.getAttribute('data-input'))!;
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

test('A writes Markdown, sees rule-detected items and accepts one; B sees the shared input', async () => {
  const title = 'E2E 会议记录';
  await openInputs(alex);
  const inputId = await writeMarkdown(alex, title, '客户希望导出支持按日期筛选\n12 月 5 日前交第一版', false);

  // The sheet shows the two paragraphs; the server's rule-based detection proposed items.
  const sheet = alex.getByTestId('in-sheet');
  await expect(sheet.locator('[data-para]')).toHaveText(['客户希望导出支持按日期筛选', '12 月 5 日前交第一版']);
  const panel = alex.getByTestId('in-extract-panel');
  await expect(panel.getByTestId('in-x').first()).toBeVisible();
  await expect(panel).toContainText(text(LA, 'in.rules'));
  const open = panel.locator('[data-testid="in-x"][data-state="open"]');
  const openBefore = await open.count();
  expect(openBefore, 'at least one detected item to accept').toBeGreaterThan(0);

  await panel.getByTestId('in-x-accept').first().click();
  const accepted = panel.locator('[data-testid="in-x"][data-state="accepted"]');
  await expect(accepted).toHaveCount(1);
  await expect(accepted).toContainText(text(LA, 'in.accepted'));
  await expect(open).toHaveCount(openBefore - 1);

  // The accepted item created a need in A's client, recorded against this input.
  await expect.poll(async () => (await atlasInputs(A)).find((i) => i.id === inputId)?.extracts.filter((x) => x.state === 'accepted').length).toBe(1);
  const x = (await atlasInputs(A)).find((i) => i.id === inputId)!.extracts.find((e) => e.state === 'accepted')!;
  expect(x.resultNeedId).toBeTruthy();
  expect((await stateOf(A)).needs[x.resultNeedId!]?.projectId).toBe(ATLAS);

  // B sees the shared input, with the same item accepted.
  await openInputs(zhou);
  const rowB = item(zhou, title);
  await expect(rowB).toBeVisible();
  await rowB.click();
  await expect(zhou.getByTestId('in-sheet')).toContainText(title);
  await expect(zhou.getByTestId('in-extract-panel').locator(`[data-testid="in-x"][data-x="${x.id}"]`)).toHaveAttribute('data-state', 'accepted');
});

test('a private Markdown never reaches B', async () => {
  const title = 'E2E 私人笔记';
  const barrier = 'E2E 屏障记录';
  await openInputs(alex);
  const privateId = await writeMarkdown(alex, title, 'E2E 私人笔记正文，只给自己看', true);
  await expect(item(alex, title)).toContainText(text(LA, 'pv.mine'));
  await expect(alex.getByTestId('in-sheet')).toContainText(text(LA, 'pv.mine'));
  expect((await atlasInputs(A)).find((i) => i.id === privateId)?.privateTo).toBe('u-alex');

  // Barrier: A's next, shared, action. Once B shows it, B has synced past the private one.
  await writeMarkdown(alex, barrier, 'E2E 屏障正文', false);
  await openInputs(zhou);
  await expect(item(zhou, barrier)).toBeVisible();

  expect(await zhou.locator('body').innerText()).not.toContain(title);
  await expect(zhou.locator(`[data-testid="in-item"][data-input="${privateId}"]`)).toHaveCount(0);
  const wire = JSON.stringify(await bridgeCall<ClientSnapshot>(B, 'snapshot'));
  for (const s of [privateId, title]) expect(wire.includes(s), `Zhou’s snapshot holds ${s}`).toBe(false);
  expect((await atlasInputs(B)).some((i) => i.title.startsWith(barrier)), 'Zhou’s cache holds the barrier input').toBe(true);
  const disk = diskBytes(dataDir(B));
  for (const s of [privateId, title]) expect(disk.includes(Buffer.from(s)), `Zhou’s disk holds ${s}`).toBe(false);
});

test('a .txt with a BOM and CRLF imports through the file picker', async () => {
  const name = 'e2e-bom-crlf.txt';
  const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('E2E 文本第一行\r\nE2E 文本第二行\r\n', 'utf8')]);
  await openInputs(alex);
  const chooser = alex.waitForEvent('filechooser');
  await alex.getByTestId('in-import').click();
  await (await chooser).setFiles({ name, mimeType: 'text/plain', buffer: body });

  const row = item(alex, name);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveClass(/\bon\b/);
  await expect(alex.getByTestId('in-sheet').locator('[data-para]')).toHaveText(['E2E 文本第一行', 'E2E 文本第二行']);

  const input = (await atlasInputs(A)).find((i) => i.title === name);
  expect(input, 'A holds the imported .txt').toBeDefined();
  expect(input!.kind).toBe('txt');
  expect(input!.body.map((p) => p.text)).toEqual(['E2E 文本第一行', 'E2E 文本第二行']);
  for (const p of input!.body) expect(/[﻿\r]/.test(p.text), `BOM or CR in ${JSON.stringify(p.text)}`).toBe(false);
});

test('an unsupported file shows the reason and creates nothing', async () => {
  await openInputs(alex);
  const before = (await atlasInputs(A)).length;
  const rowsBefore = await alex.getByTestId('in-item').count();

  await alex.getByTestId('in-file').setInputFiles({ name: 'notes.rtf', mimeType: 'application/rtf', buffer: Buffer.from('x') });
  await expect(alex.getByRole('alert').filter({ hasText: text(LA, 'in.badType') })).toBeVisible();

  await expect(alex.getByTestId('in-item')).toHaveCount(rowsBefore);
  await expect(item(alex, 'notes.rtf')).toHaveCount(0);
  expect((await atlasInputs(A)).length).toBe(before);
  const outbox = (await bridgeCall<ClientSnapshot>(A, 'snapshot')).outbox;
  expect(outbox.filter((o) => JSON.stringify(o).includes('notes.rtf'))).toEqual([]);
});
