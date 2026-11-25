import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { DOT_RE, needVersion, replay, type DomainEvent, type Need, type State } from '@meetless/core';
import type { ClientSnapshot } from '@meetless/client/bridge';
import type { Locale } from '@meetless/i18n';
import { marksBeforeCodes } from '../test/support/markup';
import { bridgeCall, bridgePort, clientUrl, dataDir, type BridgeSpec } from './env';
import { text } from './i18n';
import { startBridgeProc, type Proc } from './procs';

/*
 * U2 collaboration between two clients against the real server with the zh-CN sample (global
 * setup). Client A is Alex (dev-alex) in zh-CN on bridge slot 3, client B is Zhou (dev-zhou) in
 * en on slot 4, each its own dev bridge host process with its own data dir. The spec changes
 * the sample only for Atlas N2's refresh request and N1's conflict; the handoff round trip and
 * the privacy check run on needs it creates itself.
 */
const A: BridgeSpec = { name: 'u2a', port: bridgePort(3), token: 'e2e-bridge-u2a', locale: 'zh-CN' };
const B: BridgeSpec = { name: 'u2b', port: bridgePort(4), token: 'e2e-bridge-u2b', locale: 'en-US' };
const ATLAS = 'sample-atlas';
const LA: Locale = 'zh-CN';
const LB: Locale = 'en';

test.describe.configure({ mode: 'serial' });

let procs: Proc[] = [];
let alex: Page;
let zhou: Page;

async function openSignedIn(browser: Browser, b: BridgeSpec, token: string, lang: string): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  await page.goto(clientUrl(b));
  await expect(page.getByTestId('signin')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  await page.getByTestId('signin-token').fill(token);
  await page.getByTestId('signin-submit').click();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'online');
  return page;
}

/**
 * No dot character in the visible text, and no mark before a need code in the markup (as in
 * skeleton.spec.ts). The open context preview's textarea holds the need context's markdown
 * (`# N2 …`), plain text the mark check does not apply to (Task 7 ruling); its value is checked
 * for dots on its own.
 */
async function expectClean(page: Page, label: string): Promise<void> {
  const body = await page.locator('body').innerText();
  expect(DOT_RE.test(body), `${label}: dot character in ${JSON.stringify(body.match(DOT_RE)?.[0])}`).toBe(false);
  for (const v of await page.getByTestId('lk-context').evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value))) {
    expect(DOT_RE.test(v), `${label}: dot character in the context preview`).toBe(false);
  }
  const html = (await page.locator('body').innerHTML())
    .replace(/(<textarea[^>]*data-testid="lk-context"[^>]*>)[\s\S]*?(<\/textarea>)/g, '$1$2')
    .replace(/<(area|br|col|embed|hr|img|input|link|meta|source|track|wbr)\b([^>]*?)\/?>/g, '<$1$2/>');
  expect(marksBeforeCodes(html), `${label}: mark before a need code`).toEqual([]);
}

/** What a client holds right now (its accepted events, replayed). */
async function stateOf(b: BridgeSpec): Promise<State> {
  const snap = await bridgeCall<ClientSnapshot>(b, 'snapshot');
  return replay(snap.events as DomainEvent[]);
}

async function needByCodeIn(b: BridgeSpec, code: string): Promise<Need> {
  const n = Object.values((await stateOf(b)).needs).find((x) => x.projectId === ATLAS && x.code === code);
  expect(n, `${b.name} holds Atlas ${code}`).toBeDefined();
  return n!;
}

async function openBoard(page: Page, projectId = ATLAS): Promise<void> {
  await page.locator(`[data-testid="nav-project"][data-project="${projectId}"]`).click();
  await expect(page.getByTestId('page-dash')).toBeVisible();
  await page.getByTestId('nav-board').click();
  await expect(page.getByTestId('page-board')).toBeVisible();
  await page.getByTestId('board-mode-rounds').click();
}

const card = (page: Page, needId: string) => page.locator(`[data-testid="need-card"][data-need="${needId}"]`);

async function openDrawer(page: Page, needId: string): Promise<Locator> {
  await card(page, needId).click();
  const d = page.locator(`[data-testid="drawer"][data-need="${needId}"]`);
  await expect(d).toBeVisible();
  return d;
}

/** Creates a need from the board's New need modal; returns its id (the drawer it opens). */
async function createNeed(page: Page, title: string, onlyMe: boolean): Promise<string> {
  await page.getByTestId('board-new').click();
  const modal = page.getByTestId('overlay-new-need');
  await expect(modal).toBeVisible();
  await modal.getByTestId('nn-title').fill(title);
  if (onlyMe) await modal.getByTestId('nn-private').getByRole('button', { name: text(LA, 'pv.only') }).click();
  await modal.getByTestId('nn-create').click();
  await expect(modal).toBeHidden();
  const drawer = page.getByTestId('drawer');
  await expect(drawer.locator('h2')).toHaveText(title);
  return (await drawer.getAttribute('data-need'))!;
}

