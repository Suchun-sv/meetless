import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { UpdateState } from '@meetless/client/bridge';
import { installKind, macZipName, manifestName, newer, parseManifest, ReleaseUpdater, swapBundle, type ReleaseUpdaterOptions } from '../src/main/release-updater';
import { checkUnpacked, checkZip, codesignArgs, MAC_REQUIREMENT, VerifyError, zipEntries } from '../src/main/update-verify';

/*
 * The updater against a local HTTP server that plays GitHub: a manifest under
 * /latest/download/, the release files under /download/<tag>/, and the API's release notes.
 */

const work = mkdtempSync(join(tmpdir(), 'meetless-updater-test-'));

/** An Info.plist the way electron-builder writes it (XML). */
const plist = (id: string, version: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n  <key>CFBundleIdentifier</key>\n  <string>${id}</string>\n  <key>CFBundleShortVersionString</key>\n  <string>${version}</string>\n</dict>\n</plist>\n`;

type Entry = { name: string; type?: 'file' | 'dir' | 'link'; data?: string };

/** A zip with exactly these entries (python3's zipfile, like the CI runners have): files, dirs and symlinks with Unix modes. */
function zipOf(entries: Entry[]): Buffer {
  const out = join(work, `z-${Math.random().toString(36).slice(2)}.zip`);
  const py = [
    'import json,sys,zipfile',
    'z=zipfile.ZipFile(sys.argv[1],"w")',
    'for e in json.loads(sys.argv[2]):',
    '  t=e.get("type","file"); i=zipfile.ZipInfo(e["name"]); i.create_system=3',
    '  i.external_attr=((0o120755 if t=="link" else 0o40755 if t=="dir" else 0o100644)<<16)|(0x10 if t=="dir" else 0)',
    '  z.writestr(i,e.get("data",""))',
    'z.close()',
  ].join('\n');
  execFileSync('python3', ['-c', py, out, JSON.stringify(entries)]);
  return readFileSync(out);
}

/** A Meetless.app of `version` (and `id`), with Electron-style internal symlinks, plus any extra entries. */
function appZip(version: string, opts: { id?: string; extra?: Entry[] } = {}): Buffer {
  const fw = 'Meetless.app/Contents/Frameworks/Electron Framework.framework';
  return zipOf([
    { name: 'Meetless.app/', type: 'dir' },
    { name: 'Meetless.app/Contents/', type: 'dir' },
    { name: 'Meetless.app/Contents/Info.plist', data: plist(opts.id ?? 'app.meetless.desktop', version) },
    { name: 'Meetless.app/Contents/MacOS/Meetless', data: '#!/bin/sh\n' },
    { name: `${fw}/Versions/A/Electron Framework`, data: 'fw' },
    { name: `${fw}/Versions/Current`, type: 'link', data: 'A' },
    { name: `${fw}/Electron Framework`, type: 'link', data: 'Versions/Current/Electron Framework' },
    ...(opts.extra ?? []),
  ]);
}

const sha512 = (b: Buffer) => createHash('sha512').update(b).digest('base64');
const goodZip = appZip('0.2.0');
const sha = sha512(goodZip);

/** What the fake server answers; each test sets what it needs. */
let zip = goodZip;
let manifestVersion = '0.2.0';
let manifestSha = sha;
let manifestSize: number | null = null;
let manifestStatus = 200;
let apiStatus = 200;
let zipName = (v: string) => `Meetless-${v}-mac-arm64.zip`;
/** Where the zip URL redirects to, if anywhere. */
let redirectTo: string | null = null;
let server: Server;
let base: string;
/** Another origin: a redirect there must be refused. */
let evil: Server;
let evilBase: string;
const hits: string[] = [];

/** Serve `buf` as the release zip, with a matching manifest. */
function serve(buf: Buffer): void {
  zip = buf;
  manifestSha = sha512(buf);
}

function manifest(): string {
  return [
    `version: ${manifestVersion}`,
    'files:',
    `  - url: Meetless-${manifestVersion}-mac-x64.zip`,
    '    sha512: AAAA',
    '    size: 10',
    `  - url: ${zipName(manifestVersion)}`,
    `    sha512: ${manifestSha}`,
    `    size: ${manifestSize ?? zip.length}`,
    `  - url: Meetless-${manifestVersion}-mac-arm64.dmg`,
    '    sha512: BBBB',
    '    size: 20',
    `path: Meetless-${manifestVersion}-mac-arm64.zip`,
    `sha512: ${manifestSha}`,
    "releaseDate: '2026-11-25T10:00:00.000Z'",
    '',
  ].join('\n');
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '';
    hits.push(url);
    if (url === '/releases/latest/download/latest-mac.yml' || url === '/releases/latest/download/latest.yml' || url === `/releases/download/v${manifestVersion}/latest-mac.yml`) {
      if (manifestStatus !== 200) return res.writeHead(manifestStatus).end();
      return res.writeHead(200, { 'content-type': 'text/yaml' }).end(manifest());
    }
    if (url === `/releases/download/v${manifestVersion}/${encodeURIComponent(zipName(manifestVersion))}`) {
      if (redirectTo) return res.writeHead(302, { location: redirectTo }).end();
      return res.writeHead(200, { 'content-length': zip.length }).end(zip);
    }
    if (url === '/cdn/zip') return res.writeHead(200, { 'content-length': zip.length }).end(zip);
    if (url === `/api/releases/tags/v${manifestVersion}`) {
      if (apiStatus !== 200) return res.writeHead(apiStatus).end('{}');
      const body = `## What's Changed\n- Sidebar shows the new version by @Suchun-sv in https://github.com/Suchun-sv/meetless/pull/1\n* Faster sync\n\n**Full Changelog**: https://x`;
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ body }));
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  evil = createServer((req, res) => {
    hits.push(`evil:${req.url}`);
    res.writeHead(200, { 'content-length': zip.length }).end(zip);
  });
  await new Promise<void>((r) => evil.listen(0, '127.0.0.1', r));
  evilBase = `http://127.0.0.1:${(evil.address() as { port: number }).port}`;
});

