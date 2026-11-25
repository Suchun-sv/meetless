import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runSmokeChecks } from '../src/main/smoke-checks';

describe('packaged-app smoke checks', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('pass under plain Node with a temp data dir', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'meetless-smoke-test-'));
    dirs.push(dataDir);
    const checks = await runSmokeChecks({ dataDir, systemLocales: ['zh-Hans-CN', 'en-GB'] });
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.map((c) => c.name)).toEqual([
      'node:sqlite loads and runs SQL',
      'local cache (SQLite file) persists across reopen',
      'client engine opens in the data dir (no session)',
      'i18n zh-CN loads',
      'i18n en loads',
      'i18n zh-CN and en differ, locale resolution works',
    ]);
  });
});
