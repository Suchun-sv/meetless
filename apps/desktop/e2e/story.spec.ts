import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { MCP_PATH } from '@meetless/api';
import { DOT_RE, replay, type DomainEvent, type State } from '@meetless/core';
import type { ClientSnapshot } from '@meetless/client/bridge';
import type { Locale } from '@meetless/i18n';
import { marksBeforeCodes } from '../test/support/markup';
import { bridgeCall, bridgePort, clientUrl, dataDir, E2E, serverUrl, type BridgeSpec } from './env';
import { text } from './i18n';
import { startBridgeProc, type Proc } from './procs';

/*
 * The design's §10 acceptance story in one serial spec: two independent clients against the
 * real server (global setup: Postgres, a throw-away e2e_* schema, the zh-CN sample, dev auth on).
 * Neither client uses a dev token and the story never touches the sample data:
 *
 * - Client A (zh-CN, bridge slot 9) redeems the server's one-time admin invite, which the
 *   server writes to `<data dir>/admin-invite.txt` on first start (`InviteService.ensureAdminInvite`;
 *   global setup's data dir is `.data/e2e/server`). Only when that file is gone (some earlier
 *   spec in the run redeemed it) does A fall back to a project invite minted with `Bearer
 *   dev-alex`; the fallback is noted as a test annotation.
 * - A creates its own project, and invites client B (en, bridge slot 6) from the Members page.
 *
 * Bridge slots: 1 to 8 are used by the other specs. Slot 9 is free; slot 6 belongs to
 * `signin.spec.ts`, which runs (and stops its bridge in afterAll) before this file, since
 * Playwright runs the files one at a time in name order with one worker.
 *
 * All asserted UI copy comes from `text(locale, key, params)`. The literal strings here are
 * user content (names, titles, PDF text), the MCP client header value `claude-code` (shown by
 * the UI as is) and the `meetless://` link form.
 */
const A: BridgeSpec = { name: 'story-a', port: bridgePort(9), token: 'e2e-story-a', locale: 'zh-CN' };
const B: BridgeSpec = { name: 'story-b', port: bridgePort(6), token: 'e2e-story-b', locale: 'en' };
const LA: Locale = 'zh-CN';
const LB: Locale = 'en';
const A_NAME = '安然';
const B_NAME = 'Bea Story';
const PROJECT = '故事验收项目';
const SHARED_TITLE = '故事 导出接口按时间筛选';
const PRIVATE_WORD = 'pangolin';
const PRIVATE_TITLE = `故事 私有草稿 ${PRIVATE_WORD}`;
const ASK = '故事 请先读上下文再动手';
const AGENT_TEXT = 'Story agent drafted the date filter query';
const CLIENT = 'claude-code';
const PDF_TITLE = '故事 规格书';
const PDF_WORD = 'quokka';
const PDF_PAGES = [['Story spec page one', 'Nothing to find here'], [`The ${PDF_WORD} threshold is forty two`, 'Measured on the export job']];
const COMPOSER = 'composer-text';

test.describe.configure({ mode: 'serial' });

let procs: Proc[] = [];
let a: Page;
let b: Page;
let projectId = '';
let bId = '';
let sharedId = '';
let privateId = '';
let link = '';
let agentToken = '';
let mcp: Client | null = null;

type CallResult = Awaited<ReturnType<Client['callTool']>>;

