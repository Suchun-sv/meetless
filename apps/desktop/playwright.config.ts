import { defineConfig } from '@playwright/test';
import { E2E } from './e2e/env';

/**
 * Headless Chromium against the Vite-served renderer. Each "client" is a
 * separate dev bridge host process (own data dir + SQLite cache) talking to a
 * real sync server process on Postgres (see e2e/global-setup.ts).
 * This is NOT Electron e2e (no display on this machine; see infra/dev/electron-e2e.sh).
 * Ports come from MEETLESS_E2E_BASE and MEETLESS_E2E_RENDERER_PORT (e2e/env.ts).
 */
export const RENDERER_PORT = E2E.rendererPort;

export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    headless: true,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    trace: 'off',
  },
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${RENDERER_PORT} --strictPort`,
    url: `http://127.0.0.1:${RENDERER_PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
