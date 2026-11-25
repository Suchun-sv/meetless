# Releasing Meetless

The desktop app is released from GitHub: `.github/workflows/release.yml` builds it on GitHub's
runners and publishes one GitHub release with the installers and the update manifests that the
app reads. The workflow and the updater are adapted from Gleeok's.

## Cut a release

1. Pick the version, `X.Y.Z`. The workflow takes it from the tag, so `apps/desktop/package.json`
   only needs bumping when the repo itself should show it (it is `0.1.0` now).
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

   - publishes the draft as the latest release once all three builds have succeeded. If one
     fails, the release stays a draft and nothing is offered to users.
4. Edit the release notes on GitHub if needed. The app shows them, one line per entry, in the
   update dialog.

A manual run (Actions, Release, Run workflow) builds the same files and keeps them as workflow
artifacts only. It publishes nothing.

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

The identity lives on the dev server in `~/work/meetless-signing/` (CN "Meetless Self-Signed",
code-signing EKU). Set the secrets from there without printing them:

```sh
base64 -w0 ~/work/meetless-signing/meetless-signing.p12 | gh secret set MAC_CERT_P12 -R Suchun-sv/meetless
gh secret set MAC_CERT_PASSWORD -R Suchun-sv/meetless < ~/work/meetless-signing/p12-password.txt
```

Keep the same p12 for every release. A new identity makes macOS treat the app as a different
one. `GITHUB_TOKEN` is provided by Actions and needs no setup.

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
  "Meetless X.Y.Z". A failed check changes nothing and shows nothing.
- **UI.** The sidebar user row shows 「有新版本 X.Y.Z」 with 「升级」. The button opens a confirm
  dialog with the notes, and a progress line follows the install. Nothing installs without
  that click.
- **macOS.** The updater downloads `Meetless-X.Y.Z-mac-<arch>.zip` into a hidden folder next to
  the running `Meetless.app`, then checks its SHA-512 against `latest-mac.yml` and refuses it on
  a mismatch. If the hash matches, it unpacks the zip with `ditto` and swaps the bundles with two
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
