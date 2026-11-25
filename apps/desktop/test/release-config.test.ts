import { createRequire } from 'node:module';
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
