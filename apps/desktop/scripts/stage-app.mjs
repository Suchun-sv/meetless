// Stages the packaged-app directory (release/app) for electron-builder:
// a minimal package.json (no dependencies) plus the already-built dist/.
// Main and preload are esbuild bundles and the renderer is a Vite build, so
// nothing from node_modules is needed at runtime. This script fails if the
// main or preload bundle still imports a package that would not exist in the app
// (esbuild's metafile from build-main.mjs, so require strings in bundled code do not count).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unbundled } from './bundle-check.mjs';

const desktop = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(desktop, 'package.json'), 'utf8'));
const out = resolve(desktop, 'release/app');

for (const f of ['dist/main/main.cjs', 'dist/preload/preload.cjs', 'dist/renderer/index.html']) {
  if (!existsSync(resolve(desktop, f))) throw new Error(`missing ${f}: run "pnpm build" first`);
}

for (const name of ['main', 'preload']) {
  const meta = resolve(desktop, `dist/meta/${name}.json`);
  if (!existsSync(meta)) throw new Error(`missing dist/meta/${name}.json: run "pnpm build" first`);
  const missing = unbundled(JSON.parse(readFileSync(meta, 'utf8')));
  if (missing.length) throw new Error(`the ${name} bundle requires packages that are not bundled: ${missing.join(', ')}`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(resolve(desktop, 'dist'), resolve(out, 'dist'), { recursive: true, filter: (src) => !src.startsWith(resolve(desktop, 'dist/meta')) });
writeFileSync(
  resolve(out, 'package.json'),
  `${JSON.stringify(
    {
      name: 'meetless',
      productName: 'Meetless',
      version: pkg.version,
      description: 'Meetless desktop client (unsigned dev build)',
      author: { name: 'Meetless' },
      license: 'UNLICENSED',
      private: true,
      main: pkg.main,
    },
    null,
    2,
  )}\n`,
);
console.log(`staged ${out} (version ${pkg.version}, main ${pkg.main})`);
