import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { checkZip, VerifyError, zipEntries, type ZipEntry } from './update-verify';
import { fetchPinned, type FetchFn } from './release-updater';
// Plain CommonJS shared with the boot loader (src/boot/boot.cjs): the state file and the shell rule.
import * as pick from '../boot/pick.cjs';

/**
 * Hot updates from the beta channel, the way Gleeok's work. Every push to main builds the app code
 * alone (dist/: main, preload, renderer; no Electron) into the rolling `hot` prerelease as
 * hot-<commit>.zip and hot.json (.github/workflows/beta.yml, scripts/hot-pack.mjs). A copy is
 * unpacked into <userData>/hot/<commit>/ only after all of this holds:
 * - hot.json's manifest is signed by the Ed25519 key below;
 * - it was built for this installed shell (Electron, main-process ABI, fuses);
 * - it is newer than the code running and did not fail to start here before;
 * - the zip has the manifest's size (under a cap) and SHA-512, and its entries are plain files
 *   under dist/ (no absolute paths, .., symlinks or special files).
 * The boot loader (src/boot/boot.cjs) then runs it on the next start. A change to the renderer
 * alone is applied sooner: the window reloads into the new renderer when the user is idle.
 */

/** The public half of ~/work/meetless-signing/hot-ed25519.key (the HOT_SIGNING_KEY secret). */
export const HOT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAjn21SSA2UJ+U2qa0qysSc8Uu6B7hnYWu3wX51VUYSYQ=
-----END PUBLIC KEY-----
`;
/** The hot channel's release, then the first one (`beta`, frozen by an immutable release) as a fallback. */
export const HOT_URLS = ['https://github.com/Suchun-sv/meetless/releases/download/hot', 'https://github.com/Suchun-sv/meetless/releases/download/beta'];
export const HOT_CHECK_MS = 15 * 60_000;
const MANIFEST_MAX_BYTES = 64 * 1024;
export const HOT_MAX_BYTES = 64 * 1024 * 1024;

export interface Shell {
  electron: string;
  abi: string | number | null;
  fuses: string;
}

export interface BuildInfo {
  commit: string;
  version: string;
  built: string;
  parts: { main: string; preload: string; renderer: string };
}

export interface HotManifest extends BuildInfo {
  shell: Shell;
  file: string;
  sha512: string;
  size: number;
}

export class HotError extends Error {}

/** The manifest inside hot.json, if its Ed25519 signature checks out against `publicKey`; throws otherwise. */
export function verifyManifest(raw: string, publicKey = HOT_PUBLIC_KEY): HotManifest {
  let outer: { manifest?: unknown; signature?: unknown };
  try {
    outer = JSON.parse(raw) as typeof outer;
  } catch {
    throw new HotError('hot.json is not JSON');
  }
  if (typeof outer.manifest !== 'string' || typeof outer.signature !== 'string') throw new HotError('hot.json has no signed manifest');
  const ok = verify(null, Buffer.from(outer.manifest, 'utf8'), createPublicKey(publicKey), Buffer.from(outer.signature, 'base64'));
  if (!ok) throw new HotError('bad signature');
  const m = JSON.parse(outer.manifest) as HotManifest;
  const str = (v: unknown) => typeof v === 'string' && v.length > 0;
  if (!/^[0-9a-f]{7,40}$/.test(String(m.commit)) || !str(m.version) || Number.isNaN(Date.parse(m.built)) || !str(m.sha512)) throw new HotError('bad manifest');
  if (!/^hot-[0-9a-f]{7,12}\.zip$/.test(String(m.file)) || !Number.isSafeInteger(m.size) || m.size <= 0 || m.size > HOT_MAX_BYTES) throw new HotError('bad manifest file or size');
  if (!m.shell || !str(m.shell.electron) || !str(m.shell.fuses) || !m.parts || !str(m.parts.main) || !str(m.parts.preload) || !str(m.parts.renderer)) throw new HotError('bad manifest shell or parts');
  return m;
}

/** What applying `next` over the code running takes: a window reload when only the renderer changed. */
export function applyKind(running: BuildInfo['parts'], next: BuildInfo['parts']): 'reload' | 'restart' {
  return running.main === next.main && running.preload === next.preload ? 'reload' : 'restart';
}

/** Unpacks a checked zip (stored or deflated plain files) into `dir`. */
function unzipTo(zip: Buffer, dir: string): void {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new VerifyError('not a zip');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new VerifyError('bad central directory');
    const method = zip.readUInt16LE(p + 10);
    const csize = zip.readUInt32LE(p + 20);
    const usize = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new VerifyError(`bad local header for ${name}`);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw, { maxOutputLength: usize }) : null;
    if (!data || data.length !== usize) throw new VerifyError(`cannot unpack ${name}`);
    const to = join(dir, ...name.split('/'));
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, data);
  }
}

/** The zip entries, checked: plain files under dist/ (checkZip's rules) and no symlinks at all. */
function checkHotZip(file: string, entries: ZipEntry[]): void {
  checkZip(entries, 'dist');
  for (const e of entries) if ((e.mode & 0o170000) === 0o120000) throw new VerifyError(`symlink ${e.name} in ${file}`);
}

export interface HotState {
  /** The hot commit running now; null for the bundled code. */
  running: string | null;
  /** A verified copy waiting: applied by a reload (`reload`) or on the next start (`restart`). */
  pending: { commit: string; apply: 'reload' | 'restart' } | null;
}

export interface HotUpdaterOptions {
  hotDir: string;
  /** The code running now (its dist/build.json). */
  running: BuildInfo;
  /** The installed app's shell (its own dist/shell.json, whatever code runs). */
  shell: Shell;
  runningHot: string | null;
  fetch: FetchFn;
  baseUrl?: string;
  publicKey?: string;
  enabled?: boolean;
  log?: (m: string) => void;
  onChange?: (s: HotState) => void;
}

export class HotUpdater {
  private st: HotState;
  private inFlight: Promise<void> | null = null;
  private readonly bases: string[];

  constructor(private readonly o: HotUpdaterOptions) {
    this.bases = (o.baseUrl ? [o.baseUrl] : HOT_URLS).map((b) => b.replace(/\/$/, ''));
    this.st = { running: o.runningHot, pending: null };
  }

  get state(): HotState {
    return { ...this.st };
  }

  /** Checks on start, then every 15 minutes. Returns a stop function. */
  start(intervalMs = HOT_CHECK_MS): () => void {
    if (this.o.enabled === false) return () => undefined;
    const first = setTimeout(() => void this.check(), 10_000);
    const timer = setInterval(() => void this.check(), intervalMs);
    first.unref?.();
    timer.unref?.();
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }

  /** Looks for a newer hot build and, when it checks out, unpacks it. Never throws. */
  check(): Promise<void> {
    if (this.o.enabled === false) return Promise.resolve();
    this.inFlight ??= this.run()
      .catch((e: unknown) => this.o.log?.(`hot update: ${(e as Error).message}`))
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private async get(base: string, name: string, max: number, timeoutMs: number): Promise<Buffer | null> {
    // Redirects followed, then the final URL held to GitHub's release hosts (or the base's own origin in a dev run).
    const res = await fetchPinned(this.o.fetch, `${base}/${name}`, base, AbortSignal.timeout(timeoutMs));
    if (res.status === 404) return null;
    if (!res.ok) throw new HotError(`${name}: HTTP ${res.status}`);
    if (Number(res.headers.get('content-length') ?? 0) > max) throw new HotError(`${name} too large`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max) throw new HotError(`${name} too large`);
    return buf;
  }

  private async run(): Promise<void> {
    // The first channel that has a hot.json; the zip comes from the same one.
    let base = '';
    let raw: Buffer | null = null;
    let lastError: unknown = null;
    for (const b of this.bases) {
      try {
        raw = await this.get(b, 'hot.json', MANIFEST_MAX_BYTES, 15_000);
      } catch (e) {
        lastError = e;
        raw = null;
      }
      if (raw) {
        base = b;
        break;
      }
    }
    if (!raw) {
      if (lastError) throw lastError;
      return;
    }
    const m = verifyManifest(raw.toString('utf8'), this.o.publicKey);
    if (!pick.sameShell(m.shell, this.o.shell)) return this.o.log?.(`hot update ${m.commit.slice(0, 7)} needs another shell (${m.shell.electron}); a full release brings it`);
    const running = this.o.running;
    if (m.commit === running.commit || !(Date.parse(m.built) > Date.parse(running.built))) return;
    if (this.st.pending?.commit === m.commit) return;
    const state = pick.readState(this.o.hotDir);
    if (state.bad.includes(m.commit)) return;

    const zip = await this.get(base, m.file, m.size, 10 * 60_000);
    if (!zip) return;
    if (zip.length !== m.size) throw new HotError(`size ${zip.length} is not the manifest's ${m.size}`);
    if (createHash('sha512').update(zip).digest('base64') !== m.sha512) throw new HotError('sha512 mismatch');

    mkdirSync(this.o.hotDir, { recursive: true });
    const part = join(this.o.hotDir, `${m.commit}.part`);
    const zipFile = `${part}.zip`;
    rmSync(part, { recursive: true, force: true });
    writeFileSync(zipFile, zip);
    try {
      // Nothing is unpacked until every entry is known to be a plain file under dist/.
      checkHotZip(m.file, zipEntries(zipFile));
      unzipTo(zip, part);
      const built = JSON.parse(readFileSync(join(part, 'dist', 'build.json'), 'utf8')) as BuildInfo;
      if (built.commit !== m.commit || !existsSync(join(part, 'dist', 'main', 'main.cjs'))) throw new HotError('the zip is not the manifest commit');
      writeFileSync(join(part, '.verified'), m.sha512);
      const dest = join(this.o.hotDir, m.commit);
      rmSync(dest, { recursive: true, force: true });
      renameSync(part, dest);
    } finally {
      rmSync(zipFile, { force: true });
      rmSync(part, { recursive: true, force: true });
    }
    pick.writeState(this.o.hotDir, { ...pick.readState(this.o.hotDir), current: m.commit, booting: null });
    // Two copies at most: this one and the one running now.
    for (const name of readdirSync(this.o.hotDir)) {
      if (/^[0-9a-f]{7,40}$/.test(name) && name !== m.commit && name !== this.st.running) rmSync(join(this.o.hotDir, name), { recursive: true, force: true });
    }
    const apply = applyKind(running.parts, m.parts);
    this.o.log?.(`hot update ${m.commit.slice(0, 7)} ready (${apply})`);
    this.st = { ...this.st, pending: { commit: m.commit, apply } };
    this.o.onChange?.(this.state);
  }

  /** The new renderer's index.html, for a reload-only update. */
  rendererOf(commit: string): string {
    return join(this.o.hotDir, commit, 'dist', 'renderer', 'index.html');
  }

  /** After a reload into `commit`'s renderer: nothing is pending any more. */
  applied(commit: string): void {
    if (this.st.pending?.commit === commit) this.st = { running: this.st.running, pending: null };
    this.o.onChange?.(this.state);
  }
}
