import { expect, test, type Browser, type Page } from '@playwright/test';
import { DOT_RE, replay, type DomainEvent } from '@meetless/core';
import type { ClientSnapshot, SubmitResult } from '@meetless/client/bridge';
import type { Locale } from '@meetless/i18n';
import { bridgeCall, bridgePort, clientUrl, dataDir, serverUrl, type BridgeSpec } from './env';
import { text } from './i18n';
import { startBridgeProc, type Proc } from './procs';

/*
 * Project rename between two clients against the real server (contract 12.23). Client A is Alex
 * (dev-alex) in zh-CN, client B is Zhou (dev-zhou) in en, each its own dev bridge host process.
 * Alex creates a project of his own and adds Zhou, so the sample projects keep their names for
 * every other spec. The file name sorts after the u1 to u3 specs, so the extra project is in
 * nobody's sidebar while they run.
 */
const A: BridgeSpec = { name: 'rename-a', port: bridgePort(3), token: 'e2e-bridge-rename-a', locale: 'zh-CN' };
const B: BridgeSpec = { name: 'rename-b', port: bridgePort(4), token: 'e2e-bridge-rename-b', locale: 'en-US' };
const LA: Locale = 'zh-CN';
const LB: Locale = 'en';
const PID = 'e2e-rename-project';
const FIRST = '客户门户';
const SECOND = '客户门户 二期';
const THIRD = 'Client portal phase 2';

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

async function submit(b: BridgeSpec, id: string, type: string, payload: unknown): Promise<void> {
  const r = await bridgeCall<SubmitResult>(b, 'submit', { id, type, payload });
  expect(r.kind, `${type} ${id}`).toBe('accepted');
}

/** The project's name in what a client holds right now (its accepted events, replayed). */
async function nameIn(b: BridgeSpec): Promise<string | undefined> {
  const snap = await bridgeCall<ClientSnapshot>(b, 'snapshot');
  return replay(snap.events as DomainEvent[]).projects[PID]?.name;
}

const row = (page: Page) => page.locator(`[data-testid="nav-project"][data-project="${PID}"]`);

async function expectNoDots(page: Page, label: string): Promise<void> {
  const body = await page.locator('body').innerText();
  expect(DOT_RE.test(body), `${label}: dot character in ${JSON.stringify(body.match(DOT_RE)?.[0])}`).toBe(false);
}

test.beforeAll(async ({ browser }) => {
  const started = await Promise.allSettled([A, B].map((b) => startBridgeProc({ dataDir: dataDir(b), port: b.port, locale: b.locale, token: b.token })));
  procs = started.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const failed = started.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
  alex = await openSignedIn(browser, A, 'dev-alex', 'zh-CN');
  zhou = await openSignedIn(browser, B, 'dev-zhou', 'en');
  await submit(A, 'e2e-rename-create', 'project.created', { projectId: PID, name: FIRST });
  await submit(A, 'e2e-rename-add-zhou', 'project.member_added', { projectId: PID, userId: 'u-zhou' });
  await expect(row(alex)).toContainText(FIRST);
  await expect(row(zhou)).toContainText(FIRST);
});
test.afterAll(async () => {
  await alex?.context().close();
  await zhou?.context().close();
  for (const p of procs) await p.stop();
});

test('Alex renames the project in the top bar; Zhou’s sidebar and Activity show it live', async () => {
  // Zhou sits on the project's Activity page, so the new name has to arrive while it is open.
  await row(zhou).click();
  await zhou.getByTestId('nav-stream').click();
  await expect(zhou.getByTestId('page-stream')).toBeVisible();
  await expect(zhou.getByTestId('stream-sys')).toHaveCount(0);

  await row(alex).click();
  await expect(alex.getByTestId('page-dash')).toBeVisible();
  const crumb = alex.locator('.crumb3');
  await crumb.hover();
  await expect(alex.getByTestId('top-rename')).toHaveText(text(LA, 'pj.rename'));

  // Esc cancels: nothing is sent and the name stays.
  await alex.getByTestId('top-rename').click();
  const input = alex.getByTestId('rename-input');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(FIRST);
  await input.fill('不要这个名字');
  await input.press('Escape');
  await expect(input).toBeHidden();
  await expect(crumb).toContainText(FIRST);

  // An empty name shows the error notice and keeps the edit open.
  await crumb.hover();
  await alex.getByTestId('top-rename').click();
  await input.fill('   ');
  await input.press('Enter');
  await expect(alex.getByText(text(LA, 'pj.nameEmpty'))).toBeVisible();
  await expect(input).toBeVisible();

  // Enter saves; the dot is stripped.
  await input.fill(`  客户门户 · 二期 `);
  await input.press('Enter');
  await expect(input).toBeHidden();
  await expect(crumb).toContainText(SECOND);
  await expect(row(alex)).toContainText(SECOND);
  await expect.poll(() => nameIn(A)).toBe(SECOND);

  // Zhou's client, which did nothing, shows the new name live in the sidebar row and the top bar.
  await expect(row(zhou)).toContainText(SECOND);
  await expect(zhou.locator('.crumb3')).toContainText(SECOND);
  await expect.poll(() => nameIn(B)).toBe(SECOND);
  // And as a system line in Activity, in Zhou's language.
  const line = zhou.getByTestId('stream-sys');
  await expect(line).toHaveCount(1);
  await expect(line).toContainText(text(LB, 'stream.renamed', { who: 'Alex', from: FIRST, to: SECOND }));

  await expectNoDots(alex, 'alex after rename');
  await expectNoDots(zhou, 'zhou after rename');
});

test('Zhou renames from the sidebar row on blur; Alex sees it live', async () => {
  const wrap = zhou.locator('.prow-wrap', { has: row(zhou) });
  await wrap.hover();
  const action = zhou.locator(`[data-testid="nav-project-rename"][data-project="${PID}"]`);
  await expect(action).toHaveText(text(LB, 'pj.rename'));
  await action.click();
  const input = zhou.getByTestId('rename-input');
  await expect(input).toHaveValue(SECOND);
  await input.fill(THIRD);
  // Blur saves, like the other inline edits.
  await zhou.getByTestId('page-stream').locator('h1').click();
  await expect(input).toBeHidden();
  await expect(row(zhou)).toContainText(THIRD);
  await expect(zhou.getByTestId('stream-sys')).toHaveCount(2);

  await expect(row(alex)).toContainText(THIRD);
  await expect(alex.locator('.crumb3')).toContainText(THIRD);
  await expect.poll(() => nameIn(A)).toBe(THIRD);
  await expectNoDots(zhou, 'zhou after sidebar rename');
});

test('the server refuses a rename from outside the project and a name that is too long', async () => {
  const post = (token: string, id: string, name: string) =>
    fetch(`${serverUrl}/v1/commands`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id, type: 'project.renamed', payload: { projectId: PID, name } }),
    });
  const outsider = await post('dev-eve', 'e2e-rename-by-eve', 'Taken over');
  expect(outsider.status).toBe(422);
  expect(((await outsider.json()) as { error: { code: string } }).error.code).toBe('NOT_A_MEMBER');
  const tooLong = await post('dev-zhou', 'e2e-rename-too-long', 'x'.repeat(81));
  expect(tooLong.status).toBe(422);
  expect(((await tooLong.json()) as { error: { code: string } }).error.code).toBe('INVALID_EVENT');
  expect(await nameIn(A)).toBe(THIRD);
  expect(await nameIn(B)).toBe(THIRD);
});