/** The seq of the accepted event that created `needId` on `b`, once the server has accepted it. */
async function acceptedCreate(b: BridgeSpec, needId: string): Promise<number> {
  let seq = 0;
  await expect
    .poll(async () => {
      const snap = await bridgeCall<ClientSnapshot>(b, 'snapshot');
      const e = (snap.events as DomainEvent[]).find((x) => x.type === 'need.created' && (x.payload as { needId: string }).needId === needId);
      seq = e?.seq ?? 0;
      return seq;
    })
    .toBeGreaterThan(0);
  return seq;
}

async function close(page: Page, overlay: string): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId(overlay)).toBeHidden();
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

test('stale handoff: Alex asks Zhou to refresh; Zhou sees the request', async () => {
  const n2 = await needByCodeIn(A, 'N2');
  const v = needVersion(n2);
  const alexName = (await stateOf(B)).users['u-alex']!.displayName;

  await openBoard(alex);
  const da = await openDrawer(alex, n2.id);
  const hobA = da.getByTestId('hob');
  await expect(hobA).toContainText(text(LA, 'ho.stale', { v }));
  await hobA.getByTestId('ho-remind').click();
  await expect(hobA).toContainText(text(LA, 'ho.reminded'));
  await expect(hobA.getByTestId('ho-remind')).toHaveCount(0);

  await openBoard(zhou);
  const db = await openDrawer(zhou, n2.id);
  await expect(db.getByTestId('hob')).toContainText(text(LB, 'ho.refreshAsked', { who: alexName, v }));
});

test('handoff round trip between two clients', async () => {
  const title = 'U2 e2e export check';
  const ask = 'U2 e2e: check the export and send it back';
  const alexName = (await stateOf(B)).users['u-alex']!.displayName;

  // A creates a need and hands it to Zhou.
  await openBoard(alex);
  const needId = await createNeed(alex, title, false);
  await alex.getByTestId('dr-handoff').click();
  const ho = alex.getByTestId('overlay-handoff');
  await expect(ho).toBeVisible();
  await ho.locator('[data-testid="ho-person"][data-person="u-zhou"]').click();
  await ho.getByTestId('ho-ask-text').fill(ask);
  await ho.getByTestId('ho-send').click();
  await expect(ho).toBeHidden();
  const hobA = alex.locator(`[data-testid="drawer"][data-need="${needId}"]`).getByTestId('hob');
  await expect(hobA).toHaveAttribute('data-state', 'sent');

  // B sees it waiting on the card, accepts, starts and copies the prompt for the agent.
  await openBoard(zhou);
  await expect(card(zhou, needId)).toContainText(text(LB, 'ho.from', { who: alexName }));
  await expect(card(zhou, needId)).toContainText(text(LB, 'ho.st.sent'));
  const db = await openDrawer(zhou, needId);
  const hobB = db.getByTestId('hob');
  await expect(hobB).toContainText(ask);
  await hobB.getByTestId('ho-accept').click();
  await expect(hobB).toHaveAttribute('data-state', 'accepted');
  await hobB.getByTestId('ho-start').click();
  await expect(hobB).toHaveAttribute('data-state', 'doing');
  await hobB.getByTestId('ho-copy').click();
  const lk = zhou.getByTestId('overlay-link');
  await expect(lk).toBeVisible();
  await lk.getByTestId('lk-copy').click();
  await expect(lk.getByTestId('lk-copy')).toContainText(text(LB, 'cp.copied'));
  const code = (await stateOf(B)).needs[needId]?.code ?? '';
  expect(code).toMatch(/^N\d+$/);
  const prompt = (await lk.getByTestId('lk-prompt').textContent()) ?? '';
  const clip = await zhou.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(prompt);
  expect(clip).toContain(`meetless://${ATLAS}/${code}`);
  expect(clip).toContain(text(LB, 'lk.prompt2'));

  // The preview shows the live context of this need.
  await lk.getByTestId('lk-preview').click();
  await expect(lk.getByTestId('lk-context')).toBeVisible();
  expect(await lk.getByTestId('lk-context').inputValue()).toContain(title);
  await close(zhou, 'overlay-link');
  await hobB.getByTestId('ho-return').click();
  await expect(hobB).toHaveAttribute('data-state', 'returned');
  await expect(hobB).toContainText(text(LB, 'ho.onlySender'));

  // A confirms it done.
  await expect(hobA).toHaveAttribute('data-state', 'returned');
  await hobA.getByTestId('ho-confirm').click();
  await expect(hobA).toHaveAttribute('data-state', 'done');
  await expect(hobA).toContainText(text(LA, 'ho.st.done'));
  await expect(hobB).toHaveAttribute('data-state', 'done');
});