afterAll(() => {
  server.close();
  evil.close();
  rmSync(work, { recursive: true, force: true });
});

beforeEach(() => {
  zip = goodZip;
  manifestVersion = '0.2.0';
  manifestSha = sha;
  manifestSize = null;
  zipName = (v) => `Meetless-${v}-mac-arm64.zip`;
  redirectTo = null;
  manifestStatus = 200;
  apiStatus = 200;
  hits.length = 0;
});

/** An installed Meetless.app (old) in its own Applications dir. */
function installedApp(): { dir: string; bundle: string } {
  const dir = mkdtempSync(join(work, 'Applications-'));
  const bundle = join(dir, 'Meetless.app');
  mkdirSync(join(bundle, 'Contents'), { recursive: true });
  writeFileSync(join(bundle, 'Contents/Info.plist'), plist('app.meetless.desktop', '0.1.0'));
  return { dir, bundle };
}

const OLD_PLIST = plist('app.meetless.desktop', '0.1.0');

const unzip = async (file: string, dir: string) => void execFileSync('unzip', ['-q', file, '-d', dir]);

function updater(over: Partial<ReleaseUpdaterOptions> = {}) {
  const states: UpdateState[] = [];
  const verified: string[] = [];
  let relaunched = 0;
  const u = new ReleaseUpdater({
    currentVersion: '0.1.0',
    platform: 'darwin',
    arch: 'arm64',
    kind: 'mac',
    baseUrl: `${base}/releases`,
    apiUrl: `${base}/api`,
    unzip,
    // codesign needs macOS: the fake accepts and records what it was asked to check.
    verifySignature: async (app) => void verified.push(app),
    relaunch: () => void relaunched++,
    onChange: (s) => states.push(s),
    ...over,
  });
  return { u, states, verified, relaunched: () => relaunched };
}

