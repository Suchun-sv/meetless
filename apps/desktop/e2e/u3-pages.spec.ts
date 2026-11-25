import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { DOT_RE, projectRounds, projectWork, replay, type DomainEvent, type NeedStatus, type State, type WorkItem } from '@meetless/core';
import type { ClientSnapshot, SubmitResult } from '@meetless/client/bridge';
import type { Locale, MessageKey } from '@meetless/i18n';
import { marksBeforeCodes, nonGeometryStyles } from '../test/support/markup';
import { bridgeCall, bridgePort, clientUrl, dataDir, type BridgeSpec } from './env';
import { text } from './i18n';
import { startBridgeProc, type Proc } from './procs';

/*
 * The four U3 pages (inputs, artifacts, stream, deliveries) between two clients against the
 * real server with the zh-CN sample (global setup). Client A is Alex (dev-alex) in zh-CN on
 * bridge slot 7, client B is Zhou (dev-zhou) in en on slot 8. Last alphabetically on purpose:
 * it delivers Atlas's current round, which no later spec should see.
 */
const A: BridgeSpec = { name: 'u3pa', port: bridgePort(7), token: 'e2e-bridge-u3pa', locale: 'zh-CN' };
const B: BridgeSpec = { name: 'u3pb', port: bridgePort(8), token: 'e2e-bridge-u3pb', locale: 'en-US' };
const ATLAS = 'sample-atlas';
const LA: Locale = 'zh-CN';
const LB: Locale = 'en';
const U3_PAGES = ['inputs', 'artifacts', 'stream', 'deliveries'] as const;
type Kind = 'agent' | 'manual' | 'capture';

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

async function openSection(page: Page, section: string, projectId = ATLAS): Promise<void> {
  await page.locator(`[data-testid="nav-project"][data-project="${projectId}"]`).click();
  await expect(page.getByTestId('page-dash')).toBeVisible();
  await page.getByTestId(`nav-${section}`).click();
  await expect(page.getByTestId(`page-${section}`)).toBeVisible();
}

async function stateOf(b: BridgeSpec): Promise<State> {
  const snap = await bridgeCall<ClientSnapshot>(b, 'snapshot');
  return replay(snap.events as DomainEvent[]);
}

/** The stream's own split, restated: a capture never counts as progress; else an agent report; else logged by a person. */
const kindOf = (w: WorkItem): Kind => (w.capture ? 'capture' : w.via ? 'agent' : 'manual');
const shownWork = (s: State) => projectWork(s, ATLAS).filter((w) => !w.ignored);

const rows = (page: Page): Locator => page.getByTestId('stream-row');
const kindChip = (page: Page, k: Kind | 'all'): Locator => page.locator(`[data-testid="stream-k"][data-k="${k}"]`);

/**
 * No dot character in the visible text, no mark before a need code and no non-geometry inline
 * style in the page markup. The browser serialises void elements without "/>"; the mark guard
 * reads them as void only when closed, as in skeleton.spec.ts.
 */
async function expectClean(page: Page, label: string): Promise<void> {
  const body = await page.locator('body').innerText();
  expect(DOT_RE.test(body), `${label}: dot character in ${JSON.stringify(body.match(DOT_RE)?.[0])}`).toBe(false);
  const html = (await page.content()).replace(/<(area|br|col|embed|hr|img|input|link|meta|source|track|wbr)\b([^>]*?)\/?>/g, '<$1$2/>');
  expect(marksBeforeCodes(html), `${label}: mark before a need code`).toEqual([]);
  expect(nonGeometryStyles(html), `${label}: inline style beyond geometry`).toEqual([]);
}

/** The office viewer, when the selected artifact has one, has left `config`/`loading`. */
async function settleViewer(page: Page): Promise<void> {
  const root = page.locator('[data-office-phase]');
  if ((await root.count()) > 0) await expect(root).toHaveAttribute('data-office-phase', /^(ready|fallback)$/, { timeout: 30_000 });
}

