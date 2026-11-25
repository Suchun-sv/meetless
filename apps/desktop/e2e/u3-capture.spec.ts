import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { isOpen, projectWork, replay, type DomainEvent, type Need, type State } from '@meetless/core';
import type { CaptureStatus, ClientSnapshot, Result } from '@meetless/client/bridge';
import type { Locale } from '@meetless/i18n';
import { bridgeCall, bridgePort, clientUrl, dataDir, type BridgeSpec } from './env';
import { text } from './i18n';
import { startBridgeProc, type Proc } from './procs';

/*
 * U3 capture between two clients against the real server with the zh-CN sample (global setup).
 * Client A is Alex (dev-alex) in zh-CN on bridge slot 7, client B is Zhou (dev-zhou) in en on
 * slot 8. The Overleaf project is a bare git repo in os.tmpdir() (the dev-bridge host accepts a
 * local path as an Overleaf URL). Both bridges point the Notion MCP at an unreachable loopback
 * URL, so nothing in this spec ever talks to notion.com.
 */
const A: BridgeSpec = { name: 'u3ca', port: bridgePort(7), token: 'e2e-bridge-u3ca', locale: 'zh-CN' };
const B: BridgeSpec = { name: 'u3cb', port: bridgePort(8), token: 'e2e-bridge-u3cb', locale: 'en-US' };
const ATLAS = 'sample-atlas';
const LA: Locale = 'zh-CN';
const LB: Locale = 'en';
/** Atlas N2 is an open external need in the sample (导出支持按时间筛选, doing). */
const CODE = 'N2';
const TEX_LINE = `${CODE} date range filter: section 2 now covers the export window`;
const OVERLEAF_TITLE = 'E2E Overleaf 论文';
const NOTION_URL = 'https://www.notion.so/E2E-Spec-0123456789abcdef0123456789abcdef';
const BRIDGE_ENV = { MEETLESS_NOTION_MCP_URL: 'http://127.0.0.1:9/mcp' };

test.describe.configure({ mode: 'serial' });

let procs: Proc[] = [];
let alex: Page;
let zhou: Page;
let tmp = '';
let bare = '';
let overleafId = '';
/** Every URL the two renderers requested during the spec. */
const requested: string[] = [];

async function openSignedIn(browser: Browser, b: BridgeSpec, token: string, lang: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  page.on('request', (r) => void requested.push(r.url()));
  await page.goto(clientUrl(b));
  await expect(page.getByTestId('signin')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  await page.getByTestId('signin-token').fill(token);
  await page.getByTestId('signin-submit').click();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'online');
  return page;
}

async function openSection(page: Page, section: 'artifacts' | 'stream'): Promise<void> {
  await page.locator(`[data-testid="nav-project"][data-project="${ATLAS}"]`).click();
  await expect(page.getByTestId('page-dash')).toBeVisible();
  await page.getByTestId(`nav-${section}`).click();
  await expect(page.getByTestId(`page-${section}`)).toBeVisible();
}

async function stateOf(b: BridgeSpec): Promise<State> {
  const snap = await bridgeCall<ClientSnapshot>(b, 'snapshot');
  return replay(snap.events as DomainEvent[]);
}

const captures = async (b: BridgeSpec) => projectWork(await stateOf(b), ATLAS).filter((w) => w.capture);

const item = (page: Page, title: string): Locator => page.getByTestId('af-item').filter({ hasText: title });
const notice = (page: Page, s: string): Locator => page.getByRole('status').filter({ hasText: s });

async function createArtifact(page: Page, o: { kind: string; title: string; url: string }): Promise<string> {
  await page.getByTestId('af-new').click();
  const modal = page.getByTestId('afn-modal');
  await expect(modal).toBeVisible();
  await modal.getByTestId('afn-kind').selectOption(o.kind);
  await modal.getByTestId('afn-title').fill(o.title);
  await modal.getByTestId('afn-url').fill(o.url);
  await modal.getByTestId('afn-create').click();
  await expect(modal).toBeHidden();
  const row = item(page, o.title);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveClass(/\bon\b/);
  return (await row.getAttribute('data-artifact'))!;
}

/** A bare repo with one commit, subject Overleaf's own 'Update on Overleaf.', adding a .tex line that names Atlas N2. */
function makeOverleafRepo(): void {
  tmp = mkdtempSync(join(tmpdir(), 'meetless-u3-overleaf-'));
  const work = join(tmp, 'work');
  bare = join(tmp, 'project.git');
  mkdirSync(work);
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, stdio: 'pipe' });
  git(work, 'init', '-q', '-b', 'master');
  writeFileSync(join(work, 'main.tex'), `${TEX_LINE}\n`);
  git(work, 'add', 'main.tex');
  git(work, '-c', 'user.name=E2E', '-c', 'user.email=e2e@example.invalid', 'commit', '-q', '-m', 'Update on Overleaf.');
  git(tmp, 'clone', '-q', '--bare', work, bare);
}

