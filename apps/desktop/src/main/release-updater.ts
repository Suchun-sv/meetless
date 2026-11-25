import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Result, UpdateState } from '@meetless/client/bridge';

/**
 * Updates for installed builds, from GitHub Releases (see .github/workflows/release.yml and
 * docs/RELEASE.md). Adapted from Gleeok's app/src/main/release-updater.ts (same author).
 *
 * - Windows (NSIS) and the Linux AppImage use electron-updater, which reads latest.yml /
 *   latest-linux.yml from the release.
 * - macOS would go through Squirrel there, which only accepts apps signed with an Apple developer
 *   identity. So the app swaps itself: download the zip for this architecture, check its SHA-512
 *   against latest-mac.yml, unpack it next to the running app and put it in its place, relaunch.
 *   A file the app downloads itself carries no quarantine flag, so Gatekeeper does not stop it.
 *   Quarantine is never stripped from anything: what the user downloaded keeps its flag.
 * - Any other install type (a .deb, an unpacked dir, a dev run) offers the releases page.
 *
 * Nothing installs without the user's click: `check()` only looks, `install()` is the click.
 * This module never imports electron, so it runs under plain Node in the tests.
 */

const REPO = 'Suchun-sv/meetless';
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
const API_URL = `https://api.github.com/repos/${REPO}`;
/** How often the running app looks for a new release. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type InstallKind = 'mac' | 'electron-updater' | 'manual';

/** How this install can update itself. A Linux build that is not the AppImage cannot replace itself. */
export function installKind(opts: { packaged: boolean; platform: NodeJS.Platform; appImage?: string }): InstallKind {
  if (!opts.packaged) return 'manual';
  if (opts.platform === 'darwin') return 'mac';
  if (opts.platform === 'win32') return 'electron-updater';
  if (opts.platform === 'linux' && opts.appImage) return 'electron-updater';
  return 'manual';
}

