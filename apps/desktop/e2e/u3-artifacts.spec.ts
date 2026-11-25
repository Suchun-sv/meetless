import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { replay, type Artifact, type DomainEvent, type State } from '@meetless/core';
import type { ClientSnapshot } from '@meetless/client/bridge';
import type { Locale, MessageKey } from '@meetless/i18n';
import { bridgeCall, bridgePort, clientUrl, dataDir, type BridgeSpec } from './env';
import { text } from './i18n';
import { startBridgeProc, type Proc } from './procs';

/*
 * U3 artifacts between two clients against the real server with the zh-CN sample (global
 * setup). Client A is Alex (dev-alex) in zh-CN on bridge slot 7, client B is Zhou (dev-zhou) in
 * en on slot 8. Global setup runs the server with `MEETLESS_OFFICE_URL=off` (no LibreOffice
 * worker), so a DOCX opens in OnlyOffice when DocumentServer answers and is fully wired, and
 * otherwise falls back with the reason shown.
 */
const A: BridgeSpec = { name: 'u3aa', port: bridgePort(7), token: 'e2e-bridge-u3aa', locale: 'zh-CN' };
const B: BridgeSpec = { name: 'u3ab', port: bridgePort(8), token: 'e2e-bridge-u3ab', locale: 'en-US' };
const ATLAS = 'sample-atlas';
const LA: Locale = 'zh-CN';
const DOCX = resolve(import.meta.dirname, '../../../fixtures/office/export-design-v1.docx');
const DOCX_TITLE = 'E2E 导出设计';
/** How long the viewer may take to settle: the office.config call, then up to OFFICE_LOAD_TIMEOUT_MS (20 s) for the editor. */
const SETTLE_MS = 30_000;

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

async function openArtifacts(page: Page): Promise<void> {
  await page.locator(`[data-testid="nav-project"][data-project="${ATLAS}"]`).click();
  await expect(page.getByTestId('page-dash')).toBeVisible();
  await page.getByTestId('nav-artifacts').click();
  await expect(page.getByTestId('page-artifacts')).toBeVisible();
}

async function stateOf(b: BridgeSpec): Promise<State> {
  const snap = await bridgeCall<ClientSnapshot>(b, 'snapshot');
  return replay(snap.events as DomainEvent[]);
}

async function artifactIn(b: BridgeSpec, id: string): Promise<Artifact | undefined> {
  return (await stateOf(b)).artifacts[id];
}

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

const item = (page: Page, title: string): Locator => page.getByTestId('af-item').filter({ hasText: title });

/** Creates an artifact through the af-new modal; returns its id (the item it selects). */
async function createArtifact(page: Page, o: { kind: string; title: string; onlyMe?: boolean; file?: string }): Promise<string> {
  await page.getByTestId('af-new').click();
  const modal = page.getByTestId('afn-modal');
  await expect(modal).toBeVisible();
  await modal.getByTestId('afn-kind').selectOption(o.kind);
  await modal.getByTestId('afn-title').fill(o.title);
  if (o.onlyMe) await modal.getByTestId('afn-private').check();
  if (o.file) await modal.getByTestId('afn-file').setInputFiles(o.file);
  await modal.getByTestId('afn-create').click();
  await expect(modal).toBeHidden();
  const row = item(page, o.title);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveClass(/\bon\b/);
  return (await row.getAttribute('data-artifact'))!;
}

/** Waits until the office viewer has left `config`/`loading`; returns the phase it settled on. */
async function settledPhase(page: Page): Promise<'ready' | 'fallback'> {
  const root = page.locator('[data-office-phase]');
  await expect(root).toHaveAttribute('data-office-phase', /^(ready|fallback)$/, { timeout: SETTLE_MS });
  return (await root.getAttribute('data-office-phase')) as 'ready' | 'fallback';
}

