import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
// @ts-expect-error plain .mjs helper shared with scripts/stage-app.mjs
import { thirdPartyNotices } from '../scripts/licenses.mjs';
import { describe, expect, it } from 'vitest';

/** The electron-builder config the release workflow uses, and the macOS signing hook. */
const require = createRequire(import.meta.url);
const config = require('../electron-builder.config.cjs');
const { signArgs } = require('../scripts/sign-mac.cjs') as { signArgs: (app: string, env?: Record<string, string>) => string[] };

describe('electron-builder config', () => {
  it('builds macOS (arm64 + x64, dmg + zip), Windows NSIS and the Linux AppImage', () => {
    expect(config.mac.target).toEqual([
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ]);
    expect(config.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }]);
    expect(config.linux.target).toEqual([{ target: 'AppImage', arch: ['x64'] }]);
  });

  it('publishes to the GitHub releases the updater reads, and names zips by their architecture', () => {
    expect(config.publish).toEqual([{ provider: 'github', owner: 'Suchun-sv', repo: 'meetless', releaseType: 'draft' }]);
    // release-updater.ts picks the macOS zip by its "-<arch>.zip" ending.
    expect(config.artifactName).toMatch(/-\$\{arch\}\.\$\{ext\}$/);
  });

  it('leaves macOS signing to the afterPack hook', () => {
    expect(config.mac.identity).toBeNull();
    expect(config.mac.notarize).toBe(false);
  });
});

describe('sign-mac', () => {
  it('signs ad hoc without an identity (local builds)', () => {
    expect(signArgs('/x/Meetless.app', {})).toEqual(['--force', '--deep', '--sign', '-', '/x/Meetless.app']);
  });

  it('signs with the release identity from its keychain', () => {
    expect(signArgs('/x/Meetless.app', { MAC_SIGN_IDENTITY: 'Meetless Self-Signed', MAC_SIGN_KEYCHAIN: '/tmp/k.keychain-db' })).toEqual([
      '--force',
      '--deep',
      '--sign',
      'Meetless Self-Signed',
      '--keychain',
      '/tmp/k.keychain-db',
      '/x/Meetless.app',
    ]);
  });
});

describe('release workflow', () => {
  const yml = readFileSync(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8');

  it('is read-only by default; only draft and publish may write', () => {
    expect(yml).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(yml.match(/contents: write/g)).toHaveLength(2);
    expect(yml).toMatch(/^concurrency:\n {2}group: release\n {2}cancel-in-progress: false$/m);
  });

  it('pins every action by commit SHA and keeps no git credentials', () => {
    const uses = [...yml.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    expect(yml).toMatch(/persist-credentials: false/);
  });

  it('builds never publish; no token reaches a build', () => {
    expect(yml).not.toMatch(/--publish (always|"\$)/);
    const build = yml.slice(yml.indexOf('\n  build:'), yml.indexOf('\n  publish:'));
    expect(build).not.toMatch(/GH_TOKEN|GITHUB_TOKEN/);
    expect(build.match(/--publish never/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it('the signing secrets appear only in the macOS packaging step', () => {
    const steps = yml.split(/\n {6}- /);
    const withSecret = steps.filter((s) => /secrets\.MAC_CERT_(P12|PASSWORD)/.test(s));
    expect(withSecret).toHaveLength(1);
    expect(withSecret[0]).toMatch(/^name: Package and sign \(macOS\)/);
    expect(withSecret[0]).toMatch(/security import .* -x /);
    expect(withSecret[0]).toMatch(/security delete-keychain/);
    expect(withSecret[0]).toMatch(/openssl rand/);
  });
});

describe('licences in the app', () => {
  it('ships release/licenses beside the asar', () => {
    expect(config.extraResources).toEqual([{ from: 'release/licenses', to: 'licenses' }]);
  });

  it('the notices cover the bundled packages with their licence texts', () => {
    const text: string = thirdPartyNotices(new URL('..', import.meta.url).pathname);
    for (const p of ['react@', 'react-dom@', 'electron-updater@', 'ws@', 'immer@']) expect(text).toContain(p);
    expect(text).not.toMatch(/^@meetless\//m);
    expect(text).toMatch(/Permission is hereby granted/);
  });

  it('the app package declares the PolyForm Noncommercial licence', () => {
    expect(require('../package.json').license).toBe('PolyForm-Noncommercial-1.0.0');
  });
});