describe('newer', () => {
  it('compares x.y.z numerically, with or without a v, and a pre-release before its release', () => {
    expect(newer('0.2.0', '0.1.0')).toBe(true);
    expect(newer('v0.10.0', '0.9.9')).toBe(true);
    expect(newer('1.0.0', '1.0.0')).toBe(false);
    expect(newer('0.1.0', '0.2.0')).toBe(false);
    expect(newer('1.0.0', '1.0.0-beta.1')).toBe(true);
    expect(newer('1.0.0-beta.1', '1.0.0')).toBe(false);
  });

  it('anything that is not strict semver is never newer', () => {
    for (const v of ['9.9.9/../../../../x', '9.9', '9.9.9.9', '01.0.0', '9.9.9-', '9.9.9+build', '', 'latest']) expect(newer(v, '0.1.0')).toBe(false);
    expect(newer('0.2.0', 'junk')).toBe(false);
  });
});

describe('manifest', () => {
  it('names the manifest electron-builder writes for each platform', () => {
    expect([manifestName('darwin'), manifestName('win32'), manifestName('linux')]).toEqual(['latest-mac.yml', 'latest.yml', 'latest-linux.yml']);
  });

  it('reads the version and the files with their SHA-512 and size', () => {
    const m = parseManifest(manifest());
    expect(m.version).toBe('0.2.0');
    expect(m.files.map((f) => f.url)).toEqual(['Meetless-0.2.0-mac-x64.zip', 'Meetless-0.2.0-mac-arm64.zip', 'Meetless-0.2.0-mac-arm64.dmg']);
    expect(m.files[1]).toEqual({ url: 'Meetless-0.2.0-mac-arm64.zip', sha512: sha, size: zip.length });
  });
});

describe('installKind', () => {
  it('macOS swaps itself, Windows and the AppImage use electron-updater, everything else is a download link', () => {
    expect(installKind({ packaged: true, platform: 'darwin' })).toBe('mac');
    expect(installKind({ packaged: true, platform: 'win32' })).toBe('electron-updater');
    expect(installKind({ packaged: true, platform: 'linux', appImage: '/home/u/Meetless.AppImage' })).toBe('electron-updater');
    expect(installKind({ packaged: true, platform: 'linux' })).toBe('manual');
    expect(installKind({ packaged: false, platform: 'darwin' })).toBe('manual');
  });
});

describe('check', () => {
  it('offers a newer release with its notes from the API', async () => {
    const { u, states } = updater();
    const s = await u.check();
    expect(s.available).toEqual({ version: '0.2.0', notes: ['Sidebar shows the new version', 'Faster sync'] });
    expect(s).toMatchObject({ current: '0.1.0', install: 'self', phase: 'idle', error: null });
    expect(states.at(-1)).toEqual(s);
    expect(hits).toContain('/releases/latest/download/latest-mac.yml');
  });

  it('ignores an older or equal release', async () => {
    manifestVersion = '0.1.0';
    expect((await updater().u.check()).available).toBeNull();
    expect((await updater({ currentVersion: '0.3.0' }).u.check()).available).toBeNull();
  });

  it('still offers the release when the API does not answer, with a plain note', async () => {
    apiStatus = 403;
    expect((await updater().u.check()).available).toEqual({ version: '0.2.0', notes: ['Meetless 0.2.0'] });
  });

  it('no release yet (404) or no network: nothing offered, nothing thrown', async () => {
    manifestStatus = 404;
    expect((await updater().u.check()).available).toBeNull();
    expect((await updater({ baseUrl: 'http://127.0.0.1:1/releases' }).u.check()).available).toBeNull();
  });

  it('a disabled updater (a dev run) never touches the network', async () => {
    const s = await updater({ enabled: false }).u.check();
    expect(s.available).toBeNull();
    expect(hits).toEqual([]);
  });

  it('another install type offers a download link instead of installing', async () => {
    const s = await updater({ kind: 'manual' }).u.check();
    expect(s.install).toBe('manual');
    expect(s.releasesUrl).toBe('https://github.com/Suchun-sv/meetless/releases');
  });
});