test.beforeAll(async ({ browser }) => {
  makeOverleafRepo();
  const started = await Promise.allSettled(
    [A, B].map((b) => startBridgeProc({ dataDir: dataDir(b), port: b.port, locale: b.locale, token: b.token, env: BRIDGE_ENV })),
  );
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
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('A links an Overleaf repo by git URL, syncs and captures; B sees the capture as reference only', async () => {
  const n2 = Object.values((await stateOf(A)).needs).find((n: Need) => n.projectId === ATLAS && n.code === CODE);
  expect(n2, `Atlas ${CODE} is in the sample`).toBeDefined();
  expect(isOpen(n2!), `Atlas ${CODE} is open`).toBe(true);
  expect(await captures(A)).toEqual([]);

  await openSection(alex, 'artifacts');
  overleafId = await createArtifact(alex, { kind: 'overleaf', title: OVERLEAF_TITLE, url: bare });
  const source = alex.getByTestId('af-source');
  await expect(source).toHaveAttribute('data-kind', 'overleaf');
  await expect(source).toHaveAttribute('data-ready', 'false');
  await expect(source).toContainText(bare);

  // Sync clones the repo: the source is ready and shows its commit.
  await source.getByTestId('af-ol-sync').click();
  await expect(source).toHaveAttribute('data-ready', 'true');
  await expect(source.getByTestId('af-commit')).toHaveCount(1);
  await expect(source.getByTestId('af-commit')).toContainText('Update on Overleaf.');

  // Capture: the commit's own subject is Overleaf's default, so the added .tex line names the need.
  await source.getByTestId('cap-run').click();
  await expect(notice(alex, text(LA, 'cap.text', { n: 1 }))).toBeVisible();
  await expect.poll(async () => (await captures(A)).length).toBe(1);
  const [w] = await captures(A);
  expect(w!.needId).toBe(n2!.id);
  expect(w!.src).toBe('commit');
  expect(w!.autoLinked).toBe(true);
  expect(w!.privateTo).toBeNull();
  expect(w!.text).toContain(TEX_LINE);
  await expect(source).toContainText(text(LA, 'cap.tip'));

  // B sees it in the stream, labelled as a capture for reference, never as progress.
  await openSection(zhou, 'stream');
  const row = zhou.locator(`[data-testid="stream-row"][data-work="${w!.id}"]`);
  await expect(row).toHaveAttribute('data-kind', 'capture');
  await expect(row).toContainText(text(LB, 'cap.label'));
  await expect(row).not.toContainText(text(LB, 'stream.progress'));
  await expect(row).toContainText(TEX_LINE);
  await expect(row.locator('.needchip')).toContainText(CODE);
  const firstCapture = zhou.locator('[data-testid="stream-row"][data-kind="capture"]').first();
  await expect(firstCapture).toContainText(text(LB, 'cap.label'));
  await expect(firstCapture).not.toContainText(text(LB, 'stream.progress'));
});

test('capturing again records nothing new', async () => {
  const before = (await captures(A)).length;
  expect(before).toBe(1);
  const rowsB = zhou.locator('[data-testid="stream-row"][data-kind="capture"]');
  await expect(rowsB).toHaveCount(before);

  await openSection(alex, 'artifacts');
  await alex.locator(`[data-testid="af-item"][data-artifact="${overleafId}"]`).click();
  const source = alex.getByTestId('af-source');
  await expect(source).toHaveAttribute('data-ready', 'true');
  await source.getByTestId('cap-run').click();
  await expect(notice(alex, text(LA, 'cap.none'))).toBeVisible();
  await expect(source.getByTestId('cap-run')).toBeEnabled();

  // The row count is unchanged, in A's client and on B's stream.
  expect((await captures(A)).length).toBe(before);
  await openSection(alex, 'stream');
  await expect(alex.locator('[data-testid="stream-row"][data-kind="capture"]')).toHaveCount(before);
  await expect(rowsB).toHaveCount(before);
});

test('a Notion artifact without authorisation asks to authorise and shows no page content', async () => {
  await openSection(alex, 'artifacts');
  const id = await createArtifact(alex, { kind: 'notion', title: 'E2E Notion 页面', url: NOTION_URL });
  const source = alex.getByTestId('af-source');
  await expect(source).toHaveAttribute('data-kind', 'notion');
  await expect(source).toHaveAttribute('data-ready', 'false');
  await expect(source).toContainText(text(LA, 'af.notionNeedAuth'));
  await expect(source).toContainText(text(LA, 'cap.err.notion_not_connected'));
  await expect(source.getByTestId('af-notion-connect')).toBeVisible();
  await expect(alex.getByTestId('af-notion-page')).toHaveCount(0);
  await expect(alex.getByTestId('af-notion-read')).toHaveCount(0);

  const st = await bridgeCall<Result<{ status: CaptureStatus }>>(A, 'captureStatus', ATLAS);
  expect(st.ok).toBe(true);
  if (st.ok) {
    expect(st.status.notion).toBe('disconnected');
    expect(st.status.sources.find((s) => s.artifactId === id)).toMatchObject({ kind: 'notion', ready: false, code: 'notion_not_connected' });
  }

  // Capturing it reads nothing and records nothing; the page is still not shown.
  const before = (await captures(A)).length;
  await source.getByTestId('cap-run').click();
  await expect(notice(alex, text(LA, 'cap.none'))).toBeVisible();
  // The one requested artifact was skipped, so the notice names why (M2), not "Sources not read".
  await expect(notice(alex, text(LA, 'cap.err.notion_not_connected'))).toBeVisible();
  expect((await captures(A)).length).toBe(before);
  await expect(alex.getByTestId('af-notion-page')).toHaveCount(0);

  // Nothing in either renderer went to Notion.
  expect(requested.filter((u) => /notion\.(so|com|site)/i.test(new URL(u).hostname))).toEqual([]);
});