test('conflict: Alex revises N1 from To confirm', async () => {
  const n1 = await needByCodeIn(A, 'N1');
  const before = needVersion(n1);

  await openBoard(alex);
  await alex.getByTestId('topbar-confirm').click();
  const panel = alex.getByTestId('overlay-confirm');
  await expect(panel).toBeVisible();
  const item = panel.locator('[data-testid="ask-item"][data-kind="conflict"]').filter({ hasText: text(LA, 'cf.q', { need: 'N1' }) });
  await expect(item).toHaveCount(1);
  await item.getByTestId('cf-revise').click();
  await expect(item).toHaveCount(0);
  await expect(panel.getByTestId('ask-done')).toContainText(text(LA, 'cf.resolved.revise', { need: 'N1' }));
  await close(alex, 'overlay-confirm');

  const d = await openDrawer(alex, n1.id);
  await expect(d.locator('.dr-h')).toContainText(text(LA, 'dr.version', { v: before + 1 }));
  await expect.poll(async () => needVersion(await needByCodeIn(B, 'N1'))).toBe(before + 1);
});

test('a private need stays with its owner until shared', async () => {
  const title = 'U2 e2e private draft';
  await openBoard(alex);
  const needId = await createNeed(alex, title, true);
  const da = alex.locator(`[data-testid="drawer"][data-need="${needId}"]`);
  await expect(da).toContainText(text(LA, 'pv.mine'));
  await expect(card(alex, needId)).toBeVisible();

  // Wait until the server has accepted it and Zhou's client has synced past it.
  const seq = await acceptedCreate(A, needId);
  await expect.poll(async () => (await bridgeCall<ClientSnapshot>(B, 'snapshot')).status.cursor).toBeGreaterThanOrEqual(seq);

  await openBoard(zhou);
  await expect(card(zhou, needId)).toHaveCount(0);
  expect(await zhou.locator('body').innerText()).not.toContain(title);
  const wire = JSON.stringify(await bridgeCall<ClientSnapshot>(B, 'snapshot'));
  for (const s of [title, needId]) expect(wire.includes(s), `Zhou’s snapshot holds ${s}`).toBe(false);

  // Alex shares it: Zhou now sees the card under a shared N code.
  await da.getByTestId('dr-share').click();
  await expect(da).not.toContainText(text(LA, 'pv.mine'));
  await expect(card(zhou, needId)).toBeVisible();
  await expect(card(zhou, needId)).toContainText(title);
  const code = (await card(zhou, needId).locator('.card-h .mono').textContent()) ?? '';
  expect(code).toMatch(/^N\d+$/);
  expect((await stateOf(B)).needs[needId]?.code).toBe(code);
});

test('no dot symbols on U2 pages in either language', async () => {
  for (const [page, locale] of [
    [alex, LA],
    [zhou, LB],
  ] as const) {
    const projects = await page.getByTestId('nav-project').evaluateAll((els) => els.map((e) => e.getAttribute('data-project') ?? ''));
    expect(projects).toContain(ATLAS);
    for (const p of projects) {
      const tag = `${locale} ${p}`;
      await openBoard(page, p);
      await expectClean(page, `${tag} board`);
      await page.getByTestId('board-mode-lineage').click();
      await expect(page.getByTestId('lineage')).toBeVisible();
      await expectClean(page, `${tag} lineage`);
      await page.getByTestId('board-mode-rounds').click();

      // A shared need's drawer, its handoff and link overlays (with the context preview open).
      const first = page.locator('[data-testid="need-card"]:not(.priv)').first();
      const needId = (await first.getAttribute('data-need'))!;
      const d = await openDrawer(page, needId);
      await expectClean(page, `${tag} drawer`);
      await d.getByTestId('dr-handoff').click();
      await expect(page.getByTestId('overlay-handoff')).toBeVisible();
      await expectClean(page, `${tag} overlay-handoff`);
      await close(page, 'overlay-handoff');
      await d.getByTestId('dr-link').click();
      const lk = page.getByTestId('overlay-link');
      await expect(lk).toBeVisible();
      await expectClean(page, `${tag} overlay-link`);
      await lk.getByTestId('lk-preview').click();
      await expect(lk.getByTestId('lk-context')).toBeVisible();
      await expectClean(page, `${tag} overlay-link preview`);
      await close(page, 'overlay-link');

      await page.getByTestId('topbar-confirm').click();
      await expect(page.getByTestId('overlay-confirm')).toBeVisible();
      await expect(page.getByTestId('overlay-confirm')).toContainText(text(locale, 'ask.title'));
      await expectClean(page, `${tag} overlay-confirm`);
      await close(page, 'overlay-confirm');
    }
  }
});