describe('install on macOS', () => {
  it('refuses a download whose SHA-512 does not match latest-mac.yml and leaves the app alone', async () => {
    manifestSha = createHash('sha512').update('something else').digest('base64');
    const { dir, bundle } = installedApp();
    const { u, states, relaunched } = updater({ bundlePath: bundle });
    await u.check();
    expect(await u.install()).toEqual({ ok: false, code: 'UPDATE_CHECKSUM' });
    expect(readFileSync(join(bundle, 'Contents/Info.plist'), 'utf8')).toBe(OLD_PLIST);
    expect(readdirSync(dir)).toEqual(['Meetless.app']);
    expect(relaunched()).toBe(0);
    expect(states.at(-1)).toMatchObject({ phase: 'failed', error: 'UPDATE_CHECKSUM' });
  });

  it('downloads the zip for this architecture, swaps the bundle and relaunches', async () => {
    const { dir, bundle } = installedApp();
    const { u, states, relaunched } = updater({ bundlePath: bundle });
    await u.check();
    expect(await u.install()).toEqual({ ok: true });
    expect(readFileSync(join(bundle, 'Contents/Info.plist'), 'utf8')).toBe(plist('app.meetless.desktop', '0.2.0'));
    expect(existsSync(join(bundle, 'Contents/MacOS/Meetless'))).toBe(true);
    expect(readdirSync(dir)).toEqual(['Meetless.app']); // no staging dir, no old copy left
    expect(relaunched()).toBe(1);
    expect(hits).toContain('/releases/download/v0.2.0/Meetless-0.2.0-mac-arm64.zip');
    const phases = states.map((s) => s.phase);
    expect(phases).toEqual(expect.arrayContaining(['downloading', 'installing', 'restarting']));
    expect(phases.indexOf('downloading')).toBeLessThan(phases.indexOf('installing'));
    expect(states.filter((s) => s.phase === 'downloading').at(-1)?.percent).toBe(100);
  });

  it('nothing newer: nothing to install', async () => {
    manifestVersion = '0.1.0';
    const { u } = updater({ bundlePath: installedApp().bundle });
    expect(await u.install()).toEqual({ ok: false, code: 'UPDATE_NONE' });
  });

  it('a bundle path that is not an .app is refused', async () => {
    const { u } = updater({ bundlePath: join(work, 'not-an-app') });
    expect(await u.install()).toEqual({ ok: false, code: 'UPDATE_FAILED' });
  });

  it('a manual install type is never installed in the app', async () => {
    const { u } = updater({ kind: 'manual' });
    expect(await u.install()).toEqual({ ok: false, code: 'UPDATE_MANUAL' });
  });
});

