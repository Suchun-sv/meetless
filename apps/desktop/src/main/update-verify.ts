import { execFile } from 'node:child_process';
import { closeSync, fstatSync, lstatSync, openSync, readdirSync, readFileSync, readlinkSync, readSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Checks the macOS updater runs on a downloaded release before it replaces the running app
 * (release-updater.ts). The SHA-512 in latest-mac.yml only proves the zip is the one the release
 * lists; these checks prove it is a Meetless build, of the version the manifest names, and that
 * unpacking it cannot write outside the work folder.
 *
 * Order: `checkZip` (the central directory, before anything is written), unpack,
 * `checkUnpacked` (what is on disk), `bundleInfo` (Info.plist), `verifySignature` (codesign).
 * This module never imports electron, so it runs under plain Node in the tests.
 */

export const BUNDLE_ID = 'app.meetless.desktop';
export const APP_NAME = 'Meetless.app';

/**
 * SHA-1 of the DER certificate "Meetless Self-Signed" (code-signing EKU, valid to 2036) that signs
 * every release. A new certificate means a new value here, and a release signed with it is refused
 * by every build that carries the old one (docs/RELEASE.md).
 */
export const SIGNING_CERT_SHA1 = '82bc2a6ba70dc9bca75d806fc4f3a07ac1a7f7cc';

/** The designated requirement a downloaded bundle must satisfy. */
export const MAC_REQUIREMENT = `identifier "${BUNDLE_ID}" and certificate leaf = H"${SIGNING_CERT_SHA1}"`;

/** x.y.z with an optional pre-release; nothing else (no "v", no build metadata, no path characters). */
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;

/** Limits for the zip: more than this is not a Meetless build (v0.1.0 has 134 entries, 330 MB unpacked). */
export const ZIP_MAX_ENTRIES = 20_000;
export const ZIP_MAX_UNPACKED = 2 * 1024 ** 3;

/** A check that failed: the UI shows `upd.err.UPDATE_UNTRUSTED`. */
export class VerifyError extends Error {}

export interface ZipEntry {
  name: string;
  /** Unix mode from the external attributes (0 when the zip was not made on Unix). */
  mode: number;
  size: number;
}

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

function readAt(fd: number, pos: number, len: number): Buffer {
  const b = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const n = readSync(fd, b, got, len - got, pos + got);
    if (n === 0) break;
    got += n;
  }
  return b.subarray(0, got);
}

/** The entries of a zip, from its central directory (zip64 included). Nothing is decompressed. */
export function zipEntries(file: string): ZipEntry[] {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const tailLen = Math.min(size, 22 + 0xffff);
    const tail = readAt(fd, size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new VerifyError('not a zip: no end of central directory');
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const loc = eocd - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) throw new VerifyError('zip64 locator missing');
      const z64 = readAt(fd, Number(tail.readBigUInt64LE(loc + 8)), 56);
      if (z64.length < 56 || z64.readUInt32LE(0) !== 0x06064b50) throw new VerifyError('zip64 record missing');
      count = Number(z64.readBigUInt64LE(32));
      cdSize = Number(z64.readBigUInt64LE(40));
      cdOffset = Number(z64.readBigUInt64LE(48));
    }
    if (count > ZIP_MAX_ENTRIES) throw new VerifyError(`too many entries: ${count}`);
    if (cdOffset + cdSize > size) throw new VerifyError('central directory out of range');
    const cd = readAt(fd, cdOffset, cdSize);
    const entries: ZipEntry[] = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw new VerifyError('bad central directory entry');
      const host = cd.readUInt16LE(p + 4) >> 8;
      let usize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const attrs = cd.readUInt32LE(p + 38);
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');
      if (usize === 0xffffffff) {
        // zip64 extended information: the uncompressed size comes first.
        const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
        for (let q = 0; q + 4 <= extra.length; ) {
          const id = extra.readUInt16LE(q);
          const len = extra.readUInt16LE(q + 2);
          if (id === 0x0001 && len >= 8) usize = Number(extra.readBigUInt64LE(q + 4));
          q += 4 + len;
        }
      }
      entries.push({ name, mode: host === 3 ? attrs >>> 16 : 0, size: usize });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    closeSync(fd);
  }
}

