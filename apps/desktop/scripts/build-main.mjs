// Bundles the Electron main process and the preload script (CommonJS, as Electron's sandboxed preload requires).
// The esbuild metafiles go to dist/meta/, where stage-app.mjs checks that nothing is left unbundled.
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { MAIN_BUILD } from './bundle-check.mjs';

const common = { sourcemap: true, logLevel: 'info', metafile: true };
const main = await build({ ...MAIN_BUILD, ...common, outfile: 'dist/main/main.cjs' });
const preload = await build({
  ...common,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  entryPoints: ['src/preload/preload.ts'],
  outfile: 'dist/preload/preload.cjs',
  external: ['electron'],
});
mkdirSync('dist/meta', { recursive: true });
writeFileSync('dist/meta/main.json', JSON.stringify(main.metafile));
writeFileSync('dist/meta/preload.json', JSON.stringify(preload.metafile));