describe('install on macOS: what a release must prove before it replaces the app', () => {
  /** Install and expect a refusal with `code`; the installed app is untouched and nothing is left beside it. */
  async function refused(code: string, over: Partial<ReleaseUpdaterOptions> = {}) {
    const { dir, bundle } = installedApp();
    const { u, states, relaunched, verified } = updater({ bundlePath: bundle, ...over });
    expect(await u.install()).toEqual({ ok: false, code });
    expect(readFileSync(join(bundle, 'Contents/Info.plist'), 'utf8')).toBe(OLD_PLIST);
    expect(readdirSync(dir)).toEqual(['Meetless.app']);
    expect(relaunched()).toBe(0);
    expect(states.at(-1)).toMatchObject({ phase: 'failed', error: code });
    return { verified };
  }

  it('codesigns the unpacked bundle before the swap, and a bundle that fails codesign is refused', async () => {
    const { bundle } = installedApp();
    const { u, verified } = updater({ bundlePath: bundle });
    expect(await u.install()).toEqual({ ok: true });
    expect(verified).toHaveLength(1);
    expect(verified[0]).toMatch(/\.Meetless-update-[^/]+\/app\/Meetless\.app$/);
    await refused('UPDATE_UNTRUSTED', {
      verifySignature: async () => {
        throw new VerifyError('codesign: invalid signature');
      },
    });
  });

  it('a codesign that cannot run refuses the update rather than skipping the check', async () => {
    // The real check: on this Linux test host codesign does not exist, so it must fail closed.
    await refused('UPDATE_UNTRUSTED', { verifySignature: undefined });
  });

  it('the bundle must be the version the manifest names, newer than this one, with the Meetless bundle id', async () => {
    serve(appZip('0.1.5'));
    await refused('UPDATE_UNTRUSTED'); // an older genuine build replayed under 0.2.0
    serve(appZip('0.2.0', { id: 'com.evil.app' }));
    await refused('UPDATE_UNTRUSTED');
    manifestVersion = '0.2.0-rc.1';
    serve(appZip('0.2.0-rc.1'));
    zipName = (v) => `Meetless-${v}-mac-arm64.zip`;
    expect(await updater({ bundlePath: installedApp().bundle }).u.install()).toEqual({ ok: true });
  });

  it('a manifest version that is not semver is refused, and never becomes a URL path', async () => {
    manifestVersion = '9.9.9/../../../../../attacker/repo/releases/download/v1';
    expect((await updater().u.check()).available).toBeNull();
    await refused('UPDATE_UNTRUSTED');
    expect(hits.filter((h) => h.includes('attacker'))).toEqual([]);
  });

  it('only the exact Meetless-<version>-mac-<arch>.zip is taken', async () => {
    zipName = () => 'evil-arm64.zip';
    await refused('UPDATE_FAILED');
    zipName = (v) => `../Meetless-${v}-mac-arm64.zip`;
    await refused('UPDATE_FAILED');
    expect(macZipName('0.2.0', 'arm64')).toBe('Meetless-0.2.0-mac-arm64.zip');
    expect(macZipName('0.2.0', 'ia32')).toBeNull();
    expect(macZipName('0.2/../x', 'arm64')).toBeNull();
  });

  it('a zip with a ../ entry is refused before anything is unpacked', async () => {
    let unpacked = 0;
    serve(appZip('0.2.0', { extra: [{ name: 'Meetless.app/../../escaped.txt', data: 'x' }] }));
    await refused('UPDATE_UNTRUSTED', { unzip: async (f, d) => void (unpacked++, await unzip(f, d)) });
    expect(unpacked).toBe(0);
    serve(appZip('0.2.0', { extra: [{ name: '/tmp/abs.txt', data: 'x' }] }));
    await refused('UPDATE_UNTRUSTED');
  });

  it('a zip that writes through a symlink entry is refused before anything is unpacked', async () => {
    serve(appZip('0.2.0', { extra: [{ name: 'Meetless.app/Contents/agents', type: 'link', data: '../../../Library/LaunchAgents' }, { name: 'Meetless.app/Contents/agents/evil.plist', data: 'x' }] }));
    await refused('UPDATE_UNTRUSTED');
  });

  it('a top-level Meetless.app that is a symlink is refused', async () => {
    serve(zipOf([{ name: 'Meetless.app', type: 'link', data: join(work, 'elsewhere.app') }]));
    await refused('UPDATE_UNTRUSTED');
  });

  it('a symlink inside the bundle that points outside it is refused', async () => {
    serve(appZip('0.2.0', { extra: [{ name: 'Meetless.app/Contents/Resources/out', type: 'link', data: '../../../outside' }] }));
    await refused('UPDATE_UNTRUSTED');
    serve(appZip('0.2.0', { extra: [{ name: 'Meetless.app/Contents/Resources/abs', type: 'link', data: '/etc' }] }));
    await refused('UPDATE_UNTRUSTED');
  });

  it('anything beside Meetless.app in the zip is refused', async () => {
    serve(appZip('0.2.0', { extra: [{ name: 'Other.app/Contents/x', data: 'x' }] }));
    await refused('UPDATE_UNTRUSTED');
  });

  it('a download larger than the manifest says is cut off; a missing or huge size is refused', async () => {
    manifestSize = 100;
    await refused('UPDATE_DOWNLOAD');
    manifestSize = 0;
    await refused('UPDATE_DOWNLOAD');
    manifestSize = 2 * 1024 ** 3;
    await refused('UPDATE_DOWNLOAD');
  });

  it('redirects are followed only to the release CDNs over https (or the same origin in a test)', async () => {
    redirectTo = `${base}/cdn/zip`;
    expect(await updater({ bundlePath: installedApp().bundle }).u.install()).toEqual({ ok: true });
    redirectTo = `${evilBase}/zip`;
    await refused('UPDATE_DOWNLOAD');
    expect(hits.filter((h) => h.startsWith('evil:'))).toEqual([]);
  });
});