/** A minimal valid PDF (Helvetica, ASCII text only), one content stream per page; the same construction as apps/server/test/support/pdf.ts. */
function minimalPdf(pages: string[][]): Buffer {
  const n = pages.length;
  const pageIds = pages.map((_, i) => 3 + i);
  const fontId = 3 + n;
  const contentIds = pages.map((_, i) => 4 + n + i);
  const contents = pages.map((lines) => lines.map((line, i) => `BT /F1 12 Tf 72 ${720 - i * 18} Td (${line}) Tj ET`).join('\n'));
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${n} >>`,
    ...pageIds.map((_, i) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...contents.map((c) => `<< /Length ${c.length} >>\nstream\n${c}\nendstream`),
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

async function openSignIn(browser: Browser, spec: BridgeSpec, lang: string): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  await page.goto(clientUrl(spec));
  await expect(page.getByTestId('signin')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  return page;
}

async function redeem(page: Page, name: string, code: string): Promise<void> {
  await expect(page.getByTestId('signin-server')).toHaveValue(serverUrl);
  await page.getByTestId('signin-name').fill(name);
  await page.getByTestId('signin-code').fill(code);
  await page.getByTestId('signin-redeem').click();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'online');
}

/** No dot character in the visible text (or the context preview), and no mark before a need code in the markup; as `expectClean` in u2-collab.spec.ts. */
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

async function stateOf(spec: BridgeSpec): Promise<State> {
  const snap = await bridgeCall<ClientSnapshot>(spec, 'snapshot');
  return replay(snap.events as DomainEvent[]);
}

async function openProject(page: Page): Promise<void> {
  await page.locator(`[data-testid="nav-project"][data-project="${projectId}"]`).click();
  await expect(page.getByTestId('page-dash')).toBeVisible();
}

async function openView(page: Page, view: string): Promise<void> {
  await openProject(page);
  if (view === 'dash') return;
  await page.getByTestId(`nav-${view}`).click();
  await expect(page.getByTestId(`page-${view}`)).toBeVisible();
}

async function openBoard(page: Page): Promise<void> {
  await openView(page, 'board');
  await page.getByTestId('board-mode-rounds').click();
}

const card = (page: Page, needId: string) => page.locator(`[data-testid="need-card"][data-need="${needId}"]`);
const drawerOf = (page: Page, needId: string) => page.locator(`[data-testid="drawer"][data-need="${needId}"]`);

async function openDrawer(page: Page, needId: string): Promise<Locator> {
  await card(page, needId).click();
  const d = drawerOf(page, needId);
  await expect(d).toBeVisible();
  return d;
}

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

async function close(page: Page, overlay: string): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId(overlay)).toBeHidden();
}

async function ask(page: Page, q: string): Promise<Locator> {
  const before = await page.getByTestId('msg-a').count();
  await page.getByTestId(COMPOSER).fill(q);
  await page.getByTestId(COMPOSER).press('Enter');
  await expect(page.getByTestId('msg-a')).toHaveCount(before + 1);
  return page.getByTestId('msg-a').last();
}

/** The seq of `needId`'s accepted `need.created` on `spec`, once the server has accepted it. */
async function acceptedCreate(spec: BridgeSpec, needId: string): Promise<number> {
  let seq = 0;
  await expect
    .poll(async () => {
      const snap = await bridgeCall<ClientSnapshot>(spec, 'snapshot');
      const e = (snap.events as DomainEvent[]).find((x) => x.type === 'need.created' && (x.payload as { needId: string }).needId === needId);
      seq = e?.seq ?? 0;
      return seq;
    })
    .toBeGreaterThan(0);
  return seq;
}

async function call(name: string, args: Record<string, unknown>): Promise<CallResult> {
  const r = (await mcp!.callTool({ name, arguments: args })) as CallResult;
  const content = r.content as { type: string; text?: string }[];
  expect(r.isError === true, `${name}: ${content[0]?.text}`).toBe(false);
  return r;
}
const resultText = (r: CallResult) => (r.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n');

test.beforeAll(async () => {
  const started = await Promise.allSettled([A, B].map((s) => startBridgeProc({ dataDir: dataDir(s), port: s.port, locale: s.locale, token: s.token })));
  procs = started.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const failed = started.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
});
test.afterAll(async () => {
  await mcp?.close().catch(() => undefined);
  await a?.context().close();
  await b?.context().close();
  for (const p of procs) await p.stop();
});

test('A signs in with the admin invite, makes a project and invites B', async ({ browser }) => {
  test.setTimeout(120_000);
  await test.step('A redeems the admin invite on the sign-in page', async () => {
    a = await openSignIn(browser, A, 'zh-CN');
    await expectClean(a, 'zh-CN signin');
    const file = resolve(E2E.root, 'server', 'admin-invite.txt');
    let code: string;
    if (existsSync(file)) {
      code = readFileSync(file, 'utf8').trim();
      test.info().annotations.push({ type: 'invite', description: 'A redeemed the admin invite from admin-invite.txt' });
      console.log('[story] A redeems the admin invite');
    } else {
      // The admin invite is gone (an earlier spec redeemed it): mint a project invite through the API instead.
      const r = await fetch(`${serverUrl}/v1/projects/sample-atlas/invites`, {
        method: 'POST',
        headers: { authorization: 'Bearer dev-alex', 'content-type': 'application/json' },
        body: JSON.stringify({ roleId: null }),
      });
      expect(r.ok, `invites.create: HTTP ${r.status}`).toBe(true);
      code = ((await r.json()) as { code: string }).code;
      test.info().annotations.push({ type: 'invite', description: 'admin-invite.txt missing; A redeemed an invite minted with Bearer dev-alex' });
      console.log('[story] admin-invite.txt missing: A redeems an invite minted with Bearer dev-alex');
    }
    expect(code.length).toBeGreaterThan(0);
    await redeem(a, A_NAME, code);
    await expect(a.getByTestId('page-home')).toBeVisible();
  });

  await test.step('A creates a fresh project with a first round', async () => {
    await a.getByTestId('nav-new-project').click();
    await expect(a.getByTestId('page-newProject')).toBeVisible();
    await a.getByTestId('project-name').fill(PROJECT);
    await a.getByTestId('project-create').click();
    await expect(a.getByTestId('page-dash')).toBeVisible();
    await expect
      .poll(async () => {
        projectId = Object.values((await stateOf(A)).projects).find((p) => p.name === PROJECT)?.id ?? '';
        return projectId;
      })
      .not.toBe('');
    await a.getByTestId('nav-rounds').click();
    await expect(a.getByTestId('page-rounds')).toBeVisible();
    await a.getByTestId('round-title').fill('R1');
    await a.getByTestId('round-due').fill('2027-12-31');
    await a.getByTestId('round-add').click();
    await expect(a.locator('[data-testid="round"][data-round="1"]')).toContainText(text(LA, 'round.current'));
  });

  await test.step('A invites B from the Members page; B redeems it in the en client', async () => {
    await a.getByTestId('nav-members').click();
    await expect(a.getByTestId('page-members')).toBeVisible();
    await a.getByTestId('invite-create').click();
    const code = (await a.getByTestId('invite-code').innerText()).trim();
    expect(code.length).toBeGreaterThan(0);

    b = await openSignIn(browser, B, 'en');
    await expectClean(b, 'en signin');
    await redeem(b, B_NAME, code);
    await expect(b.locator(`[data-testid="nav-project"][data-project="${projectId}"]`)).toBeVisible();
    await expect
      .poll(async () => {
        const s = await stateOf(A);
        bId = Object.values(s.users).find((u) => u.displayName === B_NAME)?.id ?? '';
        return bId !== '' && (s.projects[projectId]?.memberIds.includes(bId) ?? false);
      })
      .toBe(true);
  });
});

test('handoff, agent report over MCP, stale context and privacy', async () => {
  test.setTimeout(180_000);
  await test.step('A creates a private need and a shared need', async () => {
    await openBoard(a);
    privateId = await createNeed(a, PRIVATE_TITLE, true);
    await expect(drawerOf(a, privateId)).toContainText(text(LA, 'pv.mine'));
    sharedId = await createNeed(a, SHARED_TITLE, false);
    await acceptedCreate(A, privateId);
    await acceptedCreate(A, sharedId);
  });

  await test.step('A hands the shared need to B', async () => {
    await a.getByTestId('dr-handoff').click();
    const ho = a.getByTestId('overlay-handoff');
    await expect(ho).toBeVisible();
    await ho.locator(`[data-testid="ho-person"][data-person="${bId}"]`).click();
    await ho.getByTestId('ho-ask-text').fill(ASK);
    await ho.getByTestId('ho-send').click();
    await expect(ho).toBeHidden();
    await expect(drawerOf(a, sharedId).getByTestId('hob')).toHaveAttribute('data-state', 'sent');
  });

  await test.step('B accepts, starts and copies the link and prompt', async () => {
    await openBoard(b);
    await expect(card(b, sharedId)).toContainText(text(LB, 'ho.from', { who: A_NAME }));
    const hob = (await openDrawer(b, sharedId)).getByTestId('hob');
    await expect(hob).toContainText(ASK);
    await hob.getByTestId('ho-accept').click();
    await expect(hob).toHaveAttribute('data-state', 'accepted');
    await hob.getByTestId('ho-start').click();
    await expect(hob).toHaveAttribute('data-state', 'doing');
    await hob.getByTestId('ho-copy').click();
    const lk = b.getByTestId('overlay-link');
    await expect(lk).toBeVisible();
    await lk.getByTestId('lk-copy').click();
    await expect(lk.getByTestId('lk-copy')).toContainText(text(LB, 'cp.copied'));
    const code = (await stateOf(B)).needs[sharedId]?.code ?? '';
    expect(code).toMatch(/^N\d+$/);
    link = `meetless://${projectId}/${code}`;
    const clip = await b.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain(link);
    expect(clip).toContain(text(LB, 'lk.prompt2'));
    await close(b, 'overlay-link');
  });

  await test.step('B creates an agent token; the agent reads the context and reports over MCP', async () => {
    await b.getByTestId('nav-agents').click();
    await expect(b.getByTestId('page-agents')).toBeVisible();
    await b.getByTestId('token-label').fill('story laptop');
    await b.getByTestId('token-create').click();
    await expect(b.getByTestId('token-once')).toBeVisible();
    agentToken = (await b.getByTestId('token-once').locator('.mono').innerText()).trim();
    expect(agentToken.length).toBeGreaterThan(0);

    mcp = new Client({ name: 'meetless-story-e2e', version: '0.0.0' });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(`${serverUrl}${MCP_PATH}`), {
        requestInit: { headers: { Authorization: `Bearer ${agentToken}`, 'X-Meetless-Client': CLIENT } },
      }),
    );
    const ctx = resultText(await call('get_need_context', { link }));
    expect(ctx).toContain(SHARED_TITLE);
    expect(ctx).toContain(ASK);
    expect(ctx).not.toContain(PRIVATE_TITLE);
    expect(ctx).not.toContain(PRIVATE_WORD);
    await call('record_work', { link, text: AGENT_TEXT, effect: 'advance' });
  });

  await test.step('A sees the agent report, labelled with the client, in the drawer and the stream', async () => {
    const d = drawerOf(a, sharedId);
    await expect(d).toContainText(AGENT_TEXT);
    await expect(d.locator('.wlist li', { hasText: AGENT_TEXT })).toContainText(text(LA, 'dr.via', { client: CLIENT }));
    await expect(d.getByTestId('hob')).toHaveAttribute('data-state', 'doing');
    await openView(a, 'stream');
    const row = a.getByTestId('stream-row').filter({ hasText: AGENT_TEXT });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(text(LA, 'stream.via', { client: CLIENT }));
    await expect(row).toContainText(text(LA, 'stream.progress'));
    await expectClean(a, 'zh-CN stream after the agent report');
  });

  await test.step('A revises the need; the handoff is stale; A reminds; B is asked to refresh', async () => {
    await openBoard(a);
    const d = await openDrawer(a, sharedId);
    await d.getByTestId('dr-revise').click();
    await d.getByTestId('nn-revise-text').fill(`${SHARED_TITLE} 并支持按人筛选`);
    await d.getByTestId('nn-revise-why').fill('客户在评审时补充');
    await d.getByTestId('dr-revise-send').click();
    await expect(d.locator('.dr-h')).toContainText(text(LA, 'dr.version', { v: 2 }));
    const hob = d.getByTestId('hob');
    await expect(hob).toContainText(text(LA, 'ho.stale', { v: 2 }));
    await expectClean(a, 'zh-CN drawer with a stale handoff');
    await hob.getByTestId('ho-remind').click();
    await expect(hob).toContainText(text(LA, 'ho.reminded'));
    await expect(hob.getByTestId('ho-remind')).toHaveCount(0);

    await openBoard(b);
    const db = await openDrawer(b, sharedId);
    await expect(db.getByTestId('hob')).toContainText(text(LB, 'ho.refreshAsked', { who: A_NAME, v: 2 }));
    await expectClean(b, 'en drawer asked to refresh');
  });

  await test.step('A’s private need never reaches B: page, snapshot, MCP list_needs and search', async () => {
    // B has synced past the private need: its cursor is at or after the shared need created after it.
    const seq = await acceptedCreate(A, sharedId);
    await expect.poll(async () => (await bridgeCall<ClientSnapshot>(B, 'snapshot')).status.cursor).toBeGreaterThanOrEqual(seq);
    await openBoard(b);
    await expect(card(b, sharedId)).toBeVisible();
    await expect(card(b, privateId)).toHaveCount(0);
    expect(await b.locator('body').innerText()).not.toContain(PRIVATE_WORD);
    const wire = JSON.stringify(await bridgeCall<ClientSnapshot>(B, 'snapshot'));
    for (const s of [PRIVATE_TITLE, PRIVATE_WORD, privateId]) expect(wire.includes(s), `B’s snapshot holds ${s}`).toBe(false);

    const listed = await call('list_needs', { projectId });
    const codes = (listed.structuredContent as { needs: { code: string }[] }).needs.map((n) => n.code);
    expect(codes).toContain(link.split('/').at(-1));
    const inProject = await call('search', { q: PRIVATE_WORD, projectId });
    expect((inProject.structuredContent as { hits: unknown[] }).hits).toEqual([]);
    const everywhere = await call('search', { q: PRIVATE_WORD });
    expect((everywhere.structuredContent as { hits: unknown[] }).hits).toEqual([]);
    const byTitle = await call('search', { q: '私有草稿', projectId });
    // A positive control: the same search does find B's own shared work, so the empty results above are real.
    const control = await call('search', { q: 'drafted', projectId });
    expect((control.structuredContent as { hits: { id: string }[] }).hits.length).toBeGreaterThan(0);
    const all = [listed, inProject, everywhere, byTitle].map((r) => JSON.stringify(r)).join('\n');
    for (const s of [PRIVATE_TITLE, PRIVATE_WORD, privateId]) expect(all.includes(s), `MCP results hold ${s}`).toBe(false);
  });
});

