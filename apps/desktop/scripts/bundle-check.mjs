// What the packaged app may load at runtime that is not inside its own bundles. Shared by
// build-main.mjs (the esbuild options), stage-app.mjs (the check) and test/bundle-check.test.ts.
import { builtinModules } from 'node:module';

/** esbuild options for the Electron main process bundle. */
export const MAIN_BUILD = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  entryPoints: ['src/main/main.ts'],
  external: ['electron', 'bufferutil', 'utf-8-validate'],
};

// electron is provided by the runtime; bufferutil/utf-8-validate are optional ws accelerators (try/catch in ws).
const ALLOWED = new Set(['electron', 'node:sqlite', 'bufferutil', 'utf-8-validate', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/**
 * The external packages an esbuild metafile's outputs still import, other than the allowed ones.
 * It reads esbuild's own import graph, not the bundle text, so a `require("…")` inside a string
 * (ajv's code generation has several) is not mistaken for a real require.
 */
export function unbundled(metafile) {
  const out = new Set();
  for (const o of Object.values(metafile.outputs)) {
    for (const i of o.imports) if (i.external && !ALLOWED.has(i.path)) out.add(i.path);
  }
  return [...out];
}