describe('update-verify', () => {
  it('pins codesign to the Meetless identifier and certificate', () => {
    expect(MAC_REQUIREMENT).toMatch(/^identifier "app\.meetless\.desktop" and certificate leaf = H"[0-9a-f]{40}"$/);
    expect(codesignArgs('/x/Meetless.app')).toEqual(['--verify', '--deep', '--strict', '-R', `=${MAC_REQUIREMENT}`, '/x/Meetless.app']);
  });

  it('reads entries, Unix modes and sizes from the central directory', () => {
    const f = join(work, 'entries.zip');
    writeFileSync(f, goodZip);
    const e = zipEntries(f);
    expect(e.map((x) => x.name)).toContain('Meetless.app/Contents/Info.plist');
    expect(e.find((x) => x.name.endsWith('Versions/Current'))?.mode).toBe(0o120755);
    expect(() => checkZip(e)).not.toThrow();
    writeFileSync(f, 'not a zip at all');
    expect(() => zipEntries(f)).toThrow(/not a zip/);
  });

  it('checkZip refuses duplicates, NUL and backslashes, and special files', () => {
    const ok = { name: 'Meetless.app/a', mode: 0o100644, size: 1 };
    expect(() => checkZip([ok, ok])).toThrow(/duplicate/);
    expect(() => checkZip([{ ...ok, name: 'Meetless.app\\..\\x' }])).toThrow();
    expect(() => checkZip([{ ...ok, name: 'Meetless.app/a\0' }])).toThrow();
    expect(() => checkZip([{ ...ok, mode: 0o020644 }])).toThrow(/special/);
    expect(() => checkZip([{ ...ok, mode: 0o104755 }])).toThrow(/setuid/);
  });

  it('checkUnpacked wants exactly one real Meetless.app directory', () => {
    const d = mkdtempSync(join(work, 'unpacked-'));
    expect(() => checkUnpacked(d)).toThrow(/expected only/);
    mkdirSync(join(d, 'Meetless.app'));
    expect(checkUnpacked(d)).toBe(join(d, 'Meetless.app'));
  });
});

describe('install with electron-updater (Windows, AppImage)', () => {
  it('hands over to electron-updater and reports its progress', async () => {
    const calls: number[] = [];
    const { u, states, relaunched } = updater({
      platform: 'win32',
      kind: 'electron-updater',
      electronUpdater: async (progress) => {
        for (const p of [10, 55, 100]) progress(p);
        calls.push(1);
      },
    });
    expect(await u.install()).toEqual({ ok: true });
    expect(hits).toContain('/releases/latest/download/latest.yml');
    expect(calls).toEqual([1]);
    expect(states.map((s) => s.percent)).toEqual(expect.arrayContaining([10, 55, 100]));
    expect(states.at(-1)?.phase).toBe('restarting');
    expect(relaunched()).toBe(0); // electron-updater's quitAndInstall restarts the app itself
  });

  it('an electron-updater failure is reported, not thrown', async () => {
    const { u, states } = updater({ platform: 'win32', kind: 'electron-updater', electronUpdater: async () => Promise.reject(new Error('net')) });
    expect(await u.install()).toEqual({ ok: false, code: 'UPDATE_FAILED' });
    expect(states.at(-1)).toMatchObject({ phase: 'failed', error: 'UPDATE_FAILED' });
  });
});

describe('swapBundle', () => {
  it('puts the fresh bundle in place of the old one and removes the old one', () => {
    const { dir, bundle } = installedApp();
    const fresh = join(dir, '.Meetless-update-x', 'Meetless.app');
    mkdirSync(join(fresh, 'Contents'), { recursive: true });
    writeFileSync(join(fresh, 'Contents/Info.plist'), 'fresh');
    swapBundle(bundle, fresh);
    expect(readFileSync(join(bundle, 'Contents/Info.plist'), 'utf8')).toBe('fresh');
    expect(readdirSync(dir).sort()).toEqual(['.Meetless-update-x', 'Meetless.app']);
  });

  it('puts the old bundle back when the fresh one cannot be moved in', () => {
    const { dir, bundle } = installedApp();
    expect(() => swapBundle(bundle, join(dir, 'missing.app'))).toThrow();
    expect(readFileSync(join(bundle, 'Contents/Info.plist'), 'utf8')).toBe(OLD_PLIST);
    expect(readdirSync(dir)).toEqual(['Meetless.app']);
  });
});
