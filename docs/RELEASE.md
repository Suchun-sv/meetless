# Releasing Meetless

The desktop app is released from GitHub: `.github/workflows/release.yml` builds it on GitHub's
runners and publishes one GitHub release with the installers and the update manifests that the
app reads. The workflow and the updater are adapted from Gleeok's.

## Cut a release

1. Pick the version, `X.Y.Z`. The workflow takes it from the tag, so `apps/desktop/package.json`
   only needs bumping when the repo itself should show it (it is `0.1.2` now).
2. Tag the commit and push the tag:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. The workflow then:
   - creates a draft release `v0.2.0` with generated notes;
   - builds in parallel:

     | Runner | Output | Manifest |
     |---|---|---|
     | macOS | `Meetless-X.Y.Z-mac-arm64.zip` / `.dmg`, `Meetless-X.Y.Z-mac-x64.zip` / `.dmg` | `latest-mac.yml` |
     | Windows | `Meetless-X.Y.Z-windows-x64-setup.exe` (NSIS) | `latest.yml` |
     | Linux | `Meetless-X.Y.Z-linux-x86_64.AppImage` | `latest-linux.yml` |

   - runs a separate publish job once all three builds have succeeded. It has no checkout and
     no dependencies: it downloads the build artifacts, re-hashes every file against
     `latest-mac.yml`, `latest.yml` and `latest-linux.yml`, uploads them to the draft (never to a
     published release) and publishes it. It is marked latest only if its tag is the highest
     stable version. If a build fails, the release stays a draft and nothing is offered to users.

   The builds have read-only permissions and no token (`persist-credentials: false`,
   `--publish never`). Every action is pinned by commit SHA. Only the macOS packaging step sees
   the certificate: it imports it as a non-exportable key into a throw-away keychain with a random
   password and deletes the keychain when the step ends. Runs are serialised (`concurrency`).
4. Edit the release notes on GitHub if needed. The app shows them, one line per entry, in the
   update dialog.

A manual run (Actions, Release, Run workflow) from a branch builds the same files and keeps them
as workflow artifacts only. It publishes nothing. A manual run on a tag is refused.

Local builds stay as before: `pnpm --filter @meetless/desktop package:mac` (on a Mac, arm64,
ad-hoc signed, see `docs/MACOS.md`) and `pnpm --filter @meetless/desktop package:linux`
(AppImage). Both write to `apps/desktop/release/dist/`, which git ignores.

## Secrets

The macOS build signs with a self-signed code-signing identity named **Meetless Self-Signed**. Every
version therefore carries the same identity, and the keychain and the privacy permissions keep
trusting the app across updates. It is not an Apple identity, so the app is still not notarized.
A tag build fails without it; a manual run without it signs ad hoc.

| Secret | Value |
|---|---|
| `MAC_CERT_P12` | the PKCS#12 file (certificate and key), base64 |
| `MAC_CERT_PASSWORD` | its password |

The maintainer keeps the identity (CN "Meetless Self-Signed", code-signing EKU) offline, outside
the repo. Set the secrets from where it is kept, without printing them:

```sh
base64 -w0 <path-to>/meetless-signing.p12 | gh secret set MAC_CERT_P12 -R Suchun-sv/meetless
gh secret set MAC_CERT_PASSWORD -R Suchun-sv/meetless < <path-to-password-file>
```

Keep the same p12 for every release. A new identity makes macOS treat the app as a different
one, and every installed build refuses an update signed with it: the updater pins the
certificate's SHA-1 (`apps/desktop/src/main/update-verify.ts`). `GITHUB_TOKEN` is provided by Actions and needs no setup.

## How the updater works

The updater lives in `apps/desktop/src/main/release-updater.ts` (Electron main). The renderer
reaches it only through two bridge calls, `updatesCheck()` and `updatesInstall()`, plus an
`update` push event that carries the progress. The browser dev bridge host answers both with
`NOT_AVAILABLE`.

