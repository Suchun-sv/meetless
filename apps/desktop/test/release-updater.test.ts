import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { UpdateState } from '@meetless/client/bridge';
import { installKind, manifestName, newer, parseManifest, ReleaseUpdater, swapBundle, type ReleaseUpdaterOptions } from '../src/main/release-updater';

/*
 * The updater against a local HTTP server that plays GitHub: a manifest under
 * /latest/download/, the release files under /download/<tag>/, and the API's release notes.
 */

const work = mkdtempSync(join(tmpdir(), 'meetless-updater-test-'));

/** A zip holding Meetless.app with `marker` in its Info.plist (python3's zipfile, like the CI runners have). */
function makeZip(marker: string): Buffer {
  const src = join(work, `src-${marker}`);
  mkdirSync(join(src, 'Meetless.app/Contents/MacOS'), { recursive: true });
  writeFileSync(join(src, 'Meetless.app/Contents/Info.plist'), marker);
  writeFileSync(join(src, 'Meetless.app/Contents/MacOS/Meetless'), '#!/bin/sh\n');
  const zip = join(work, `${marker}.zip`);
  execFileSync('python3', ['-c', 'import shutil,sys; shutil.make_archive(sys.argv[1][:-4], "zip", sys.argv[2], "Meetless.app")', zip, src]);
  return readFileSync(zip);
}

const zip = makeZip('new-0.2.0');
const sha = createHash('sha512').update(zip).digest('base64');

/** What the fake server answers; each test sets what it needs. */
let manifestVersion = '0.2.0';
let manifestSha = sha;
let manifestStatus = 200;
let apiStatus = 200;
let server: Server;
let base: string;
const hits: string[] = [];

function manifest(): string {
  return [
    `version: ${manifestVersion}`,
    'files:',
    `  - url: Meetless-${manifestVersion}-mac-x64.zip`,
    '    sha512: AAAA',
    '    size: 10',
    `  - url: Meetless-${manifestVersion}-mac-arm64.zip`,
    `    sha512: ${manifestSha}`,
    `    size: ${zip.length}`,
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
    if (url === `/releases/download/v${manifestVersion}/Meetless-${manifestVersion}-mac-arm64.zip`) return res.writeHead(200, { 'content-length': zip.length }).end(zip);
    if (url === `/api/releases/tags/v${manifestVersion}`) {
      if (apiStatus !== 200) return res.writeHead(apiStatus).end('{}');
      const body = `## What's Changed\n- Sidebar shows the new version by @Suchun-sv in https://github.com/Suchun-sv/meetless/pull/1\n* Faster sync\n\n**Full Changelog**: https://x`;
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ body }));
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server.close();
  rmSync(work, { recursive: true, force: true });
});

beforeEach(() => {
  manifestVersion = '0.2.0';
  manifestSha = sha;
  manifestStatus = 200;
  apiStatus = 200;
  hits.length = 0;
});

/** An installed Meetless.app (old) in its own Applications dir. */
function installedApp(): { dir: string; bundle: string } {
  const dir = mkdtempSync(join(work, 'Applications-'));
  const bundle = join(dir, 'Meetless.app');
  mkdirSync(join(bundle, 'Contents'), { recursive: true });
  writeFileSync(join(bundle, 'Contents/Info.plist'), 'old-0.1.0');
  return { dir, bundle };
}

const unzip = async (file: string, dir: string) => void execFileSync('unzip', ['-q', file, '-d', dir]);

function updater(over: Partial<ReleaseUpdaterOptions> = {}) {
  const states: UpdateState[] = [];
  let relaunched = 0;
  const u = new ReleaseUpdater({
    currentVersion: '0.1.0',
    platform: 'darwin',
    arch: 'arm64',
    kind: 'mac',
    baseUrl: `${base}/releases`,
    apiUrl: `${base}/api`,
    unzip,
    relaunch: () => void relaunched++,
    onChange: (s) => states.push(s),
    ...over,
  });
  return { u, states, relaunched: () => relaunched };
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
    expect(readFileSync(join(bundle, 'Contents/Info.plist'), 'utf8')).toBe('old-0.1.0');
    expect(readdirSync(dir)).toEqual(['Meetless.app']);
    expect(relaunched()).toBe(0);
    expect(states.at(-1)).toMatchObject({ phase: 'failed', error: 'UPDATE_CHECKSUM' });
  });

  it('downloads the zip for this architecture, swaps the bundle and relaunches', async () => {
    const { dir, bundle } = installedApp();
    const { u, states, relaunched } = updater({ bundlePath: bundle });
    await u.check();
    expect(await u.install()).toEqual({ ok: true });
    expect(readFileSync(join(bundle, 'Contents/Info.plist'), 'utf8')).toBe('new-0.2.0');
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
    expect(readFileSync(join(bundle, 'Contents/Info.plist'), 'utf8')).toBe('old-0.1.0');
    expect(readdirSync(dir)).toEqual(['Meetless.app']);
  });
});
