import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { currentRound, DOT_RE, replay, waitingCount, type DomainEvent } from '@meetless/core';
import type { ClientSnapshot } from '@meetless/client/bridge';
import { bridgeCall, bridgePort, clientUrl, dataDir, serverUrl, type BridgeSpec } from './env';
import { text } from './i18n';
import { startBridgeProc, type Proc } from './procs';

/*
 * Two real clients through the U1 shell, dashboards, chat and setup (contract §12.15, §12.17,
 * §12.18, §12.19; design §10's "add a card through the dialog, it survives a reload"). Client A
 * is Alex (zh-CN), client B is Zhou (en), both against the real server with the zh-CN sample.
 *
 * Ruling R18: Alex is bridge slot 3, Zhou is slot 4 (not the plan's base+6/+7: those slots are
 * taken by `signin.spec.ts` (6) and `skeleton.spec.ts` (1, 2) in the same e2e run).
 */
const A: BridgeSpec = { name: 'u1-alex', port: bridgePort(3), token: 'e2e-u1a', locale: 'zh-CN' };
const B: BridgeSpec = { name: 'u1-zhou', port: bridgePort(4), token: 'e2e-u1b', locale: 'en' };
const ATLAS = 'sample-atlas';
/** The composer's text field: the same selector as `chat/Composer.tsx`'s `COMPOSER_INPUT` (contract §12.16). */
const COMPOSER_INPUT = '[data-testid="composer"] textarea';

test.describe.configure({ mode: 'serial' });

let procs: Proc[] = [];
let a: Page;
let b: Page;

/** The local day the renderer itself computes (`app/AppContext.ts`'s `localDay`), for `home.hi`'s `{n}`. */
function localDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function openSignedIn(browser: Browser, spec: BridgeSpec, token: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(clientUrl(spec));
  await expect(page.getByTestId('signin')).toBeVisible();
  await page.getByTestId('signin-server').fill(serverUrl);
  await page.getByTestId('signin-token').fill(token);
  await page.getByTestId('signin-submit').click();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'online');
  return page;
}

/** Sends one command through client `b`'s own bridge (its outbox, then the server); the server must accept it. */
async function submit(b: BridgeSpec, type: string, payload: unknown): Promise<void> {
  const r = await bridgeCall<{ kind: string }>(b, 'submit', { id: `cmd-${randomUUID()}`, type, payload });
  expect(r.kind, `${type}: ${JSON.stringify(r)}`).toBe('accepted');
}

async function openAtlas(page: Page): Promise<void> {
  await page.locator('[data-testid="nav-project"][data-project="sample-atlas"]').click();
  await expect(page.getByTestId('page-dash')).toBeVisible();
}

/**
 * One navigation step per U1 page (shell, dash, setup), through sidebar testids, each waiting
 * for its `page-<view>`: Home, the Atlas dash (so the project stays "open" and its `nav-members`
 * / `nav-rounds` links are in the sidebar — `shell/model.ts`'s `sidebarModel` only shows them
 * under the current project), then Members, Rounds (still under Atlas), Agents and New project
 * (both global views, which close the open project again). `onEach` runs after every step.
 */
async function visitU1(page: Page, onEach: (view: string) => Promise<void>): Promise<void> {
  const step = async (testid: string, view: string) => {
    await page.getByTestId(testid).click();
    await expect(page.getByTestId(`page-${view}`)).toBeVisible();
    await onEach(view);
  };
  await step('nav-home', 'home');
  await openAtlas(page);
  await onEach('dash');
  await step('nav-members', 'members');
  await step('nav-rounds', 'rounds');
  await step('nav-agents', 'agents');
  await step('nav-new-project', 'newProject');
}

test.beforeAll(async ({ browser }) => {
  const started = await Promise.allSettled(
    [A, B].map((spec) => startBridgeProc({ dataDir: dataDir(spec), port: spec.port, locale: spec.locale, token: spec.token })),
  );
  procs = started.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const failed = started.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
  a = await openSignedIn(browser, A, 'dev-alex');
  b = await openSignedIn(browser, B, 'dev-zhou');
});

test.afterAll(async () => {
  await a?.context().close();
  await b?.context().close();
  for (const p of procs) await p.stop();
});

test('Home shows what waits for Alex and both sample projects', async () => {
  await a.getByTestId('nav-home').click();
  await expect(a.getByTestId('page-home')).toBeVisible();
  await expect(a.getByTestId('nav-project')).toHaveCount(2);

  const snap = await bridgeCall<ClientSnapshot>(A, 'snapshot');
  const state = replay(snap.events as DomainEvent[]);
  const n = waitingCount(state, 'u-alex', localDay());
  await expect(a.getByTestId('page-home')).toContainText(text('zh-CN', 'home.hi', { n }));
});

