import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helper shared with scripts/stage-app.mjs
import { MAIN_BUILD, unbundled } from '../scripts/bundle-check.mjs';

const desktop = resolve(import.meta.dirname, '..');

describe('bundle check for the packaged app (scripts/stage-app.mjs)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'meetless-bundle-check-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('flags an external package and allows electron, node builtins and the optional ws accelerators', () => {
    const meta = {
      inputs: {},
      outputs: {
        'dist/main/main.cjs': {
          imports: [
            { path: 'electron', kind: 'require-call', external: true },
            { path: 'node:sqlite', kind: 'require-call', external: true },
            { path: 'fs', kind: 'require-call', external: true },
            { path: 'bufferutil', kind: 'require-call', external: true },
            { path: 'left-pad', kind: 'require-call', external: true },
            { path: 'src/x.ts', kind: 'import-statement' },
          ],
        },
      },
    };
    expect(unbundled(meta)).toEqual(['left-pad']);
  });

  it('the real main bundle has nothing unbundled, though ajv code generation leaves require strings in its text', async () => {
    const r = await build({ ...MAIN_BUILD, absWorkingDir: desktop, outfile: join(tmp, 'main.cjs'), sourcemap: false, logLevel: 'silent', metafile: true });
    expect(unbundled(r.metafile)).toEqual([]);
  }, 60_000);
});