test('a composer card survives a reload; a PDF answer cites its page', async () => {
  test.setTimeout(120_000);
  await test.step('A adds a card through the composer, reloads, and the card is still there', async () => {
    await openProject(a);
    const reply = await ask(a, '加一张需求来源卡片');
    await expect(a.locator('[data-card="sources"]')).toBeVisible();
    await expect(reply).toContainText(text(LA, 'app.rules'));
    await a.reload();
    await expect(a.getByTestId('sync-status')).toHaveAttribute('data-state', 'online');
    await openProject(a);
    await expect(a.locator('[data-card="sources"]')).toBeVisible();
  });

  let artifactId = '';
  await test.step('A adds a two-page PDF and the server extracts its page texts', async () => {
    await openView(a, 'artifacts');
    await a.getByTestId('af-new').click();
    const modal = a.getByTestId('afn-modal');
    await expect(modal).toBeVisible();
    await modal.getByTestId('afn-kind').selectOption('pdf');
    await modal.getByTestId('afn-title').fill(PDF_TITLE);
    await modal.getByTestId('afn-file').setInputFiles({ name: 'story-spec.pdf', mimeType: 'application/pdf', buffer: minimalPdf(PDF_PAGES) });
    await modal.getByTestId('afn-create').click();
    await expect(modal).toBeHidden();
    const row = a.getByTestId('af-item').filter({ hasText: PDF_TITLE });
    await expect(row).toHaveClass(/\bon\b/);
    artifactId = (await row.getAttribute('data-artifact'))!;
    await expect
      .poll(async () => {
        const d = (await stateOf(A)).artifacts[artifactId]?.versions[0]?.derived;
        return d ? `${d.status}:${d.texts.length}:${d.texts[1]?.includes(PDF_WORD)}` : 'none';
      }, { timeout: 30_000 })
      .toBe('ready:2:true');
  });

  await test.step('A asks about a page-2 word; the answer cites the PDF page; the chip opens it there', async () => {
    await openProject(a);
    const reply = await ask(a, `${PDF_WORD} 阈值是多少`);
    const chip = reply.locator(`[data-testid="material-chip"][data-material="${artifactId}"]`);
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText(PDF_TITLE);
    await expect(chip).toContainText(text(LA, 'ans.f.page'));
    await expect(chip).toContainText('2');
    await expect(reply).toContainText(text(LA, 'ans.materials'));
    await expect(reply).toContainText(PDF_WORD);
    await expectClean(a, 'zh-CN dash with a material answer');
    await chip.click();
    await expect(a.getByTestId('page-artifacts')).toBeVisible();
    await expect(a.locator(`[data-testid="af-item"][data-artifact="${artifactId}"]`)).toHaveClass(/\bon\b/);
    await expect(a.getByTestId('af-viewer')).toHaveAttribute('data-page', '1');
    await expectClean(a, 'zh-CN artifacts at page 2');
  });
});

