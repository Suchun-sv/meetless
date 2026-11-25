// Bundles the Electron main process and the preload script (CommonJS, as Electron's sandboxed preload requires).
// The esbuild metafiles go to dist/meta/, where stage-app.mjs checks that nothing is left unbundled.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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

// The boot loader (package.json "main") runs the bundled main or a verified hot update.
copyFileSync('src/boot/boot.cjs', 'dist/boot.cjs');
copyFileSync('src/boot/pick.cjs', 'dist/pick.cjs');
// The shell this code needs (hot updates must match it): Electron, its main-process ABI, the fuses.
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const electron = pkg.devDependencies.electron;
let abi = null;
try {
  abi = createRequire(require.resolve('electron-builder/package.json'))('node-abi').getAbi(electron, 'electron');
} catch {
  abi = null;
}
writeFileSync('dist/shell.json', `${JSON.stringify({ electron, abi, fuses: require('./fuses.cjs').fusesKey() })}\n`);
