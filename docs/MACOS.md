# Meetless on macOS (arm64): unsigned local build

Status as of 2026-11-24. This build is **unsigned** (ad-hoc signed, not notarized) and is for
local testing only. Covers PRD §4.1 (installable desktop client), §11.3 (install/uninstall
notes, version info) and §14 A01/A18. The stage results are in §6.

## 1. Target machine (confirmed)

| | |
|---|---|
| Machine | `<mac>` (Tailscale name; local host name `<mac>`), the user's own MacBook |
| Hardware | Apple M3 Pro, arm64, 36 GB RAM |
| OS | macOS 27.0.1 (build 26A434) |
| Toolchain used | Xcode Command Line Tools, git, Node v24.13.0 (`/usr/local/bin/node`), pnpm 12.23.0 via `npx -y pnpm@12.23.0` (the Mac's global pnpm is 11.1.2 and was not changed) |
| Signing | no code-signing identity installed (`security find-identity -v -p codesigning` reports 0 valid identities) |
| Disk | about 38 GiB free of 926 GiB (96% used), so keep build output small |

## 2. Packaging choice: electron-builder

electron-builder 26.18.0 (`apps/desktop/electron-builder.config.cjs`) was chosen over Electron Forge because:

- one declarative config produces both `dmg` and `zip` for `arm64` only;
- it supports ad-hoc signing directly (`identity: "-"`), and `hardenedRuntime`/`notarize` can be switched off;
- it works in this pnpm workspace without the `node-linker=hoisted` setting that Forge needs, because
  the app is staged into its own directory (below).

How the app is assembled:

1. `scripts/build-main.mjs` bundles main and preload with esbuild (CommonJS), and `vite build`
   builds the renderer. Everything the app needs at runtime is now in `dist/`: `@meetless/client`,
   `@meetless/core`, `@meetless/i18n` (including the zh-CN/en JSON), `ws` and `immer`.
   `node:sqlite` is built into Electron 45's Node 24, so there are **no native modules** to rebuild.
2. `scripts/stage-app.mjs` copies `dist/` to `release/app/` and writes a `package.json` there with no
   dependencies (name `meetless`, productName `Meetless`, version taken from `apps/desktop/package.json`).
   The script fails if the main or preload bundle still `require`s a package that is not built into
   Electron/Node. (`bufferutil` and `utf-8-validate` are optional `ws` accelerators that ws loads inside
   try/catch.)
3. electron-builder packs `release/app` into `app.asar`. `beforeBuild` returns `false`, so it does not
   pull `apps/desktop` dependencies into the asar. `afterPack` deletes Electron's unused
   `default_app.asar` before signing. The result is an asar with 11 entries: `package.json` and `dist/**`.

Identity and version:

| | |
|---|---|
| App name | `Meetless` (`CFBundleName`/`CFBundleDisplayName`) |
| appId | `app.meetless.desktop` |
| Version | `0.0.0` = `apps/desktop/package.json` version (`CFBundleShortVersionString`/`CFBundleVersion`) |
| Build marker | About panel: version line "unsigned dev build", credits "Unsigned development build: ad-hoc signed, not notarized, not for distribution."; Info.plist `MeetlessBuildChannel=unsigned-dev`, `MeetlessBuildNote`; copyright "Meetless unsigned dev build"; artifact names end in `-unsigned` |
| Languages | `electronLanguages: en, zh_CN` (Chromium locales trimmed to the product's two UI languages) |
| Icon | Electron default (no product icon yet) |

## 3. Building

On the Mac, inside the clone (`~/github/meetless`, branch `mac-packaging`):

```sh
# Optional: keep every download/cache inside the repo (what was done on <mac>).
R=$PWD/.cache
export NPM_CONFIG_CACHE=$R/npm npm_config_store_dir=$R/pnpm-store npm_config_cache_dir=$R/pnpm-cache \
       npm_config_state_dir=$R/pnpm-state electron_config_cache=$R/electron ELECTRON_CACHE=$R/electron \
       ELECTRON_BUILDER_CACHE=$R/electron-builder CSC_IDENTITY_AUTO_DISCOVERY=false

npx -y pnpm@12.23.0 install --frozen-lockfile
# Electron 45 has no postinstall: fetch the darwin-arm64 binary explicitly (about 130 MB zip).
(cd apps/desktop && node node_modules/electron/install.js)
# Build: main + preload + renderer -> stage -> electron-builder (dmg + zip, arm64, ad-hoc signed)
(cd apps/desktop && npx -y pnpm@12.23.0 run package:mac)
# Headless smoke test of the packaged binary (no window)
(cd apps/desktop && node scripts/smoke-packaged.mjs)
```

Network note for this Mac: direct downloads from `github.com` failed (`fetch failed`, curl reported an
HTTP/2 framing error). The Electron and electron-builder downloads worked through the Mac's existing local
proxy, set for these commands only:
`HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897 NO_PROXY=127.0.0.1,localhost NODE_USE_ENV_PROXY=1`.
No system or proxy settings were changed. electron-builder reuses `node_modules/electron/dist`
(`electronDist`), so Electron is downloaded only once. It also downloads `dmgbuild` and `7zip` into
`ELECTRON_BUILDER_CACHE`.

Outputs, in `apps/desktop/release/dist/`:

| Artifact | Size | SHA-256 |
|---|---|---|
| `Meetless-0.0.0-arm64-unsigned.dmg` | 116,603,280 B (111 MiB) | `5732155e9bc2f44bc2d281c74a19cf4c677d7c38b1b19d67ed88fdcdbd871779` |
| `Meetless-0.0.0-arm64-unsigned.zip` | 113,273,732 B (108 MiB) | `3cdc15a9ac517d94791f91c490278ab266264981d0a2442289b8714ab8fe6c8e` |
| `mac-arm64/Meetless.app` | 245 MiB unpacked | — |

`release/` and `.cache/` are git-ignored. To free the space: `rm -rf apps/desktop/release .cache`.

## 4. What "unsigned" means here, and what Gatekeeper does

- The app has an **ad-hoc** signature (`Signature=adhoc`, `TeamIdentifier=not set`). On Apple silicon
  every executable needs at least an ad-hoc signature to run. The ad-hoc seal also covers the modified
  Info.plist, so `codesign --verify --deep --strict` passes. It does **not** identify a developer.
- Hardened runtime is **off**. It is only required for notarization, and with an ad-hoc signature,
  library validation would reject Electron's own frameworks.
- The app is **not notarized**. `spctl --assess` rejects both the app and the dmg (see §6a).
- The Electron fuses are left at their defaults (`RunAsNode`, `--inspect` allowed). Playwright's
  acceptance run relies on `--inspect`. A distributable build should flip these fuses off.
- Gatekeeper on a **downloaded** copy: the browser adds `com.apple.quarantine`, and opening the app shows
  a "cannot verify the developer / Apple could not check it for malicious software" block with no
  "Open" button. On recent macOS, the user can allow it once in System Settings → Privacy & Security → "Open Anyway".
- A copy **built locally** has no quarantine attribute (checked: no `com.apple.quarantine` on the app, dmg
  or zip), so macOS does not show that Gatekeeper prompt when it runs from the build directory. This
  means running from the build directory does **not** exercise the first-launch path of a downloaded build.

### Installing a local unsigned build (user's own step)

This was **not** done on the target Mac. Nothing was copied to `/Applications`.

1. Open `Meetless-0.0.0-arm64-unsigned.dmg` and drag `Meetless.app` to `Applications`. Alternatively,
   unzip the `.zip`.
2. If the file was downloaded or transferred so that it is quarantined, macOS blocks the first launch.
   You can either use "Open Anyway" in System Settings → Privacy & Security, or remove the quarantine
   attribute yourself. Both are **your decision**: they turn off Gatekeeper's check for this app.
   For example: `xattr -dr com.apple.quarantine /Applications/Meetless.app`.
3. Uninstall: quit Meetless and delete `/Applications/Meetless.app`. The app data is in
   `~/Library/Application Support/Meetless` (cache, session and Chromium profile) and
   `~/Library/Preferences/app.meetless.desktop.plist`. Delete them to remove all local data
   (the DEV-ONLY session token is stored in plain JSON there; see ARCHITECTURE §5.3).

## 5. Runtime switches (main process)

| Variable | Effect |
|---|---|
| `MEETLESS_SMOKE=1` | Headless smoke mode. It hides the Dock icon (`app.dock.hide()`), uses temp `userData` and client data dirs, and runs the checks in `src/main/smoke-checks.ts`: node:sqlite, SQLite cache reopen, client engine, and zh-CN + en resources. It also checks that there are 0 BrowserWindows and that main is loaded from `app.asar`. It prints one JSON line on stdout, removes its temp dirs and exits (0 = pass). Log lines go to stderr. |
| `MEETLESS_USER_DATA_DIR` | Electron `userData` (Chromium profile). Set before `ready`. |
| `MEETLESS_CLIENT_DATA_DIR` | client cache/session directory (default `<userData>/meetless`) |
| `MEETLESS_LAUNCH_INACTIVE=1` | create the window hidden, then `showInactive()` so it does not take focus |
| `MEETLESS_LOG_FILE` | also append main-process log lines to this file |

`scripts/smoke-packaged.mjs` runs smoke mode against the packaged binary.
`e2e-electron/mac-packaged.mjs` (`pnpm test:mac-gui`) runs the GUI acceptance flow. It **opens a window**,
so it needs approval for the machine it runs on. It requires `MEETLESS_SYNC_URL=http://127.0.0.1:<port>`.

## 6. Stage results (2026-11-24, <mac>)

Built from branch `mac-packaging` with commit `7db8ad2` contents. (The Mac checkout was at `0b02aaf` plus the
`electron-builder.config.cjs` change that became `7db8ad2`, so the files are identical.)

### (a) Unsigned local test build: BUILT and VERIFIED HEADLESSLY

| Check | Result |
|---|---|
| `file` / `lipo -archs` | main binary `Contents/MacOS/Meetless`: Mach-O 64-bit executable **arm64**. The same holds for the 4 helper apps (`Meetless Helper`, GPU, Renderer, Plugin), the 4 frameworks (Electron Framework, Mantle, ReactiveObjC, Squirrel), `libffmpeg.dylib`, `libvk_swiftshader.dylib`, `chrome_crashpad_handler` and `app_shim_loader`. Total 14 Mach-O files, 0 non-arm64. **No `.node` native modules** in the bundle; node:sqlite is built in. |
| `codesign -dv` | `Identifier=app.meetless.desktop`, `Format=app bundle with Mach-O thin (arm64)`, `CodeDirectory flags=0x2(adhoc)`, `Signature=adhoc`, `TeamIdentifier=not set`, sealed resources: 10 files |
| `codesign --verify --deep --strict` | `valid on disk`, `satisfies its Designated Requirement` (exit 0) |
| `spctl --assess --type execute` (app) | **rejected** (exit 3), as expected for a non-notarized app |
| `spctl --assess --type open --context context:primary-signature` (dmg) | **rejected**, `source=no usable signature` (exit 3), as expected (dmg is unsigned) |
| dmg | UDZO (zlib); `hdiutil verify`: checksum VALID. Mounted with `-readonly -nobrowse -noautoopen` at a temp mount point (read-only hfs; a write attempt failed with "Read-only file system"). Contents: `Meetless.app`, `Applications` symlink, `.background.tiff`, `.DS_Store`. The app inside passes `codesign --verify --deep --strict` and has the same Info.plist values. Detached; no mount left. **Not installed** to /Applications. |
| zip | 128 entries, top level `Meetless.app/` |
| asar | 11 entries: `/package.json`, `/dist/main/main.cjs`, `/dist/preload/preload.cjs`, `/dist/renderer/{index.html, assets/*.js, assets/*.css}`; no `node_modules` |
| Smoke (`MEETLESS_SMOKE=1`, binary run inside `release/dist/mac-arm64`) | exit 0, 8/8 checks pass, 1.6 s. See below. |

Smoke JSON (abridged; full copy in `docs/screenshots/macos/smoke.json`):

```json
{"meetlessSmoke":1,"ok":true,
 "app":{"name":"Meetless","version":"0.0.0","build":"unsigned dev build","channel":"unsigned-dev","packaged":true},
 "runtime":{"platform":"darwin","arch":"arm64","electron":"45.4.1","node":"24.22.3","chrome":"156.0.8078.100",
            "dockVisible":false,"systemLocales":["en-GB","zh-Hans-GB"]},
 "checks":[
  {"name":"node:sqlite loads and runs SQL","ok":true,"detail":{"sqliteVersion":"3.54.1"}},
  {"name":"local cache (SQLite file) persists across reopen","ok":true},
  {"name":"client engine opens in the data dir (no session)","ok":true,"detail":{"cacheKind":"sqlite","host":"electron","state":"signed_out"}},
  {"name":"i18n zh-CN loads","ok":true,"detail":{"keys":385,"missing":0,"samples":{"nav.pending":"我的待处理事项"}}},
  {"name":"i18n en loads","ok":true,"detail":{"keys":385,"missing":0,"samples":{"nav.pending":"My pending items"}}},
  {"name":"i18n zh-CN and en differ, locale resolution works","ok":true,"detail":{"zh-Hans-CN":"zh-CN","en-GB":"en","system":"en"}},
  {"name":"no BrowserWindow created","ok":true,"detail":{"windows":0}},
  {"name":"main bundle loaded from app.asar","ok":true}]}
```

After the smoke run, no Meetless process was left and both temp dirs had been removed. Side effect
found: even with no window, Electron/AppKit created `~/Library/Preferences/app.meetless.desktop.plist`
(`AppleTextDirection`, `NSForceRightToLeftWritingDirection`, `NSTreatUnknownArgumentsAsOpen`).
It belongs to this appId and was deleted after the runs (`defaults delete app.meetless.desktop`).

### (b) GUI launch on the Mac: ONE CONTROLLED RUN DONE (partial A01); install NOT verified

After the headless checks passed, the coordinator approved one controlled window launch (2026-11-24,
covered by the user's approval to use this Mac for packaging and acceptance). Here is how it was run:

- The packaged binary was started **from the build output dir** (`release/dist/mac-arm64/Meetless.app/Contents/MacOS/Meetless`),
  not from /Applications. Quarantine was not stripped and no Gatekeeper/security setting was changed.
  The run was not blocked: both launches reached a rendered window. The screen was not captured, so a
  dialog that did not block the run would not have been seen. Because the build is local and unquarantined,
  Gatekeeper was not involved.
- It was driven by Playwright `_electron.launch` (`e2e-electron/mac-packaged.mjs`) with
  `MEETLESS_LAUNCH_INACTIVE=1`, a temp `userData`/client data dir and `MEETLESS_LOG_FILE`.
  The window reported `visible: true, focused: false`.
- The sync server ran on the dev server, bound to `127.0.0.1:48710`, with a throw-away Postgres schema.
  It was reached from the Mac through an SSH local forward `127.0.0.1:48710 → the dev server 127.0.0.1:48710`.
  No port was exposed beyond loopback.
- Evidence is from Meetless itself only: renderer screenshots via `page.screenshot()` (no screen
  capture), the app's main-process log and `ps` for the launched PIDs. All of it is in `docs/screenshots/macos/`.

Result: 12/12 checks passed (`docs/screenshots/macos/results.json`).

| A01 sub-check | Covered? | Evidence |
|---|---|---|
| install | **No.** The app ran from the build dir; it was not installed to /Applications. The dmg was only mounted read-only and inspected. | — |
| launch | **Yes** (packaged app, build dir, inactive window). The window rendered; the renderer has the bridge and no Node globals; the main process uses the node:sqlite cache. | `01-signin-en.png`, `ps.txt`, `meetless-main.log` |
| sign-in | **Yes, DEV-ONLY token** (`dev-lin`) against the loopback sync server. Sync went online, a project was created and its synced state was shown (5 server-accepted events). Real team identity does not exist yet. | `02-project-zh-CN.png`, `03-project-en.png` |
| language | zh-CN ↔ en switched both ways (system locale en-GB → initial UI en) | `02`, `03` |
| quit | **Yes.** `app.close()` exited the process (PID gone, `ps` empty) after both launches. "Quit" here is a programmatic close; Cmd-Q was not pressed by a person. | `ps.txt` |
| data retention | **Yes.** On relaunch with the same data dirs, the session (`u-lin`) and cached events were loaded from SQLite, the project was listed, the language stayed zh-CN (not the system default) and sync reconnected. | `04-relaunch-zh-CN.png`, `meetless-main.log` |
| log out | Not tested. | — |

Clean-up after the run: no Meetless processes remained, the SSH forward was closed, the server process
was stopped, its Postgres schema was dropped and its temp dir deleted, and the temp data dirs on the Mac
were deleted. The only side effect left was the `app.meetless.desktop` preferences plist, which was
deleted. Not covered: opening the app from Finder/Launchpad, the first-launch Gatekeeper dialog of a
downloaded copy, the About panel shown on screen (its text is set in code, see §2), and app updates.

### (c) Distributable signed and notarized package: NOT POSSIBLE YET

This needs an Apple Developer Program membership and:

1. a "Developer ID Application" certificate (+ private key) in the build keychain, or passed through
   `CSC_LINK`/`CSC_KEY_PASSWORD`;
2. `mac.identity` set to that identity (instead of `"-"`), `hardenedRuntime: true`, and an entitlements
   plist (at least `com.apple.security.cs.allow-jit` for V8);
3. notarization credentials (App Store Connect API key, or Apple ID + app-specific password + team ID),
   with `mac.notarize` enabled, then stapling;
4. a signed dmg (`dmg.sign: true`) and a product icon;
5. Electron fuses hardened (`RunAsNode` off, `EnableNodeCliInspectArguments` off,
   `EnableEmbeddedAsarIntegrityValidation` + `OnlyLoadAppFromAsar` on). After that, the Playwright
   acceptance script would need a separate test build.

Until then, every build is an "unsigned dev build" and is distributed only to machines whose owners
accept the steps in §4.

## 7. Disk used on the target Mac

| | |
|---|---|
| Free on `/System/Volumes/Data` before | 39,581,388 KiB (37.7 GiB) |
| Free after build, verification and GUI run | 38,052,896 KiB (36.3 GiB) |
| Net used | about 1.46 GiB |
| Breakdown (`du`) | `node_modules` 496 MiB (APFS clones of the store, so `du` overstates), `.cache` 834 MiB (pnpm store 409, Electron zip 129, dmgbuild/7zip 129, npm 94, pnpm metadata 74), `apps/desktop/release` 471 MiB (dist 470, of which dmg 112 + zip 113 + .app 245) |

Everything is inside `~/github/meetless`. Nothing was written to `~/Library/Caches`, `~/.npm` or global
npm/brew locations.

## 8. Re-run on the merged M2 commit `b017a89` (2026-11-24)

Built on <mac> in a separate worktree (`~/github/meetless-next`, detached at `b017a89`),
so the earlier build that the user still had open was not overwritten. Same commands as §3.

| Artifact (`apps/desktop/release/dist/`) | Size | SHA-256 |
|---|---|---|
| `Meetless-0.0.0-arm64-unsigned.dmg` | 116,674,801 B | `0a5f89b59dfb6eeefb8eb9f7e4674b20e72f1c01805de18742bd8506e6eb5abd` |
| `Meetless-0.0.0-arm64-unsigned.zip` | 113,325,504 B | `4597d4bfeeedb8681aad82d0f6d31235985016fd0d87bb625f350fce81059859` |

- `lipo -archs` on the main binary: `arm64`. Still ad-hoc signed, not notarized (as §4).
- Headless smoke (`scripts/smoke-packaged.mjs`): 8/8 PASS, exit 0.
- GUI run (`e2e-electron/mac-packaged.mjs`, app shown inactive, temp data dirs, a throw-away sync server on
  the dev server reached through an SSH forward to `127.0.0.1:48711`, schema dropped afterwards): **12/12 PASS**.
  Evidence in `docs/screenshots/macos/` was refreshed from this run. The main-process log now always goes to the
  rotating file log; the sign-in attempt is logged with the server URL and result, without the token.
- Still not covered here: install from the dmg into /Applications, launch from Finder, first-launch Gatekeeper
  prompt of a downloaded copy, real team identity. A01 stays partial.
- The user's own trial of the earlier `7d0b7c6` build reported that entering a dev token did nothing. The cause
  was not confirmed (that build had no file log). `b017a89` adds a sign-in timeout, visible errors with the URL
  tried, the file log and an id-based IPC sender check; the user should retry with this build.

## 9. v3 build (2026-11-25, commit `7cf9101`)

Built on <mac> in its own worktree, `~/github/meetless-v3` (detached at `7cf9101`, fetched from
GitHub `v3`), with the commands in §3 and the proxy set per command. The Electron zip (45.4.1, darwin-arm64) was
copied into this worktree's own `.cache` from the earlier build's cache rather than downloaded again. The earlier
worktrees `~/github/meetless` and `~/github/meetless-next` were not touched.

| Artifact (`apps/desktop/release/dist/`) | Size | SHA-256 |
|---|---|---|
| `Meetless-0.0.0-arm64-unsigned.dmg` | 121,478,785 B | `8cf94f25af8fc946745f38c4f19eee7effadcd7400b591eecd91459a87f7ee91` |
| `Meetless-0.0.0-arm64-unsigned.zip` | 118,128,696 B | `2a778c189673f69cceadd9fc0cb92766fe5587fe50c99da991bab116761fc5f4` |

- `lipo -archs`: `arm64`. Ad-hoc signed (`TeamIdentifier=not set`), not notarized, no quarantine attribute.
- Headless smoke (`MEETLESS_SMOKE=1`, `scripts/smoke-packaged.mjs`): 8/8 PASS, exit 0, no window.
- `stage-app.mjs` now checks unbundled imports from esbuild's metafile (`dist/meta/`). The old text grep
  mistook require strings inside ajv's code generator (pulled in by the MCP SDK for Notion capture) for missing
  packages and stopped the build.
- Not run: the GUI flow (`e2e-electron/mac-packaged.mjs`, updated for v3 and invite-code sign-in) opens a window
  and needs the user's approval. Evidence would go to `docs/screenshots/v3/macos/`.
- Disk: about 1.4 GiB in the worktree (`node_modules` 540 MiB, `release` 488 MiB, `.cache` 339 MiB);
  29.5 GiB free after. To free it: `rm -rf ~/github/meetless-v3/apps/desktop/release ~/github/meetless-v3/.cache`.
- To try it against the v3 trial server, forward `4876` (and `55435` for OnlyOffice) as in `docs/MCP.md` §4.

Rebuilt on `48afbe6` (avatar and CJK name fixes), same worktree and commands; headless smoke 8/8 PASS, no window:

| Artifact (`apps/desktop/release/dist/`) | Size | SHA-256 |
|---|---|---|
| `Meetless-0.0.0-arm64-unsigned.dmg` | 121,478,799 B | `ed43f645148026e677f8c531af8aded06692244f101a4a66ee2c6ccb4fb80487` |
| `Meetless-0.0.0-arm64-unsigned.zip` | 118,128,828 B | `ce91d9cc129c7bde206e269c06bff778491d6df21aeca949fbf3587604c80ff4` |

## 10. Since 0.1.0: release builds and signing

The build config now covers macOS, Windows and Linux. Releases are built by
`.github/workflows/release.yml` (see `docs/RELEASE.md`). What changed for the Mac build:

- electron-builder no longer signs (`mac.identity: null`). `scripts/sign-mac.cjs` signs in
  `afterPack` with `codesign --force --deep`: on the release runner with the self-signed
  **Meetless Self-Signed** identity (`MAC_SIGN_IDENTITY`), and ad hoc (`-`) on a local build
  without one, as before. Neither is notarized, so the Gatekeeper steps in section 4 still apply
  to a downloaded copy.
- Artifacts are now named `Meetless-<version>-mac-<arch>.{dmg,zip}`, without the `-unsigned`
  suffix. The in-app updater picks the zip by its `-<arch>.zip` ending.
- Releases build both arm64 and x64. `package:mac` still builds arm64 only, using the local
  Electron, which is not used on CI (`CI` is set there).
- The app updates itself from GitHub Releases (`docs/RELEASE.md`, "How the updater works").
