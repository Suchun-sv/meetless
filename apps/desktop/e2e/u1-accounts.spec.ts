import { expect, test, type Browser, type Page } from '@playwright/test';
import { bridgePort, clientUrl, dataDir, serverUrl, type BridgeSpec } from './env';
import { text } from './i18n';
import { startBridgeProc, type Proc } from './procs';

/*
 * End-to-end for invite sign-in, invites and agent tokens (design §8.7; contract §3, §12.1,
 * §12.7, §12.8, §12.15, §12.22 M6), on the real server. `invites.*`, `tokens.*`,
 * `agentSetup.get` and `agent.guide` come from block S; on a server without them they 404.
 * `beforeAll` probes `GET /v1/projects/:projectId/invites` (`invites.list`) with
 * `Bearer dev-alex`; on 404 every test below is skipped with the reason named, so a skip is
 * never mistaken for a pass. With S merged the probe answers 200 and every test runs.
 *
 * NOT `GET /v1/me`, despite the task brief naming it: the base server already answered `/v1/me`
 * before S (the dev-token sign-in every other e2e spec relies on needs it), so it cannot tell
 * whether S is there. `invites.list` came only with S and is exactly what the first test needs,
 * in the same probe-a-real-route-and-skip-on-404 style `u1-flow.spec.ts` uses for its
 * `inputs.import` test (controller ruling R20). The probe runs before any bridge process is
 * started, so a run without S never pays for three client processes it will not use.
 *
 * Ruling R18: Alex is bridge slot 5 (zh-CN, signs in with the dev token `dev-alex`, the real
 * sample's `u-alex`). The fresh signed-out client C (`u1-new`, en, bridge token `e2e-u1c`) is
 * slot 7. A second fresh client is needed for the "used invite" test (a used code must be tried
 * by someone who has not already redeemed it); slot 7 is already spent by C, so this spec uses
 * slot 8 for it rather than stopping and restarting C's bridge process mid-run.
 *
 * Ruling R19: every piece of UI copy asserted below comes from `text(locale, key, params)`,
 * never a literal UI string. The one literal string in this file, `claude mcp add --transport
 * http meetless`, is not UI copy: it is the server-generated MCP install command (contract
 * §12.1's exact `claudeCommand` form), the same in every locale.
 */
const A: BridgeSpec = { name: 'u1-accounts-alex', port: bridgePort(5), token: 'e2e-u1acc-a', locale: 'zh-CN' };
const C: BridgeSpec = { name: 'u1-new', port: bridgePort(7), token: 'e2e-u1c', locale: 'en' };
const C2: BridgeSpec = { name: 'u1-new2', port: bridgePort(8), token: 'e2e-u1c2', locale: 'en' };
const ATLAS = 'sample-atlas';

test.describe.configure({ mode: 'serial' });

let procs: Proc[] = [];
let sMerged = false;
let a: Page;
let c: Page;
let c2: Page;
/** The invite code created by Alex in the first test, reused by the second test as an already-used code. */
let code = '';

async function openPage(browser: Browser, spec: BridgeSpec): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(clientUrl(spec));
  await expect(page.getByTestId('signin')).toBeVisible();
  return page;
}

async function openSignedIn(browser: Browser, spec: BridgeSpec, token: string): Promise<Page> {
  const page = await openPage(browser, spec);
  await page.getByTestId('signin-server').fill(serverUrl);
  await page.getByTestId('signin-token').fill(token);
  await page.getByTestId('signin-submit').click();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'online');
  return page;
}

/** Re-mounts `setup/MembersPage.tsx` (and so `Invites.tsx`'s `useEffect`) to pick up server-side invite changes. */
async function reopenMembers(page: Page): Promise<void> {
  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId('page-home')).toBeVisible();
  await page.locator(`[data-testid="nav-project"][data-project="${ATLAS}"]`).click();
  await expect(page.getByTestId('page-dash')).toBeVisible();
  await page.getByTestId('nav-members').click();
  await expect(page.getByTestId('page-members')).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  const probe = await fetch(`${serverUrl}/v1/projects/${ATLAS}/invites`, { headers: { authorization: 'Bearer dev-alex' } });
  sMerged = probe.status !== 404;
  if (!sMerged) return; // S routes not merged yet: every test below skips itself; no bridge process is worth starting.

  const started = await Promise.allSettled(
    [A, C, C2].map((spec) => startBridgeProc({ dataDir: dataDir(spec), port: spec.port, locale: spec.locale, token: spec.token })),
  );
  procs = started.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const failed = started.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;

  a = await openSignedIn(browser, A, 'dev-alex');
  c = await openPage(browser, C);
  c2 = await openPage(browser, C2);
});

