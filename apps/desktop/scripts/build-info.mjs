// dist/build.json, after the main, preload and renderer builds: which commit this code is, when it
// was built, and a hash per part, so a hot update can tell a renderer-only change (reload the
// window) from one that needs a restart (src/main/hot-update.ts).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const files = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
const hashOf = (paths, root) => {
  const h = createHash('sha256');
  for (const f of paths.filter((x) => !x.endsWith('.map')).sort()) h.update(`${relative(root, f)}\0`).update(readFileSync(f));
  return h.digest('hex');
};

let commit = process.env.MEETLESS_COMMIT || '';
if (!commit) {
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    commit = 'dev';
  }
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const parts = {
  main: hashOf(['dist/main/main.cjs', 'dist/boot.cjs', 'dist/pick.cjs'], 'dist'),
  preload: hashOf(['dist/preload/preload.cjs'], 'dist'),
  renderer: hashOf(files('dist/renderer'), 'dist'),
};
// Which UI dist/renderer holds (scripts/build-renderer.mjs). parts.renderer covers every file of it:
// for Expo, the content-hashed bundle names in index.html, the bundle itself and the assets.
const ui = statSync('dist/renderer/_expo', { throwIfNoEntry: false })?.isDirectory() ? 'expo' : 'legacy';
writeFileSync('dist/build.json', `${JSON.stringify({ commit, version: pkg.version, built: new Date().toISOString(), ui, parts })}\n`);
console.log(`dist/build.json: ${commit.slice(0, 12)} ${pkg.version} ${ui}`);