test.beforeAll(async ({ browser }) => {
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

test('stream filters by kind and need; agent reports show the client', async () => {
  const s = await stateOf(B);
  const work = shownWork(s);
  expect(work.some((w) => kindOf(w) === 'agent'), 'the sample has an agent report').toBe(true);
  expect(work.some((w) => kindOf(w) === 'manual'), 'the sample has work logged by people').toBe(true);

  await openSection(zhou, 'stream');
  await expect(rows(zhou)).toHaveCount(work.length);

  for (const k of ['agent', 'manual', 'capture'] as const) {
    const expected = work.filter((w) => kindOf(w) === k);
    await kindChip(zhou, k).click();
    await expect(kindChip(zhou, k)).toHaveClass(/\bon\b/);
    await expect(rows(zhou)).toHaveCount(expected.length);
    for (const w of expected) await expect(zhou.locator(`[data-testid="stream-row"][data-work="${w.id}"]`)).toHaveAttribute('data-kind', k);
    if (expected.length === 0) await expect(zhou.getByTestId('page-stream')).toContainText(text(LB, 'stream.noMatch'));
    if (k === 'agent') {
      for (const w of expected) {
        const row = zhou.locator(`[data-testid="stream-row"][data-work="${w.id}"]`);
        if (w.needId !== null) {
          await expect(row).toContainText(text(LB, 'stream.via', { client: w.via!.client }));
          await expect(row).toContainText(text(LB, 'stream.progress'));
        } else {
          // Unlinked work counts toward nothing until it is linked (R21c).
          await expect(row).toContainText(text(LB, 'stream.unlinked'));
          await expect(row).not.toContainText(text(LB, 'stream.progress'));
        }
      }
    }
    if (k === 'capture') for (const w of expected) await expect(zhou.locator(`[data-testid="stream-row"][data-work="${w.id}"]`)).toContainText(text(LB, 'cap.label'));
  }

  // Need filter: N2 has the sample's agent report; with All it shows every row linked to N2.
  const n2 = Object.values(s.needs).find((n) => n.projectId === ATLAS && n.code === 'N2')!;
  const onN2 = work.filter((w) => w.needId === n2.id || w.alsoNeedId === n2.id);
  expect(onN2.length).toBeGreaterThan(0);
  await kindChip(zhou, 'all').click();
  await zhou.getByTestId('stream-need').selectOption(n2.id);
  await expect(rows(zhou)).toHaveCount(onN2.length);
  for (const w of onN2) await expect(zhou.locator(`[data-testid="stream-row"][data-work="${w.id}"]`)).toBeVisible();
  for (const r of await rows(zhou).all()) await expect(r.locator('.needchip').filter({ hasText: 'N2' })).not.toHaveCount(0);

  // Kind and need together.
  await kindChip(zhou, 'agent').click();
  await expect(rows(zhou)).toHaveCount(onN2.filter((w) => kindOf(w) === 'agent').length);
  await zhou.getByTestId('stream-need').selectOption('');
  await kindChip(zhou, 'all').click();
  await expect(rows(zhou)).toHaveCount(work.length);

  // A sees the same agent report, with the client named in zh-CN.
  const agent = work.find((w) => kindOf(w) === 'agent' && w.needId !== null)!;
  await openSection(alex, 'stream');
  await kindChip(alex, 'agent').click();
  const rowA = alex.locator(`[data-testid="stream-row"][data-work="${agent.id}"]`);
  await expect(rowA).toContainText(text(LA, 'stream.via', { client: agent.via!.client }));
  await expect(rowA).toContainText(text(LA, 'stream.progress'));
  await kindChip(alex, 'all').click();
});

test('A delivers the current Atlas round; B sees it delivered with the frozen account', async () => {
  const sA = await stateOf(A);
  const current = projectRounds(sA, ATLAS).find((r) => r.status === 'current');
  expect(current, 'Atlas has a current round').toBeDefined();
  const next = projectRounds(sA, ATLAS)
    .filter((r) => r.status === 'planned' && r.n > current!.n)
    .sort((a, b) => a.n - b.n)[0];
  const account = Object.values(sA.needs)
    .filter((n) => n.roundId === current!.id && n.kind === 'ext' && n.privateTo === null)
    .sort((a, b) => a.createdSeq - b.createdSeq)
    .map((n) => ({ needId: n.id, code: n.code, status: n.status }));
  expect(account.length).toBeGreaterThan(0);
  const extra = 'E2E 交付说明';
  const items = [...current!.items, extra];

  await openSection(alex, 'deliveries');
  const secA = alex.locator(`[data-testid="dl-round"][data-round="${current!.n}"]`);
  await expect(secA).toHaveAttribute('data-status', 'current');
  await expect(secA).toContainText(text(LA, 'dl.draft'));
  await expect(secA).toContainText(text(LA, 'app.rules'));
  for (const a of account) await expect(secA.locator(`.needchip[title^="${a.code} "]`)).toBeVisible();
  await secA.getByTestId('dl-deliver').click();
  const items0 = secA.getByTestId('dl-items');
  await expect(items0).toHaveValue(current!.items.join('\n'));
  await items0.fill(items.join('\n'));
  await secA.getByTestId('dl-confirm').click();
  await expect(secA).toHaveAttribute('data-status', 'delivered');
  await expect(secA.getByTestId('dl-form')).toHaveCount(0);
  if (next) await expect(alex.locator(`[data-testid="dl-round"][data-round="${next.n}"]`)).toHaveAttribute('data-status', 'current');

  // B sees the round delivered, with the items and the account frozen at delivery.
  await openSection(zhou, 'deliveries');
  const secB = zhou.locator(`[data-testid="dl-round"][data-round="${current!.n}"]`);
  await expect(secB).toHaveAttribute('data-status', 'delivered');
  await expect(secB).toContainText(text(LB, 'round.delivered'));
  for (const it of items) await expect(secB.locator('li').filter({ hasText: it })).toHaveCount(1);
  const accountRow = (code: string) => secB.locator('.row', { has: zhou.locator(`.needchip[title^="${code} "]`) });
  for (const a of account) await expect(accountRow(a.code).locator('.st')).toHaveText(text(LB, `st.${a.status}` as MessageKey));
  const delivery = (await stateOf(B)).rounds[current!.id]!.delivery!;
  expect(delivery.items).toEqual(items);
  expect(delivery.account.map((a) => ({ needId: a.needId, status: a.status }))).toEqual(account.map((a) => ({ needId: a.needId, status: a.status })));

  // Frozen: A moves a need on after delivery; B's need is live, the delivered account is not.
  const moved = account[0]!;
  const to: NeedStatus = moved.status === 'partial' ? 'doing' : 'partial';
  const r = await bridgeCall<SubmitResult>(A, 'submit', { id: `e2e-u3-after-delivery-${moved.needId}`, type: 'need.status_set', payload: { needId: moved.needId, status: to } });
  expect(r.kind).toBe('accepted');
  await expect.poll(async () => (await stateOf(B)).needs[moved.needId]?.status).toBe(to);
  await expect(accountRow(moved.code).locator('.st')).toHaveText(text(LB, `st.${moved.status}` as MessageKey));
  expect((await stateOf(B)).rounds[current!.id]!.delivery!.account.find((a) => a.needId === moved.needId)?.status).toBe(moved.status);
});

test('no dot symbols on the four U3 pages, for A in zh-CN and B in en', async () => {
  for (const [page, label] of [
    [alex, 'zh-CN'],
    [zhou, 'en'],
  ] as const) {
    for (const v of U3_PAGES) {
      await openSection(page, v);
      if (v === 'artifacts') await settleViewer(page);
      await expectClean(page, `${label} ${v}`);
      // Every item on the two list pages, so what the earlier U3 specs added is covered too.
      const items = v === 'inputs' ? page.getByTestId('in-item') : v === 'artifacts' ? page.getByTestId('af-item') : null;
      if (!items) continue;
      const n = await items.count();
      expect(n).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) {
        await items.nth(i).click();
        await expect(items.nth(i)).toHaveClass(/\bon\b/);
        if (v === 'artifacts') await settleViewer(page);
        await expectClean(page, `${label} ${v} item ${i}`);
      }
    }
  }
});
