import { expect, test } from '@playwright/test';
import { bridgePort, clientUrl, dataDir, serverUrl, type BridgeSpec } from './env';
import { text } from './i18n';
import { startBridgeProc, type Proc } from './procs';

/** Sign-in must never fail silently (wrong URL, missing scheme, empty token, Enter key). */
const C: BridgeSpec = { name: 'signin', port: bridgePort(6), token: 'e2e-signin', locale: 'en-US' };
let proc: Proc;
test.beforeAll(async () => {
  proc = await startBridgeProc({ dataDir: dataDir(C), port: C.port, locale: C.locale, token: C.token });
});
test.afterAll(async () => proc.stop());

test('wrong server URL, missing scheme and empty token each show a visible reason', async ({ page }) => {
  await page.goto(clientUrl(C));
  await page.getByTestId('signin-server').fill('http://127.0.0.1:1');
  await page.getByTestId('signin-token').press('Enter'); // empty token: Enter submits and explains
  await expect(page.getByTestId('signin-error')).toContainText(text('en', 'signin.tokenMissing'));
  await page.getByTestId('signin-token').fill('dev-lin');
  await page.getByTestId('signin-token').press('Enter');
  await expect(page.getByTestId('signin-error')).toContainText(text('en', 'signin.failed', { url: 'http://127.0.0.1:1', reason: text('en', 'error.NETWORK') }));
  await expect(page.getByTestId('signin-error')).toContainText(text('en', 'error.NETWORK'));
  await page.getByTestId('signin-server').fill(serverUrl.replace(/^http:\/\//, ''));
  await page.getByTestId('signin-server').press('Enter');
  await expect(page.getByTestId('signin-error')).toContainText(text('en', 'error.URL_NO_SCHEME'));
  await expect(page.getByTestId('signin')).toBeVisible(); // still on the sign-in screen
  // The real server works from the same form.
  await page.getByTestId('signin-server').fill(serverUrl);
  await page.getByTestId('signin-submit').click();
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'online');
});
