// Third-party notices for the Expo app's builds (the web export and the desktop renderer). The
// package set is exact: every node_modules package with a module in the bundle, read from the
// export's source maps (export with --source-maps external), which this script then deletes.
//   node scripts/notices.mjs <exportDir> [--list <file.json>]
// writes <exportDir>/THIRD_PARTY_NOTICES.txt, LICENSE and licenses/ (font OFL texts), and with
// --list also the package directories as JSON (apps/desktop/scripts/licenses.mjs merges them).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(app, '../..');

function mapsUnder(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...mapsUnder(p));
    else if (n.endsWith('.js.map')) out.push(p);
  }
  return out;
}

/** The package root holding a bundled source file, or null for first-party code. */
function pkgRoot(path) {
  // Forward slashes on Windows too, where join() gives backslashes.
  const file = path.replaceAll('\\', '/');
  const i = file.lastIndexOf('/node_modules/');
  if (i < 0) return null;
  const rest = file.slice(i + '/node_modules/'.length).split('/');
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  const dir = join(file.slice(0, i), 'node_modules', name);
  return existsSync(join(dir, 'package.json')) ? realpathSync(dir) : null;
}

/** Package directories bundled into the export; deletes the maps and their sourceMappingURL lines. */
export function collectAndStripMaps(exportDir) {
  const dirs = new Set();
  for (const map of mapsUnder(exportDir)) {
    const m = JSON.parse(readFileSync(map, 'utf8'));
    for (const s of m.sources ?? []) {
      // Metro writes sources relative to its server root (the monorepo), with a leading slash.
      for (const abs of isAbsolute(s) ? [join(repo, s), s] : [resolve(repo, s), resolve(app, s)]) {
        const root = pkgRoot(abs);
        if (root) {
          dirs.add(root);
          break;
        }
      }
    }
    rmSync(map);
    const js = map.slice(0, -'.map'.length);
    if (existsSync(js)) writeFileSync(js, readFileSync(js, 'utf8').replace(/^\/\/# sourceMappingURL=\S+$/m, ''));
  }
  return [...dirs];
}

const readPkg = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

function licenceText(dir) {
  const f = readdirSync(dir).find((n) => /^(licen[cs]e|copying|notice)(\.|-|$)/i.test(n));
  return f ? readFileSync(join(dir, f), 'utf8').trim() : null;
}

/** THIRD_PARTY_NOTICES.txt text for package directories (first-party @meetless/* skipped). */
export function noticesText(dirs) {
  const pkgs = dirs
    .map((dir) => ({ dir, pkg: readPkg(dir) }))
    .filter(({ pkg }) => !String(pkg.name).startsWith('@meetless/'))
    .sort((a, b) => `${a.pkg.name}@${a.pkg.version}`.localeCompare(`${b.pkg.name}@${b.pkg.version}`));
  const seen = new Set();
  const parts = ['Third-party software in Meetless', '', 'Each package below is bundled into the app, with its licence as the package ships it.', ''];
  for (const { dir, pkg } of pkgs) {
    const id = `${pkg.name}@${pkg.version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const licence = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'see package');
    parts.push('='.repeat(72), `${id} (${licence})`, '', licenceText(dir) ?? `Licence: ${licence}. The package ships no licence file.`, '');
  }
  return { text: `${parts.join('\n')}\n`, count: seen.size };
}

/** Writes the notices, Meetless's LICENSE and the font licences into the export. */
export function writeNotices(exportDir, dirs) {
  const { text, count } = noticesText(dirs);
  writeFileSync(join(exportDir, 'THIRD_PARTY_NOTICES.txt'), text);
  copyFileSync(join(repo, 'LICENSE'), join(exportDir, 'LICENSE'));
  mkdirSync(join(exportDir, 'licenses'), { recursive: true });
  copyFileSync(join(app, 'assets/fonts/Geist-OFL.txt'), join(exportDir, 'licenses/Geist-OFL.txt'));
  copyFileSync(join(app, 'assets/fonts/NotoSansSC-LICENSE.txt'), join(exportDir, 'licenses/NotoSansSC-OFL.txt'));
  return count;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const exportDir = resolve(process.argv[2] ?? 'dist');
  const li = process.argv.indexOf('--list');
  const dirs = collectAndStripMaps(exportDir);
  if (dirs.length === 0) throw new Error(`no source maps with packages under ${exportDir}: export with --source-maps external`);
  const n = writeNotices(exportDir, dirs);
  if (li > 0) {
    mkdirSync(dirname(resolve(process.argv[li + 1])), { recursive: true });
    writeFileSync(resolve(process.argv[li + 1]), JSON.stringify(dirs, null, 2));
  }
  console.log(`third-party notices: ${n} packages -> ${exportDir}/THIRD_PARTY_NOTICES.txt`);
}
