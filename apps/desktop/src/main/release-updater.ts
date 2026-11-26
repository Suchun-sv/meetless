import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Result, UpdateState } from '@meetless/client/bridge';
import { BUNDLE_ID, bundleInfo, checkUnpacked, checkZip, SEMVER, verifySignature, VerifyError, zipEntries } from './update-verify';

/**
 * Updates for installed builds, from GitHub Releases (see .github/workflows/release.yml and
 * docs/RELEASE.md). Adapted from Gleeok's app/src/main/release-updater.ts (same author).
 *
 * - Windows (NSIS) and the Linux AppImage use electron-updater, which reads latest.yml /
 *   latest-linux.yml from the release.
 * - macOS would go through Squirrel there, which only accepts apps signed with an Apple developer
 *   identity. So the app swaps itself: download the zip for this architecture, check its SHA-512
 *   against latest-mac.yml, check the zip's entries, unpack it next to the running app, check that
 *   it is a Meetless build of the manifest's version signed by the Meetless certificate
 *   (update-verify.ts), put it in its place, relaunch.
 *   A file the app downloads itself carries no quarantine flag, so Gatekeeper does not stop it.
 *   Quarantine is never stripped from anything: what the user downloaded keeps its flag.
 * - Any other install type (a .deb, an unpacked dir, a dev run) offers the releases page.
 *
 * Nothing installs without the user's click: `check()` only looks, `install()` is the click.
 * This module never imports electron, so it runs under plain Node in the tests. The main process
 * passes Electron's `net.fetch` (`opts.fetch`), which goes through the system proxy and PAC the way
 * Chromium does; Node's own fetch ignores them, so a Mac behind a proxy timed out (0.1.1).
 */

const REPO = 'Suchun-sv/meetless';
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
const API_URL = `https://api.github.com/repos/${REPO}`;
/** The only hosts a release download may be redirected to (GitHub's release-asset CDNs), always over https. */
export const REDIRECT_HOSTS: ReadonlySet<string> = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
/** Caps: a manifest is a few hundred bytes, a macOS zip about 120 MB. */
export const MANIFEST_MAX_BYTES = 256 * 1024;
export const ZIP_MAX_BYTES = 1024 ** 3;
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

