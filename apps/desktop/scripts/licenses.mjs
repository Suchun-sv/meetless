// The licence files that travel inside the packaged app (electron-builder extraResources, in
// <resources>/licenses): Meetless's own LICENSE (PolyForm Noncommercial 1.0.0 with its Required
// Notice), THIRD_PARTY_NOTICES.txt for every package bundled into main, preload or the renderer,
// and the SIL OFL texts of the bundled fonts. Electron's and Chromium's own licence files are added
// by electron-builder itself.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** The package root holding a bundled file, from an esbuild metafile input path. */
function pkgRootOfInput(desktop, input) {
  const abs = resolve(desktop, input);
  const i = abs.lastIndexOf('/node_modules/');
  if (i < 0) return null;
  const rest = abs.slice(i + '/node_modules/'.length).split('/');
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  return join(abs.slice(0, i), 'node_modules', name);
}

/** Node's lookup: `<dir>/node_modules/<name>`, walking up. */
function findPkg(name, fromDir) {
  for (let d = fromDir; ; d = dirname(d)) {
    const c = join(d, 'node_modules', name);
    if (existsSync(join(c, 'package.json'))) return realpathSync(c);
    if (dirname(d) === d) return null;
  }
}

const readPkg = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

/** Every package the app ships: the main and preload bundles' inputs, plus the runtime dependency tree (the renderer). */
export function bundledPackages(desktop) {
  const dirs = new Set();
  for (const name of ['main', 'preload']) {
    const meta = join(desktop, `dist/meta/${name}.json`);
    if (!existsSync(meta)) continue;
    for (const input of Object.keys(JSON.parse(readFileSync(meta, 'utf8')).inputs)) {
      const root = pkgRootOfInput(desktop, input);
      if (root && existsSync(join(root, 'package.json'))) dirs.add(realpathSync(root));
    }
  }
  const seen = new Set();
  const walk = (dir) => {
    if (seen.has(dir)) return;
    seen.add(dir);
    const pkg = readPkg(dir);
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      const d = findPkg(dep, dir);
      if (d) walk(d);
    }
    if (!String(pkg.name).startsWith('@meetless/') && dir !== realpathSync(desktop)) dirs.add(dir);
  };
  walk(realpathSync(desktop));
  for (const d of [...dirs]) walk(d);
  return [...dirs]
    .map((dir) => ({ dir, pkg: readPkg(dir) }))
    .filter(({ pkg }) => !String(pkg.name).startsWith('@meetless/') && pkg.name !== 'electron')
    .sort((a, b) => `${a.pkg.name}@${a.pkg.version}`.localeCompare(`${b.pkg.name}@${b.pkg.version}`));
}

function licenceText(dir) {
  const f = readdirSync(dir).find((n) => /^(licen[cs]e|copying|notice)(\.|-|$)/i.test(n));
  return f ? readFileSync(join(dir, f), 'utf8').trim() : null;
}

export function thirdPartyNotices(desktop) {
  const seen = new Set();
  const parts = ['Third-party software in Meetless', '', 'Each package below is bundled into the app, with its licence as the package ships it.', ''];
  for (const { dir, pkg } of bundledPackages(desktop)) {
    const id = `${pkg.name}@${pkg.version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const licence = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'see package');
    parts.push('='.repeat(72), `${id} (${licence})`, '', licenceText(dir) ?? `Licence: ${licence}. The package ships no licence file.`, '');
  }
  return `${parts.join('\n')}\n`;
}

/** Writes the licence folder electron-builder ships. */
export function stageLicenses(desktop, out) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'fonts'), { recursive: true });
  copyFileSync(resolve(desktop, '../../LICENSE'), join(out, 'LICENSE'));
  writeFileSync(join(out, 'THIRD_PARTY_NOTICES.txt'), thirdPartyNotices(desktop));
  const fonts = resolve(desktop, 'src/renderer/assets/fonts');
  copyFileSync(join(fonts, 'geist/OFL.txt'), join(out, 'fonts/Geist-OFL.txt'));
  copyFileSync(join(fonts, 'noto-sans-sc/LICENSE'), join(out, 'fonts/NotoSansSC-OFL.txt'));
}