/**
 * Before unpacking: every entry sits under `Meetless.app/`, with no absolute path, no `..`, no
 * backslash or NUL, no device or setuid file, no duplicate, and nothing written through a symlink
 * entry. Symlinks themselves are allowed (Electron's frameworks use them); where they point is
 * checked on disk by `checkUnpacked`.
 */
export function checkZip(entries: ZipEntry[], appName = APP_NAME): void {
  const seen = new Set<string>();
  const links: string[] = [];
  let total = 0;
  for (const e of entries) {
    const n = e.name;
    if (!n || n.includes('\0') || n.includes('\\')) throw new VerifyError(`bad entry name ${JSON.stringify(n)}`);
    if (n.startsWith('/') || /^[A-Za-z]:/.test(n)) throw new VerifyError(`absolute entry ${n}`);
    const parts = n.replace(/\/$/, '').split('/');
    if (parts.some((s) => s === '..' || s === '.' || s === '')) throw new VerifyError(`bad path in ${n}`);
    if (parts[0] !== appName) throw new VerifyError(`entry outside ${appName}: ${n}`);
    const key = parts.join('/');
    if (seen.has(key)) throw new VerifyError(`duplicate entry ${n}`);
    seen.add(key);
    const type = e.mode & S_IFMT;
    if (e.mode !== 0 && type !== S_IFREG && type !== S_IFDIR && type !== S_IFLNK) throw new VerifyError(`special file ${n}`);
    if (e.mode & 0o6000) throw new VerifyError(`setuid or setgid ${n}`);
    if (type === S_IFLNK) links.push(key);
    total += e.size;
    if (total > ZIP_MAX_UNPACKED) throw new VerifyError('unpacked size too large');
  }
  for (const key of seen) {
    for (const l of links) if (key.startsWith(`${l}/`)) throw new VerifyError(`entry ${key} is written through the symlink ${l}`);
  }
}

/**
 * After unpacking: the folder holds exactly `Meetless.app`, a real directory (not a symlink), and
 * every symlink inside it is relative and stays inside it.
 */
export function checkUnpacked(dir: string, appName = APP_NAME): string {
  const names = readdirSync(dir);
  if (names.length !== 1 || names[0] !== appName) throw new VerifyError(`expected only ${appName}, found ${names.join(', ')}`);
  const app = join(dir, appName);
  const st = lstatSync(app);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new VerifyError(`${appName} is not a directory`);
  const walk = (d: string): void => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isSymbolicLink()) {
        const target = readlinkSync(p);
        const rel = relative(app, resolve(dirname(p), target));
        if (isAbsolute(target) || rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
          throw new VerifyError(`symlink ${relative(dir, p)} points outside the bundle`);
        }
      } else if (ent.isDirectory()) walk(p);
      else if (!ent.isFile()) throw new VerifyError(`special file ${relative(dir, p)}`);
    }
  };
  walk(app);
  return app;
}

const run = (cmd: string, args: string[]) =>
  new Promise<string>((done, fail) => execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024 }, (e, out) => (e ? fail(e) : done(String(out)))));

/** `CFBundleIdentifier` and `CFBundleShortVersionString` from the bundle's Info.plist (XML; a binary plist is converted with plutil on macOS). */
export async function bundleInfo(app: string, platform: NodeJS.Platform = process.platform): Promise<{ id: string | null; version: string | null }> {
  const file = join(app, 'Contents', 'Info.plist');
  let xml = readFileSync(file).toString('utf8');
  if (xml.startsWith('bplist')) {
    if (platform !== 'darwin') throw new VerifyError('binary Info.plist');
    xml = await run('plutil', ['-convert', 'xml1', '-o', '-', file]);
  }
  const key = (k: string) => new RegExp(`<key>${k}</key>\\s*<string>([^<]*)</string>`).exec(xml)?.[1] ?? null;
  return { id: key('CFBundleIdentifier'), version: key('CFBundleShortVersionString') };
}

/** The codesign arguments that check `app` against the pinned requirement. */
export function codesignArgs(app: string): string[] {
  return ['--verify', '--deep', '--strict', '-R', `=${MAC_REQUIREMENT}`, app];
}

/** codesign: the bundle is intact, every nested item too, and it is signed by the Meetless certificate. */
export async function verifySignature(app: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform !== 'darwin') throw new VerifyError('codesign needs macOS');
  await run('codesign', codesignArgs(app)).catch((e: unknown) => {
    throw new VerifyError(`codesign: ${String((e as Error).message ?? e).slice(0, 300)}`);
  });
}