/** Strict x.y.z compare (a pre-release suffix sorts before its release); anything that is not semver is never newer. */
export function newer(a: string, b: string): boolean {
  const parse = (v: string) => {
    const s = v.replace(/^v/, '');
    if (!SEMVER.test(s)) return null;
    const [core = '', ...pre] = s.split('-');
    return { nums: core.split('.').map(Number), pre: pre.join('-') };
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
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

/** The zip the macOS updater takes for `arch`: exactly the name electron-builder gives it. */
export function macZipName(version: string, arch: string): string | null {
  return SEMVER.test(version) && (arch === 'arm64' || arch === 'x64') ? `Meetless-${version}-mac-${arch}.zip` : null;
}

/** The fetch the updater uses: Electron's `net.fetch` in the app, the global one in tests. */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** A URL the updater may read from: https on `REDIRECT_HOSTS`, or the configured base's own origin (a test or dev server). */
export function allowed(u: URL, home: string): boolean {
  return u.origin === home || (u.protocol === 'https:' && REDIRECT_HOSTS.has(u.hostname));
}

/**
 * GET that follows redirects (Electron's `net.fetch` cancels a `manual` one) and then checks the
 * URL it ended at: https on `REDIRECT_HOSTS`, or the base's own origin. Anything else is refused
 * before the body is read.
 */
export async function fetchPinned(f: FetchFn, url: string, base: string, signal: AbortSignal): Promise<Response> {
  const home = new URL(base).origin;
  const res = await f(url, { redirect: 'follow', signal });
  const at = new URL(res.url || url);
  if (!allowed(at, home)) {
    await res.body?.cancel().catch(() => undefined);
    throw new UpdateError('UPDATE_DOWNLOAD', `redirect to ${at.protocol}//${at.host} refused`);
  }
  return res;
}

/** An error message fit for the log: any URL in it cut to its origin (no path, query or credentials). */
export function safeReason(e: unknown): string {
  const err = e as (Error & { cause?: { code?: string; message?: string } }) | null;
  const msg = String(err?.message ?? e);
  const cause = err?.cause?.code ?? err?.cause?.message;
  return `${msg}${cause ? ` (${cause})` : ''}`.replace(/\bhttps?:\/\/[^\s'"]+/g, (m) => {
    try {
      return new URL(m).origin;
    } catch {
      return '<url>';
    }
  });
}

/** The proxy rule for a URL as Chromium resolved it (`DIRECT`, `PROXY host:port; ...`), with any user:pass@ dropped. */
export function proxyHosts(rule: string): string {
  return rule
    .split(';')
    .map((r) => r.trim().replace(/\/\/[^@\s/]*@/, '//').replace(/^(\w+)\s+[^@\s]*@/, '$1 '))
    .filter(Boolean)
    .join('; ');
}

/** The body as text, refusing more than `max` bytes. */
async function textCapped(res: Response, max: number): Promise<string> {
  if (Number(res.headers.get('content-length') ?? 0) > max) throw new UpdateError('UPDATE_DOWNLOAD', 'response too large');
  const chunks: Buffer[] = [];
  let got = 0;
  for await (const c of Readable.fromWeb(res.body as WebReadableStream)) {
    got += (c as Buffer).length;
    if (got > max) throw new UpdateError('UPDATE_DOWNLOAD', 'response too large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const run = (cmd: string, args: string[]) =>
  new Promise<void>((done, fail) => execFile(cmd, args, (e) => (e ? fail(e) : done())));

/** macOS: ditto keeps the bundle's symlinks, modes and signature; elsewhere (tests) unzip. */
function defaultUnzip(platform: NodeJS.Platform) {
  return (zip: string, dir: string) => (platform === 'darwin' ? run('ditto', ['-x', '-k', zip, dir]) : run('unzip', ['-q', zip, '-d', dir]));
}

/** Windows and the AppImage: electron-updater downloads and checks in the background, and installs when the app quits. */
export async function electronUpdaterDownload(progress: (percent: number) => void): Promise<void> {
  const { autoUpdater } = await import('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  const found = await autoUpdater.checkForUpdates();
  if (!found?.isUpdateAvailable) throw new UpdateError('UPDATE_NONE');
  autoUpdater.on('download-progress', (p: { percent: number }) => progress(Math.round(p.percent)));
  await autoUpdater.downloadUpdate();
}

/** The click on Windows and the AppImage: install what was downloaded and restart. */
export async function electronUpdaterApply(): Promise<void> {
  const { autoUpdater } = await import('electron-updater');
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
  /** macOS: codesign the unpacked bundle against the pinned requirement; tests pass a fake. */
  verifySignature?: (app: string) => Promise<void>;
  /** Windows and the AppImage: the background download, and the click's install (tests pass fakes). */
  electronUpdater?: (progress: (percent: number) => void) => Promise<void>;
  electronUpdaterApply?: () => Promise<void>;
  /** macOS: restart into the swapped bundle. */
  relaunch?: () => void;
  onChange?: (s: UpdateState) => void;
  log?: (msg: string) => void;
  /** Every network call goes through this: Electron's `net.fetch` in the app (system proxy and PAC). Default: the global fetch. */
  fetch?: FetchFn;
  /** For the log when a check fails: the proxy Chromium uses for a URL (`session.resolveProxy`). */
  resolveProxy?: (url: string) => Promise<string>;
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
  private readonly fetch: FetchFn;

  constructor(private readonly opts: ReleaseUpdaterOptions) {
    this.fetch = opts.fetch ?? ((url, init) => fetch(url, init));
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
    if (Date.now() - this.lastCheck < 60_000 && this.state.phase !== 'failed') return Promise.resolve(this.current);
    this.inFlight ??= this.latest()
      .then((p) => {
        this.lastCheck = Date.now();
        const keep = p && this.state.available?.version === p.version ? this.state.available.notes : [];
        this.set({ available: p ? { version: p.version, notes: keep } : null, checkError: null, lastChecked: new Date().toISOString() });
        if (!p) this.discard();
        return p ? this.notes(p.tag, p.version).then((notes) => ({ p, notes })) : null;
      })
      .then((found) => {
        if (found && this.state.available) this.set({ available: { ...this.state.available, notes: found.notes } });
        // Downloaded and checked in the background; the user decides when it is installed.
        if (found) void this.prepare(found.p);
        return this.current;
      })
      .catch(async (e: unknown) => {
        const proxy = await this.opts.resolveProxy?.(this.base).then(proxyHosts, () => 'unknown');
        this.opts.log?.(`update check failed: ${safeReason(e)}${proxy ? `; proxy: ${proxy}` : ''}`);
        // The UI offers a retry; what was found before stays offered.
        this.set({ checkError: 'UPDATE_CHECK' });
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
    const res = await fetchPinned(this.fetch, `${this.base}/latest/download/${manifestName(this.opts.platform)}`, this.base, AbortSignal.timeout(15_000));
    if (res.status === 404) return null;
    if (!res.ok || !res.body) throw new Error(`manifest: HTTP ${res.status}`);
    const { version, files } = parseManifest(await textCapped(res, MANIFEST_MAX_BYTES));
    if (!version) return null;
    // The version becomes a tag in a URL path: strict semver only, so it can never traverse.
    if (!SEMVER.test(version)) throw new UpdateError('UPDATE_UNTRUSTED', `manifest version is not semver: ${JSON.stringify(version.slice(0, 40))}`);
    if (!newer(version, this.opts.currentVersion)) return null;
    return { version, tag: `v${version}`, files };
  }

  /** The notes from the GitHub API when it answers; a plain line when it does not. */
  private async notes(tag: string, version: string): Promise<string[]> {
    try {
      const res = await this.fetch(`${this.api}/releases/tags/${tag}`, {
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

  /** A release downloaded and checked in the background; swapped in on the click, or when the app quits. */
  private prepared: { version: string; work: string; app: string } | null = null;
  private preparing: Promise<void> | null = null;

  private fail(e: unknown, what: string): string {
    const errno = (e as NodeJS.ErrnoException).code;
    const code = e instanceof UpdateError ? e.code : e instanceof VerifyError ? 'UPDATE_UNTRUSTED' : errno === 'EACCES' || errno === 'EPERM' || errno === 'EROFS' ? 'UPDATE_PERMISSION' : 'UPDATE_FAILED';
    this.opts.log?.(`update ${what} failed (${code}): ${safeReason(e)}`);
    this.set({ phase: 'failed', percent: null, error: code });
    return code;
  }

  private discard(): void {
    if (this.prepared?.work) rmSync(this.prepared.work, { recursive: true, force: true });
    this.prepared = null;
  }

  /** Background: download and check `p` so that installing it is only a swap. Never throws. */
  private prepare(p: Pending): Promise<void> {
    if (this.prepared?.version === p.version || this.opts.kind === 'manual') return Promise.resolve();
    this.preparing ??= (async () => {
      try {
        this.set({ phase: 'downloading', percent: null, error: null });
        if (this.opts.kind === 'mac') {
          const r = await this.prepareMac(p);
          this.discard();
          this.prepared = { version: p.version, ...r };
        } else {
          await (this.opts.electronUpdater ?? electronUpdaterDownload)((percent) => this.progress(percent));
          this.prepared = { version: p.version, work: '', app: '' };
        }
        this.set({ phase: 'ready', percent: null, error: null });
      } catch (e) {
        this.fail(e, 'download');
      } finally {
        this.preparing = null;
      }
    })();
    return this.preparing;
  }

  /** The user's click: install the release (downloaded in the background, or now) and restart into it. */
  async install(): Promise<Result<object>> {
    if (this.busy()) return { ok: false, code: 'UPDATE_BUSY' };
    try {
      if (this.opts.kind === 'manual') throw new UpdateError('UPDATE_MANUAL');
      if (!this.prepared) {
        const p = await this.latest().catch((e: unknown) => {
          throw e instanceof UpdateError ? e : new UpdateError('UPDATE_DOWNLOAD', String((e as Error).message ?? e));
        });
        if (!p) throw new UpdateError('UPDATE_NONE');
        await this.prepare(p);
        if (!this.prepared) throw new UpdateError(this.state.error ?? 'UPDATE_FAILED');
      }
      this.set({ phase: 'installing', percent: null, error: null });
      if (this.opts.kind === 'mac') {
        const bundle = this.opts.bundlePath!;
        swapBundle(bundle, this.prepared.app);
        this.discard();
        this.set({ phase: 'restarting', percent: null });
        this.opts.relaunch?.();
      } else {
        this.set({ phase: 'restarting', percent: null });
        await (this.opts.electronUpdaterApply ?? electronUpdaterApply)();
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, code: this.fail(e, 'install') };
    }
  }

  /**
   * The app is quitting with a release ready (the user never clicked): it is swapped in now, so the
   * next start runs it, as Paseo's installAppUpdateOnQuit does. electron-updater does this itself
   * (autoInstallOnAppQuit). Synchronous: it runs in will-quit.
   */
  installOnQuit(): void {
    if (this.opts.kind !== 'mac' || !this.prepared?.app || !this.opts.bundlePath) return;
    try {
      swapBundle(this.opts.bundlePath, this.prepared.app);
      this.opts.log?.(`update ${this.prepared.version} installed on quit`);
    } catch (e) {
      this.opts.log?.(`update install on quit failed: ${safeReason(e)}`);
    }
    this.discard();
  }

  private progress(percent: number): void {
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    if (p !== this.state.percent) this.set({ phase: 'downloading', percent: p });
  }

  /** Downloads the zip, checks it and unpacks a checked, signed Meetless.app next to the running one. */
  private async prepareMac(p: Pending): Promise<{ work: string; app: string }> {
    const bundle = this.opts.bundlePath;
    if (!bundle || !bundle.endsWith('.app')) throw new UpdateError('UPDATE_FAILED', `not an app bundle: ${bundle}`);
    const want = macZipName(p.version, this.opts.arch);
    const file = want ? p.files.find((f) => f.url === want) : undefined;
    if (!file) throw new UpdateError('UPDATE_FAILED', `no ${want ?? `zip for ${this.opts.arch}`} in ${p.tag}`);
    if (!file.sha512) throw new UpdateError('UPDATE_CHECKSUM', 'the manifest has no sha512');
    if (!(file.size > 0 && file.size <= ZIP_MAX_BYTES)) throw new UpdateError('UPDATE_DOWNLOAD', `bad size ${file.size} for ${file.url}`);

    // Leftovers of an earlier run that never installed.
    for (const n of readdirSync(dirname(bundle))) if (n.startsWith('.Meetless-update-') && join(dirname(bundle), n) !== this.prepared?.work) rmSync(join(dirname(bundle), n), { recursive: true, force: true });
    // Next to the running bundle, so the swap is two renames on one volume.
    const work = mkdtempSync(join(dirname(bundle), '.Meetless-update-'));
    try {
      const zip = join(work, 'update.zip');
      const res = await fetchPinned(this.fetch, `${this.base}/download/${p.tag}/${encodeURIComponent(file.url)}`, this.base, AbortSignal.timeout(30 * 60_000));
      if (!res.ok || !res.body) throw new UpdateError('UPDATE_DOWNLOAD', `download: HTTP ${res.status}`);
      const length = res.headers.get('content-length');
      if (length !== null && Number(length) !== file.size) throw new UpdateError('UPDATE_DOWNLOAD', `size ${length} is not the manifest's ${file.size}`);
      const hash = createHash('sha512');
      let got = 0;
      const count = new Transform({
        transform: (chunk: Buffer, _enc, done) => {
          got += chunk.length;
          // Never write more than the manifest says: a bad redirect target cannot fill the disk.
          if (got > file.size) return done(new UpdateError('UPDATE_DOWNLOAD', `more than the manifest's ${file.size} bytes`));
          hash.update(chunk);
          this.progress((got / file.size) * 100);
          done(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body as WebReadableStream), count, createWriteStream(zip)).catch((e: unknown) => {
        throw e instanceof UpdateError ? e : new UpdateError('UPDATE_DOWNLOAD', String((e as Error).message ?? e));
      });
      if (got !== file.size) throw new UpdateError('UPDATE_DOWNLOAD', `got ${got} of ${file.size} bytes`);
      if (hash.digest('base64') !== file.sha512) throw new UpdateError('UPDATE_CHECKSUM', `sha512 mismatch for ${file.url}`);
      this.progress(100);

      // Nothing is unpacked until the entries are known to stay inside Meetless.app.
      checkZip(zipEntries(zip));
      const unpacked = join(work, 'app');
      await (this.opts.unzip ?? defaultUnzip(this.opts.platform))(zip, unpacked);
      rmSync(zip, { force: true });
      const app = checkUnpacked(unpacked);
      const info = await bundleInfo(app, this.opts.platform);
      if (info.id !== BUNDLE_ID) throw new VerifyError(`bundle id ${info.id}`);
      if (info.version !== p.version) throw new VerifyError(`bundle version ${info.version} is not the manifest's ${p.version}`);
      if (!newer(info.version, this.opts.currentVersion)) throw new VerifyError(`bundle version ${info.version} is not newer than ${this.opts.currentVersion}`);
      await (this.opts.verifySignature ?? ((a: string) => verifySignature(a, this.opts.platform)))(app);
      return { work, app };
    } catch (e) {
      rmSync(work, { recursive: true, force: true });
      throw e;
    }
  }
}