test('asking for a card adds it to the Atlas dashboard and it survives a reload', async () => {
  await openAtlas(a);
  await a.getByTestId('composer-text').fill('加一张需求来源卡片');
  await a.getByTestId('composer-text').press('Enter');
  await expect(a.locator('[data-card="sources"]')).toBeVisible();
  await expect(a.getByTestId('msg-a').last()).toContainText(text('zh-CN', 'app.rules'));

  await a.reload();
  await expect(a.getByTestId('sync-status')).toHaveAttribute('data-state', 'online');
  await openAtlas(a); // a reload resets the route to Home (app/routes.ts `defaultRoute`); the card itself is server state
  await expect(a.locator('[data-card="sources"]')).toBeVisible();

  await a.locator('[data-card="sources"] [data-testid="card-remove"]').click();
  await expect(a.locator('[data-card="sources"]')).toHaveCount(0);
});

test('a retrieval answer cites N2 and is labelled rule-based', async () => {
  await openAtlas(a);
  await a.getByTestId('composer-text').fill('N2 现在什么情况？');
  await a.getByTestId('composer-text').press('Enter');
  const reply = a.getByTestId('msg-a').last();
  await expect(reply).toContainText('N2');
  await expect(reply).toContainText(text('zh-CN', 'app.rules'));
});

test('Alex’s chat never reaches Zhou’s page or cache', async () => {
  await openAtlas(a);
  const secret = 'u1 私下的问题 N2';
  await a.getByTestId('composer-text').fill(secret);
  await a.getByTestId('composer-text').press('Enter');
  await expect(a.getByTestId('msg-a').last()).toBeVisible();

  await openAtlas(b);
  await expect(b.locator('body')).not.toContainText(secret);
  const snapB = await bridgeCall<ClientSnapshot>(B, 'snapshot');
  expect(JSON.stringify(snapB)).not.toContain(secret);
});

test('a follow-up question scrolls the thread so the newest answer is in view', async () => {
  await openAtlas(a);
  for (const q of ['N2 现在什么情况？', '本轮交付准备得怎么样？']) {
    await a.getByTestId('composer-text').fill(q);
    await a.getByTestId('composer-text').press('Enter');
    await expect(a.getByTestId('msg-a').last()).toBeVisible();
  }
  // The thread holds every earlier answer too, so its scroll box overflows; it must sit at the bottom.
  const box = a.locator('[data-testid="thread"] .thread-b');
  await expect.poll(() => box.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect.poll(() => box.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 2)).toBe(true);
  await expect(a.getByTestId('msg-a').last()).toBeInViewport();
});

test('+ New focuses the composer of the page it opens', async () => {
  await a.getByTestId('nav-home').click();
  await expect(a.getByTestId('page-home')).toBeVisible();
  await a.getByTestId('side-new').click();
  await expect(a.getByTestId('page-dash')).toBeVisible();
  await expect(a.locator(COMPOSER_INPUT)).toBeFocused();
});

test('an input imported with Only me stays out of Zhou’s client', async () => {
  const probe = await fetch(`${serverUrl}/v1/projects/${ATLAS}/inputs`, {
    method: 'POST',
    headers: { authorization: 'Bearer dev-alex', 'content-type': 'application/json' },
    body: '{}',
  });
  test.skip(probe.status === 404, 'inputs.import not on this server yet');

  await openAtlas(a);
  await a.getByTestId('pv-only').click();
  const secret = 'u1 仅自己的三行文本\n第二行内容\n第三行内容';
  await a.getByTestId('composer-text').fill(secret);
  await a.getByTestId('composer-text').press('Enter');
  const importBtn = a.getByTestId('msg-a').last().getByTestId('chat-import');
  // Sent under Only me, so the import says so (ruling R21).
  await expect(importBtn).toHaveText(text('zh-CN', 'ch.importTo', { v: text('zh-CN', 'pv.only') }));
  await importBtn.click();
  await expect(a.getByTestId('page-inputs')).toBeVisible();

  await openAtlas(b);
  await expect(b.locator('body')).not.toContainText(secret);
  const snapB = await bridgeCall<ClientSnapshot>(B, 'snapshot');
  expect(JSON.stringify(snapB)).not.toContain(secret);
});