/** The viewer's phase, its text, the fallback reason and the editor frame's src, read in one evaluation. */
async function viewerState(page: Page): Promise<{ phase: string | null; text: string; reason: string | null; frameSrc: string | null }> {
  return page.evaluate(() => {
    const v = document.querySelector<HTMLElement>('[data-testid="af-viewer"]');
    return {
      phase: v?.dataset.officePhase ?? null,
      text: v?.innerText ?? '',
      reason: v?.querySelector<HTMLElement>('[data-testid="af-fallback"]')?.dataset.reason ?? null,
      frameSrc: v?.querySelector('[data-testid="oo-frame"] iframe')?.getAttribute('src') ?? null,
    };
  });
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

test('A adds a DOCX artifact with a file; the viewer shows OnlyOffice read-only or the labelled fallback', async () => {
  await openArtifacts(alex);
  const id = await createArtifact(alex, { kind: 'docx', title: DOCX_TITLE, file: DOCX });

  // The first version carries the uploaded file.
  await expect(alex.getByTestId('af-version')).toHaveCount(1);
  await expect.poll(async () => (await artifactIn(A, id))?.versions[0]?.blobHash ?? null).not.toBeNull();
  const v = (await artifactIn(A, id))!.versions[0]!;
  expect(v.mediaType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');

  const viewer = alex.getByTestId('af-viewer');
  await expect(viewer).toHaveAttribute('data-kind', 'docx');
  await settledPhase(alex);
  // The editor can still fail after `ready` (e.g. DocumentServer cannot fetch the file), so the
  // phase and what it shows are read together, in one step.
  const shown = await viewerState(alex);
  if (shown.phase === 'fallback') {
    expect(['not_configured', 'unsupported_kind', 'no_file', 'unavailable']).toContain(shown.reason);
    expect(shown.text).toContain(text(LA, 'af.fallbackReason', { reason: text(LA, `af.reason.${shown.reason}` as MessageKey) }));
    // The uploaded file is always offered from the fallback (I8).
    await expect(alex.getByTestId('af-original')).toBeVisible();
  } else {
    expect(shown.phase).toBe('ready');
    expect(shown.text).toContain(text(LA, 'af.readonly'));
    expect(shown.frameSrc).toMatch(/^http:\/\/127\.0\.0\.1:55435\//);
  }

  // B sees the shared artifact with its version.
  await openArtifacts(zhou);
  await item(zhou, DOCX_TITLE).click();
  await expect(zhou.getByTestId('af-version')).toHaveCount(1);
  await expect(zhou.getByTestId('af-viewer')).toHaveAttribute('data-kind', 'docx');
});

test('with MEETLESS_E2E_ONLYOFFICE=1 the DocumentServer frame loads from 127.0.0.1:55435', async () => {
  test.skip(process.env.MEETLESS_E2E_ONLYOFFICE !== '1', 'run in block done after onlyoffice.mjs check');
  await openArtifacts(alex);
  await item(alex, DOCX_TITLE).click();
  await expect(alex.locator('[data-office-phase]')).toHaveAttribute('data-office-phase', 'ready', { timeout: SETTLE_MS });
  await expect(alex.getByTestId('af-viewer')).toContainText(text(LA, 'af.readonly'));
  await expect(alex.locator('[data-testid="oo-frame"] iframe')).toHaveAttribute('src', /^http:\/\/127\.0\.0\.1:55435\//);
  // The editor must stay up: when DocumentServer cannot fetch the file, it reports an error a
  // moment after `ready` and the viewer falls back. Hold for a while to tell the two apart.
  const holdUntil = Date.now() + 8_000;
  while (Date.now() < holdUntil) {
    expect(await alex.locator('[data-office-phase]').getAttribute('data-office-phase')).toBe('ready');
    await alex.waitForTimeout(500);
  }
  await expect(alex.getByTestId('af-fallback')).toHaveCount(0);
});

test('a private artifact never reaches B until A shares it', async () => {
  const title = 'E2E 私人产物';
  const barrier = 'E2E 屏障产物';
  await openArtifacts(alex);
  const privateId = await createArtifact(alex, { kind: 'pdf', title, onlyMe: true });
  const header = alex.locator('.af-h');
  await expect(header).toContainText(text(LA, 'pv.mine'));
  await expect(alex.getByTestId('af-share')).toBeVisible();
  expect((await artifactIn(A, privateId))?.privateTo).toBe('u-alex');

  // Barrier: A's next, shared, action. Once B shows it, B has synced past the private one.
  await createArtifact(alex, { kind: 'pdf', title: barrier });
  await openArtifacts(zhou);
  await expect(item(zhou, barrier)).toBeVisible();

  expect(await zhou.locator('body').innerText()).not.toContain(title);
  await expect(zhou.locator(`[data-testid="af-item"][data-artifact="${privateId}"]`)).toHaveCount(0);
  const wire = JSON.stringify(await bridgeCall<ClientSnapshot>(B, 'snapshot'));
  for (const s of [privateId, title]) expect(wire.includes(s), `Zhou’s snapshot holds ${s}`).toBe(false);
  const disk = diskBytes(dataDir(B));
  for (const s of [privateId, title]) expect(disk.includes(Buffer.from(s)), `Zhou’s disk holds ${s}`).toBe(false);

  // A shares it: it is no longer marked as A's own, and B now sees it.
  await item(alex, title).click();
  await alex.getByTestId('af-share').click();
  await expect(header).not.toContainText(text(LA, 'pv.mine'));
  await expect(alex.getByTestId('af-share')).toHaveCount(0);
  await expect(alex.getByTestId('af-copy')).toBeVisible();
  await expect(item(zhou, title)).toBeVisible();
  await expect.poll(async () => (await artifactIn(B, privateId))?.privateTo).toBeNull();
});