test.afterAll(async () => {
  await a?.context().close();
  await c?.context().close();
  await c2?.context().close();
  for (const p of procs) await p.stop();
});

test('an invite code makes a new account that lands in the project with its role', async () => {
  test.skip(!sMerged, 'S routes not merged yet');

  await a.locator(`[data-testid="nav-project"][data-project="${ATLAS}"]`).click();
  await expect(a.getByTestId('page-dash')).toBeVisible();
  await a.getByTestId('nav-members').click();
  await expect(a.getByTestId('page-members')).toBeVisible();

  // index 0 is the "no role" placeholder (pj.noRole); index 1 is the project's first real role.
  // Read the option's own text (not an innerText of the invisible <option>, which Playwright
  // may report as empty) so the assertion below checks the exact role name the invite was
  // created with, not a guess at it.
  const roleName = await a.getByTestId('invite-role').evaluate((el) => (el as HTMLSelectElement).options[1]?.textContent?.trim() ?? '');
  expect(roleName.length).toBeGreaterThan(0);
  await a.getByTestId('invite-role').selectOption({ index: 1 });
  await a.getByTestId('invite-create').click();
  code = (await a.getByTestId('invite-code').innerText()).trim();
  expect(code.length).toBeGreaterThan(0);

  // M6: redeemInvite strips all whitespace (including padding) and upper-cases the code.
  await c.getByTestId('signin-server').fill(serverUrl);
  await c.getByTestId('signin-name').fill('Wen Hao');
  await c.getByTestId('signin-code').fill(`  ${code.toLowerCase()} `);
  await c.getByTestId('signin-redeem').click();
  await expect(c.getByTestId('sync-status')).toHaveAttribute('data-state', 'online');
  await expect(c.locator(`[data-testid="nav-project"][data-project="${ATLAS}"]`)).toBeVisible();

  await reopenMembers(a);
  await expect(a.locator('[data-testid="invite"]').first()).toContainText('Wen Hao');

  // The invite row's role name only echoes what the invite was created with; it would still say
  // the right thing even if invites.redeem dropped the roleId on the new membership. Check the
  // real member row instead (setup/MembersPage.tsx's `.pill` per assigned role) for proof the
  // role itself actually landed on Wen Hao.
  const memberRow = a.locator('[data-testid="member"]', { hasText: 'Wen Hao' });
  await expect(memberRow).toBeVisible();
  await expect(memberRow.locator('.pill')).toContainText(roleName);
});

test('a used invite code is refused with its reason and the URL', async () => {
  test.skip(!sMerged, 'S routes not merged yet');
  expect(code.length).toBeGreaterThan(0); // minted by the previous test, already redeemed by client C

  await c2.getByTestId('signin-server').fill(serverUrl);
  await c2.getByTestId('signin-name').fill('Second Try');
  await c2.getByTestId('signin-code').fill(code);
  await c2.getByTestId('signin-redeem').click();
  await expect(c2.getByTestId('signin-error')).toContainText(text('en', 'error.INVITE_USED'));
  await expect(c2.getByTestId('signin-error')).toContainText(serverUrl);
});

test('an agent token is shown once, fills the snippets, is listed, and can be revoked', async () => {
  test.skip(!sMerged, 'S routes not merged yet');

  await a.getByTestId('nav-agents').click();
  await expect(a.getByTestId('page-agents')).toBeVisible();

  await a.getByTestId('token-label').fill('e2e Mac');
  await a.getByTestId('token-create').click();
  const tokenOnce = a.getByTestId('token-once');
  await expect(tokenOnce).toBeVisible();
  const token = (await tokenOnce.locator('.mono').innerText()).trim();
  expect(token.length).toBeGreaterThan(0);
  await expect(a.locator('[data-agent="claude-code"] .snip')).toContainText(token);

  await a.reload();
  await expect(a.getByTestId('sync-status')).toHaveAttribute('data-state', 'online');
  await expect(a.getByTestId('token-once')).toHaveCount(0); // held only in AgentsPage's own state, never persisted

  await a.getByTestId('nav-agents').click();
  await expect(a.getByTestId('page-agents')).toBeVisible();
  const row = a.locator('[data-testid="token"]', { hasText: 'e2e Mac' });
  await expect(row).toBeVisible();
  await row.getByTestId('token-revoke').click();
  await expect(row).toContainText(text('zh-CN', 'ag.revoked'));
});

test('setup commands come from the server', async () => {
  test.skip(!sMerged, 'S routes not merged yet');
  await expect(a.locator('[data-agent="claude-code"] .snip')).toContainText('claude mcp add --transport http meetless');
});