test('the stale chip asks Zhou to refresh and then goes away', async () => {
  // The sample's one stale handoff (Atlas HO2 on N2) is left alone: u2-collab.spec.ts reminds it
  // in the same e2e run, and a refresh request cannot be taken back. This test makes its own:
  // Alex hands a new need to Zhou, Zhou's agent reads its context at version 1 (contract §3
  // `context.get`, which the server records as a fetch), and Alex then revises the need.
  const needId = `n-${randomUUID()}`;
  const handoffId = `h-${randomUUID()}`;
  const today = localDay();
  const title = 'U1 e2e 刷新提醒';
  await submit(A, 'need.created', {
    needId,
    projectId: ATLAS,
    kind: 'ext',
    title,
    roundId: null,
    accept: title,
    source: { src: 'doc', date: today, quote: title, ref: 'u1 e2e' },
  });
  await submit(A, 'handoff.created', { handoffId, projectId: ATLAS, needId, toId: 'u-zhou', ask: 'u1 e2e 请先读一下上下文', due: null });
  const code = replay((await bridgeCall<ClientSnapshot>(A, 'snapshot')).events as DomainEvent[]).needs[needId]?.code ?? '';
  expect(code).toMatch(/^N\d+$/);

  const zhou = { authorization: 'Bearer dev-zhou', 'content-type': 'application/json' };
  const made = await fetch(`${serverUrl}/v1/tokens`, { method: 'POST', headers: zhou, body: JSON.stringify({ label: 'u1 e2e stale' }) });
  expect(made.ok, `tokens.create: HTTP ${made.status}`).toBe(true);
  const { token, info } = (await made.json()) as { token: string; info: { id: string } };
  const ctx = await fetch(`${serverUrl}/v1/projects/${ATLAS}/needs/${code}/context`, { headers: { authorization: `Bearer ${token}` } });
  expect(ctx.ok, `context.get: HTTP ${ctx.status}`).toBe(true);
  expect(((await ctx.json()) as { recordedFetch: boolean }).recordedFetch).toBe(true);
  const revoked = await fetch(`${serverUrl}/v1/tokens/${info.id}`, { method: 'DELETE', headers: { authorization: 'Bearer dev-zhou' } });
  expect(revoked.ok, `tokens.revoke: HTTP ${revoked.status}`).toBe(true);
  await submit(A, 'need.revised', { needId, revisionId: `rev-${randomUUID()}`, text: `${title}（第二版）`, why: 'u1 e2e 改了范围', date: today });

  await openAtlas(a);
  await a.getByTestId('nav-board').click();
  await expect(a.getByTestId('page-board')).toBeVisible();
  const chip = a.locator(`[data-testid="chip"][data-chip="stale-${handoffId}"]`);
  await expect(chip).toHaveCount(1);
  await chip.first().click();
  await expect(chip).toHaveCount(0);
});

test('a new project gets a member, a role and a round, and Zhou sees it', async () => {
  const PROJECT_NAME = 'U1 验收项目';
  await a.getByTestId('nav-new-project').click();
  await expect(a.getByTestId('page-newProject')).toBeVisible();
  await a.getByTestId('project-name').fill(PROJECT_NAME);
  await a.getByTestId('project-create').click();
  await expect(a.getByTestId('page-dash')).toBeVisible();
  await expect(a.getByTestId('dash-setup')).toBeVisible();

  await a.getByTestId('nav-members').click();
  await expect(a.getByTestId('page-members')).toBeVisible();
  await a.getByTestId('members-pick').selectOption('u-zhou');
  await a.getByTestId('members-add').click();
  await a.getByTestId('role-name').fill('后端');
  await a.getByTestId('role-add').click();
  await expect(a.getByTestId('role-assign')).toBeVisible();
  await a.getByTestId('role-assign').selectOption('u-zhou');

  await a.getByTestId('nav-rounds').click();
  await expect(a.getByTestId('page-rounds')).toBeVisible();
  await a.getByTestId('round-title').fill('R1');
  await a.getByTestId('round-due').fill('2020-01-01'); // before the default start (today)
  await a.getByTestId('round-add').click();
  await expect(a.getByTestId('round-error')).toBeVisible();
  await a.getByTestId('round-due').fill('2027-12-31'); // fixed: after start
  await a.getByTestId('round-add').click();
  await expect(a.locator('[data-testid="round"][data-round="1"]')).toContainText(text('zh-CN', 'round.current'));

  await expect(b.getByTestId('nav-project').filter({ hasText: PROJECT_NAME })).toBeVisible();

  // Leave the project as a first round really looks, with one shared need in it: later specs in
  // the same e2e run open a shared need on every project in the sidebar (u2-collab.spec.ts's dot
  // sweep), and core has no way to archive a project again.
  let roundId: string | null = null;
  let projectId = '';
  await expect
    .poll(async () => {
      const s = replay((await bridgeCall<ClientSnapshot>(A, 'snapshot')).events as DomainEvent[]);
      projectId = Object.values(s.projects).find((p) => p.name === PROJECT_NAME)?.id ?? '';
      roundId = projectId ? (currentRound(s, projectId)?.id ?? null) : null;
      return roundId;
    })
    .not.toBeNull();
  const title = '导出接口支持按时间筛选';
  await submit(A, 'need.created', {
    needId: `n-${randomUUID()}`,
    projectId,
    kind: 'ext',
    title,
    roundId,
    accept: title,
    source: { src: 'doc', date: localDay(), quote: title, ref: 'u1 e2e' },
  });
});

test('no dot symbol on any U1 page in either language', async () => {
  for (const [page, locale] of [
    [a, 'zh-CN'],
    [b, 'en'],
  ] as const) {
    await visitU1(page, async (view) => {
      const body = await page.locator('body').innerText();
      expect(DOT_RE.test(body), `${locale} ${view}: dot character in ${JSON.stringify(body.match(DOT_RE)?.[0])}`).toBe(false);
    });
  }
});
