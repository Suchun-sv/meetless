// electron-builder config for macOS (arm64 + x64, dmg + zip), Windows (NSIS) and Linux (AppImage).
// The release workflow (.github/workflows/release.yml, adapted from Gleeok's) builds all three on
// GitHub's runners and publishes them with latest-mac.yml / latest.yml / latest-linux.yml, which
// the in-app updater reads (src/main/release-updater.ts, docs/RELEASE.md).
// The app is staged into release/app first (scripts/stage-app.mjs): main, preload and
// renderer are fully bundled, so the packaged app needs no node_modules at all.
// macOS signing happens in scripts/sign-mac.cjs (afterPack): with MAC_SIGN_IDENTITY ("Meetless
// Self-Signed" on the release runner) or ad hoc without one. Not notarized; see docs/MACOS.md.
const { rm } = require('node:fs/promises');
const { join } = require('node:path');
const pkg = require('./package.json');
const signMac = require('./scripts/sign-mac.cjs');

/**
 * Electron fuses, flipped in afterPack so the macOS signature that follows covers them
 * (electron-builder's own `electronFuses` would flip them after afterPack and break it).
 * - No ELECTRON_RUN_AS_NODE, NODE_OPTIONS or --inspect: the signed binary cannot be used as a
 *   plain Node runtime or be attached to.
 * - The app loads only from app.asar.
 * Left at Electron's defaults: grantFileProtocolExtraPrivileges (the renderer is a Vite module
 * bundle loaded from file://, which needs it) and embedded asar integrity validation (not yet
 * tried on a real Mac or Windows build).
 */
const FUSES = {
  runAsNode: false,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  onlyLoadAppFromAsar: true,
};

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'app.meetless.desktop',
  productName: 'Meetless',
  copyright: 'Meetless',
  electronVersion: pkg.devDependencies.electron,
  directories: { app: 'release/app', output: 'release/dist', buildResources: 'build' },
  files: ['package.json', 'dist/**/*', '!**/*.map'],
  // LICENSE, THIRD_PARTY_NOTICES.txt and the font OFL texts (scripts/licenses.mjs), in <resources>/licenses.
  extraResources: [{ from: 'release/licenses', to: 'licenses' }],
  asar: true,
  // Returning false tells electron-builder that node_modules are handled outside it. Without this
  // it falls back to apps/desktop and copies its dependencies (react, ws, workspace sources) into
  // the asar, although everything is already bundled. There are no native modules to rebuild.
  beforeBuild: async () => false,
  // Electron's default_app.asar (the "drop an app here" shell) is never used once app.asar exists.
  // afterPack runs before the zip / dmg are made, so the signature covers the final bundle.
  afterPack: async (ctx) => {
    await ctx.packager.addElectronFuses(ctx, await ctx.packager.generateFuseConfig(FUSES));
    if (ctx.electronPlatformName !== 'darwin') return;
    const app = join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
    await rm(join(app, 'Contents/Resources/default_app.asar'), { force: true });
    signMac(app);
  },
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  // Where the updater looks (app-update.yml for electron-updater on Windows and the AppImage).
  // The workflow uploads to the tag's draft release; local builds pass --publish never.
  publish: [{ provider: 'github', owner: 'Suchun-sv', repo: 'meetless', releaseType: 'draft' }],
  // A local build reuses the Electron pnpm already downloaded for this exact version instead of
  // downloading a second copy (disk on the target Mac is tight). CI builds other architectures
  // (x64 on an arm64 Mac runner), so it lets electron-builder download each one.
  electronDist: process.env.CI || process.platform === 'win32' ? undefined : 'node_modules/electron/dist',
  // Stable names: the macOS updater picks the zip by its "-<arch>.zip" ending.
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  mac: {
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    category: 'public.app-category.productivity',
    // null: electron-builder does not sign; scripts/sign-mac.cjs does (it has no Apple identity to use).
    identity: null,
    // Hardened runtime is only needed for notarization. With a self-signed or ad-hoc signature
    // it would make library validation reject Electron's frameworks.
    hardenedRuntime: false,
    gatekeeperAssess: false,
    notarize: false,
    // UI languages the product ships (PRD: zh-CN + en). Drops the other Chromium locales.
    electronLanguages: ['en', 'zh_CN'],
    darkModeSupport: true,
    extendInfo: {
      MeetlessBuildChannel: 'unsigned-dev',
      MeetlessBuildNote: 'Not notarized: self-signed (release) or ad-hoc signed (local build).',
    },
  },
  dmg: { sign: false, writeUpdateInfo: false },
  win: { target: [{ target: 'nsis', arch: ['x64'] }] },
  nsis: { oneClick: true, perMachine: false, artifactName: '${productName}-${version}-windows-${arch}-setup.${ext}' },
  linux: {
    target: [{ target: 'AppImage', arch: ['x64'] }],
    category: 'Office',
    executableName: 'meetless',
    maintainer: 'Meetless',
  },
};