- **Check.** The updater checks on start (after 5 s) and then every 6 hours. It fetches
  `https://github.com/Suchun-sv/meetless/releases/latest/download/<manifest>`, where the manifest
  is `latest-mac.yml`, `latest.yml` or `latest-linux.yml`. That URL is a plain download, so it
  avoids the API rate limit. The version in the manifest is compared with the running one by
  `newer()`. The notes come from the GitHub API
  (`/repos/Suchun-sv/meetless/releases/tags/vX.Y.Z`) when it answers; otherwise the dialog shows
  "Meetless X.Y.Z". Every request goes through Electron's `net.fetch`, so the system proxy and
  PAC apply (Node's fetch ignores them). A failed check keeps what was offered, logs the reason and
  the proxy Chromium resolved (hosts only), and the sidebar shows 「检查更新失败，点此重试」.
- **UI.** The sidebar user row shows 「有新版本 X.Y.Z」 with 「升级」. The button opens a confirm
  dialog with the notes, and a progress line follows the install. Nothing installs without
  that click.
- **Manifest rules.** The manifest version must be strict semver (`x.y.z` or `x.y.z-pre`), since it
  becomes the tag in a URL path. Downloads follow redirects only to `github.com`,
  `objects.githubusercontent.com` and `release-assets.githubusercontent.com` over https, the
  manifest is capped at 256 KB, and the zip may not exceed the size the manifest gives (at most 1 GB).
- **macOS.** The updater downloads exactly `Meetless-X.Y.Z-mac-<arch>.zip` into a hidden folder next
  to the running `Meetless.app`, then checks its SHA-512 against `latest-mac.yml` and refuses it on
  a mismatch. Before unpacking, it reads the zip's central directory and refuses absolute paths,
  `..`, special files, anything outside `Meetless.app/` and anything written through a symlink.
  After unpacking (`ditto`), `Meetless.app` must be a real directory whose symlinks stay inside it;
  its `CFBundleIdentifier` must be `app.meetless.desktop` and its `CFBundleShortVersionString` the
  manifest version, newer than the running one; and `codesign --verify --deep --strict` must accept
  it against `identifier "app.meetless.desktop" and certificate leaf = H"<sha1>"`, the SHA-1 of the
  Meetless Self-Signed certificate (`SIGNING_CERT_SHA1` in `update-verify.ts`). Any failure leaves
  the app as it was and shows 「没有通过签名和版本检查」. Only then does it swap the bundles with two
  renames on the same volume (the old bundle comes back if the second rename fails). It then
  deletes the old bundle and relaunches. Squirrel is not used because it accepts only apps
  signed with an Apple identity. The app's own download carries no quarantine flag, and the
  updater never strips quarantine from anything. If the app cannot write its own location (for
  example a translocated copy still in Downloads), the user is told to move it somewhere
  writable or to download the update manually.
- **Windows and the Linux AppImage.** `electron-updater` handles the update. It reads
  `app-update.yml`, which electron-builder writes into the app from the `publish` setting, and
  `latest.yml` / `latest-linux.yml`, then checks the SHA-512, installs and restarts.
- **Other install types** (an unpacked dir, a `.deb`, a dev run) show 「去下载」, a link to the
  releases page.
- **Testing.** `apps/desktop/test/release-updater.test.ts` runs the updater against a local HTTP
  server that serves a fake manifest and zip. In a dev run, `MEETLESS_UPDATE_BASE=<url>` points the
  updater at such a server. It is ignored in packaged builds.

## Not covered yet

- No Apple notarization, so the first install of a downloaded dmg needs the Gatekeeper
  "Open Anyway" step (`docs/MACOS.md`).
- Windows is not code-signed, so SmartScreen warns on the first install.
- The macOS swap and the Windows path have been tested only in unit tests (on Linux) and have not
  run on a real machine yet.