test('no dot symbols on any page either client visited, in both languages', async () => {
  test.setTimeout(180_000);
  for (const [page, locale] of [
    [a, LA],
    [b, LB],
  ] as const) {
    await test.step(`${locale}: every page and overlay of the story`, async () => {
      const tag = (s: string) => `${locale} ${s}`;
      await page.getByTestId('nav-home').click();
      await expect(page.getByTestId('page-home')).toBeVisible();
      await expectClean(page, tag('home'));
      for (const view of ['dash', 'inputs', 'artifacts', 'stream', 'deliveries']) {
        await openView(page, view);
        await expectClean(page, tag(view));
      }
      await openProject(page);
      for (const view of ['members', 'rounds']) {
        await page.getByTestId(`nav-${view}`).click();
        await expect(page.getByTestId(`page-${view}`)).toBeVisible();
        await expectClean(page, tag(view));
      }

      await openBoard(page);
      await expectClean(page, tag('board'));
      await page.getByTestId('board-mode-lineage').click();
      await expect(page.getByTestId('lineage')).toBeVisible();
      await expectClean(page, tag('lineage'));
      await page.getByTestId('board-mode-rounds').click();
      const d = await openDrawer(page, sharedId);
      await expectClean(page, tag('drawer'));
      await d.getByTestId('dr-handoff').click();
      await expect(page.getByTestId('overlay-handoff')).toBeVisible();
      await expectClean(page, tag('overlay-handoff'));
      await close(page, 'overlay-handoff');
      await d.getByTestId('dr-link').click();
      const lk = page.getByTestId('overlay-link');
      await expect(lk).toBeVisible();
      await lk.getByTestId('lk-preview').click();
      await expect(lk.getByTestId('lk-context')).toBeVisible();
      await expectClean(page, tag('overlay-link preview'));
      await close(page, 'overlay-link');
      await page.getByTestId('topbar-confirm').click();
      await expect(page.getByTestId('overlay-confirm')).toContainText(text(locale, 'ask.title'));
      await expectClean(page, tag('overlay-confirm'));
      await close(page, 'overlay-confirm');

      for (const view of ['agents', 'newProject']) {
        await page.getByTestId(view === 'agents' ? 'nav-agents' : 'nav-new-project').click();
        await expect(page.getByTestId(`page-${view}`)).toBeVisible();
        await expectClean(page, tag(view));
      }
    });
  }
});
