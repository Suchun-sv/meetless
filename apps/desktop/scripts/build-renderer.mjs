// Builds dist/renderer, the UI the window loads. MEETLESS_UI picks it:
// - expo (default): apps/app's web export (Expo Router, react-native-web), served by main on app://meetless;
// - legacy: the Vite renderer in src/renderer (file://), kept as a fallback until the switch is approved.
// The Expo export gets the same strict CSP as a meta tag (main also sends it as a header).
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const desktop = resolve(import.meta.dirname, '..');
const appDir = resolve(desktop, '../app');
const out = resolve(desktop, 'dist/renderer');
const ui = process.env.MEETLESS_UI || 'expo';
// Every step runs a script with this Node, a package's CLI included (resolved from its package.json
// `bin`): no npx, no .cmd shim and no shell, which Windows needs to spawn npx at all.
const node = (args, cwd) => execFileSync(process.execPath, args, { cwd, stdio: 'inherit', env: process.env });
const cli = (pkg, from) => {
  const manifest = createRequire(resolve(from, 'package.json')).resolve(`${pkg}/package.json`);
  const bin = JSON.parse(readFileSync(manifest, 'utf8')).bin;
  return resolve(dirname(manifest), typeof bin === 'string' ? bin : bin[pkg]);
};

const CSP =
  "default-src 'self'; script-src 'self' http://127.0.0.1:55435; frame-src 'self' http://127.0.0.1:55435; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*";

if (ui === 'legacy') {
  node([cli('vite', desktop), 'build'], desktop);
} else if (ui === 'expo') {
  rmSync(out, { recursive: true, force: true });
  node(['scripts/web-fonts.mjs'], appDir);
  node([cli('expo', appDir), 'export', '--platform', 'web', '--output-dir', out, '--source-maps', 'external'], appDir);
  // Third-party notices from the source maps (which it then deletes); stage-app merges the package list.
  node(['scripts/notices.mjs', out, '--list', resolve(desktop, 'dist/meta/renderer-packages.json')], appDir);
  const index = resolve(out, 'index.html');
  const html = readFileSync(index, 'utf8');
  if (!html.includes('/_expo/static/js/')) throw new Error('the Expo export has no bundle in index.html');
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`;
  const charset = /<meta charset="utf-8" \/>/i;
  writeFileSync(index, charset.test(html) ? html.replace(charset, (m) => `${m}\n    ${meta}`) : html.replace('<head>', `<head>${meta}`));
} else {
  throw new Error(`MEETLESS_UI must be expo or legacy, not ${ui}`);
}
console.log(`dist/renderer: ${ui}`);