/** Numeric x.y.z compare (a pre-release suffix sorts before its release). */
export function newer(a: string, b: string): boolean {
  const parse = (v: string) => {
    const [core = '', pre] = v.replace(/^v/, '').split('-');
    return { nums: core.split('.').map((n) => Number(n) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) > (y.nums[i] ?? 0);
  return !x.pre && !!y.pre;
}

/** The manifest electron-builder writes for each platform. */
export function manifestName(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? 'latest-mac.yml' : platform === 'win32' ? 'latest.yml' : 'latest-linux.yml';
}

export interface ManifestFile {
  url: string;
  /** base64 */
  sha512: string;
  size: number;
}

/** The version and the `files:` list (url, sha512, size) of an electron-builder manifest. */
export function parseManifest(yml: string): { version: string | null; files: ManifestFile[] } {
  const version = /^version:\s*['"]?([^'"\s]+)/m.exec(yml)?.[1] ?? null;
  const files: ManifestFile[] = [];
  const list = /^files:\s*\n((?:[ \t]+.*\n?)*)/m.exec(yml)?.[1] ?? '';
  for (const block of list.split(/^\s*-\s+url:\s*/m).slice(1)) {
    const url = block.split('\n')[0]!.trim().replace(/^['"]|['"]$/g, '');
    const sha512 = /sha512:\s*['"]?([^'"\s]+)/.exec(block)?.[1] ?? '';
    const size = Number(/size:\s*(\d+)/.exec(block)?.[1] ?? 0);
    files.push({ url, sha512, size });
  }
  return { version, files };
}

/** The release notes as lines: list markers, "by @x in <url>" and headings dropped. */
function noteLines(body: string): string[] {
  return body
    .split('\n')
    .map((l) => l.replace(/^[-*]\s+/, '').replace(/\s+by @\S+ in https:\S+$/, '').trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('**Full Changelog'));
}

/** A failure with the code the UI shows (i18n `upd.err.<code>`). */
class UpdateError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

/** Puts `fresh` where `bundle` is (two renames on one volume) and removes the old one; the old one comes back if that fails. */
export function swapBundle(bundle: string, fresh: string): void {
  const old = join(dirname(bundle), `.${basename(bundle)}.old-${Date.now()}`);
  renameSync(bundle, old);
  try {
    renameSync(fresh, bundle);
  } catch (e) {
    renameSync(old, bundle);
    throw e;
  }
  rmSync(old, { recursive: true, force: true });
}

const run = (cmd: string, args: string[]) =>
  new Promise<void>((done, fail) => execFile(cmd, args, (e) => (e ? fail(e) : done())));

/** macOS: ditto keeps the bundle's symlinks, modes and signature; elsewhere (tests) unzip. */
function defaultUnzip(platform: NodeJS.Platform) {
  return (zip: string, dir: string) => (platform === 'darwin' ? run('ditto', ['-x', '-k', zip, dir]) : run('unzip', ['-q', zip, '-d', dir]));
}

/** Windows and the AppImage: electron-updater downloads, checks and installs, then restarts the app. */
export async function electronUpdaterInstall(progress: (percent: number) => void): Promise<void> {
  const { autoUpdater } = await import('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  const found = await autoUpdater.checkForUpdates();
  if (!found?.isUpdateAvailable) throw new UpdateError('UPDATE_NONE');
  autoUpdater.on('download-progress', (p: { percent: number }) => progress(Math.round(p.percent)));
  await autoUpdater.downloadUpdate();
  autoUpdater.quitAndInstall(true, true);
}

export interface ReleaseUpdaterOptions {
  currentVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  kind: InstallKind;
  /** False in a dev run: no network at all. */
  enabled?: boolean;
  /** Where the release files are; default https://github.com/Suchun-sv/meetless/releases. Tests point it at a local server. */
  baseUrl?: string;
  /** The GitHub API for the release notes; default https://api.github.com/repos/Suchun-sv/meetless. */
  apiUrl?: string;
  /** macOS: the running .app bundle. */
  bundlePath?: string;
  unzip?: (zip: string, dir: string) => Promise<void>;
  electronUpdater?: (progress: (percent: number) => void) => Promise<void>;
  /** macOS: restart into the swapped bundle. */
  relaunch?: () => void;
  onChange?: (s: UpdateState) => void;
  log?: (msg: string) => void;
}

interface Pending {
  version: string;
  tag: string;
  files: ManifestFile[];
}

export class ReleaseUpdater {
  private state: UpdateState;
  private inFlight: Promise<UpdateState> | null = null;
  private lastCheck = 0;
  private readonly base: string;
  private readonly api: string;

  constructor(private readonly opts: ReleaseUpdaterOptions) {
    this.base = (opts.baseUrl ?? RELEASES_URL).replace(/\/$/, '');
    this.api = (opts.apiUrl ?? API_URL).replace(/\/$/, '');
    this.state = {
      current: opts.currentVersion,
      available: null,
      install: opts.kind === 'manual' ? 'manual' : 'self',
      releasesUrl: RELEASES_URL,
      phase: 'idle',
      percent: null,
      error: null,
    };
  }

  get current(): UpdateState {
    return { ...this.state };
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.opts.onChange?.({ ...this.state });
  }

  private busy(): boolean {
    return this.state.phase === 'downloading' || this.state.phase === 'installing' || this.state.phase === 'restarting';
  }

  /** Checks on start, then every 6 hours. Returns a stop function. */
  start(intervalMs = CHECK_INTERVAL_MS): () => void {
    if (this.opts.enabled === false) return () => undefined;
    const first = setTimeout(() => void this.check(), 5_000);
    const timer = setInterval(() => void this.check(), intervalMs);
    first.unref?.();
    timer.unref?.();
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }

  /** Looks for a newer release. Never throws: a failed check leaves the state as it was. */
  check(): Promise<UpdateState> {
    if (this.opts.enabled === false || this.busy()) return Promise.resolve(this.current);
    // The renderer asks when it mounts; a check that just finished answers for it.
    if (Date.now() - this.lastCheck < 60_000) return Promise.resolve(this.current);
    this.inFlight ??= this.latest()
      .then((p) => {
        this.lastCheck = Date.now();
        this.set({ available: p ? { version: p.version, notes: [] } : null });
        return p ? this.notes(p.tag, p.version) : null;
      })
      .then((notes) => {
        if (notes && this.state.available) this.set({ available: { ...this.state.available, notes } });
        return this.current;
      })
      .catch((e: unknown) => {
        this.opts.log?.(`update check failed: ${String((e as Error).message ?? e)}`);
        return this.current;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  /**
   * The latest published release, if it is newer than this build. Its version comes from the
   * release's download link, not the GitHub API (60 requests an hour per IP address, soon used up
   * behind a shared address).
   */
  private async latest(): Promise<Pending | null> {
    const res = await fetch(`${this.base}/latest/download/${manifestName(this.opts.platform)}`, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
    const { version, files } = parseManifest(await res.text());
    if (!version || !newer(version, this.opts.currentVersion)) return null;
    return { version, tag: `v${version}`, files };
  }

  /** The notes from the GitHub API when it answers; a plain line when it does not. */
  private async notes(tag: string, version: string): Promise<string[]> {
    try {
      const res = await fetch(`${this.api}/releases/tags/${tag}`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'Meetless' },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const lines = noteLines(((await res.json()) as { body?: string }).body ?? '');
        if (lines.length) return lines;
      }
    } catch {
      // the notes are optional
    }
    return [`Meetless ${version}`];
  }

  /** The user's click: install the newest release and restart into it. */
  async install(): Promise<Result<object>> {
    if (this.busy()) return { ok: false, code: 'UPDATE_BUSY' };
    try {
      if (this.opts.kind === 'manual') throw new UpdateError('UPDATE_MANUAL');
      // Always the newest: what the dialog showed may have been replaced since.
      this.set({ phase: 'downloading', percent: null, error: null });
      const p = await this.latest().catch((e: unknown) => {
        throw new UpdateError('UPDATE_DOWNLOAD', String((e as Error).message ?? e));
      });
      if (!p) throw new UpdateError('UPDATE_NONE');
      if (this.opts.kind === 'mac') await this.installMac(p);
      else {
        await (this.opts.electronUpdater ?? electronUpdaterInstall)((percent) => this.progress(percent));
        this.set({ phase: 'restarting', percent: null });
      }
      return { ok: true };
    } catch (e) {
      const errno = (e as NodeJS.ErrnoException).code;
      const code = e instanceof UpdateError ? e.code : errno === 'EACCES' || errno === 'EPERM' || errno === 'EROFS' ? 'UPDATE_PERMISSION' : 'UPDATE_FAILED';
      this.opts.log?.(`update install failed (${code}): ${String((e as Error).message ?? e)}`);
      this.set({ phase: 'failed', percent: null, error: code });
      return { ok: false, code };
    }
  }

  private progress(percent: number): void {
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    if (p !== this.state.percent) this.set({ phase: 'downloading', percent: p });
  }

  private async installMac(p: Pending): Promise<void> {
    const bundle = this.opts.bundlePath;
    if (!bundle || !bundle.endsWith('.app')) throw new UpdateError('UPDATE_FAILED', `not an app bundle: ${bundle}`);
    const file = p.files.find((f) => f.url.endsWith(`-${this.opts.arch}.zip`));
    if (!file) throw new UpdateError('UPDATE_FAILED', `no zip for ${this.opts.arch} in ${p.tag}`);
    if (!file.sha512) throw new UpdateError('UPDATE_CHECKSUM', 'the manifest has no sha512');

    // Next to the running bundle, so the swap is two renames on one volume.
    const work = mkdtempSync(join(dirname(bundle), '.Meetless-update-'));
    try {
      const zip = join(work, 'update.zip');
      const res = await fetch(`${this.base}/download/${p.tag}/${encodeURIComponent(file.url)}`, { signal: AbortSignal.timeout(30 * 60_000) });
      if (!res.ok || !res.body) throw new UpdateError('UPDATE_DOWNLOAD', `download: HTTP ${res.status}`);
      const hash = createHash('sha512');
      let got = 0;
      const count = new Transform({
        transform: (chunk: Buffer, _enc, done) => {
          hash.update(chunk);
          got += chunk.length;
          if (file.size) this.progress((got / file.size) * 100);
          done(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body as WebReadableStream), count, createWriteStream(zip)).catch((e: unknown) => {
        throw new UpdateError('UPDATE_DOWNLOAD', String((e as Error).message ?? e));
      });
      if (hash.digest('base64') !== file.sha512) throw new UpdateError('UPDATE_CHECKSUM', `sha512 mismatch for ${file.url}`);
      this.progress(100);

      this.set({ phase: 'installing', percent: null });
      const unpacked = join(work, 'app');
      await (this.opts.unzip ?? defaultUnzip(this.opts.platform))(zip, unpacked);
      const name = readdirSync(unpacked).find((n) => n.endsWith('.app'));
      if (!name) throw new UpdateError('UPDATE_FAILED', 'no .app in the zip');
      swapBundle(bundle, join(unpacked, name));
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    this.set({ phase: 'restarting', percent: null });
    this.opts.relaunch?.();
  }
}
