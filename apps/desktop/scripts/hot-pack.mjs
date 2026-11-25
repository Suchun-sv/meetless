// Packs the built app code (dist/: main, preload, renderer, boot, build.json, shell.json; no
// Electron, no source maps) into hot.zip, and writes hot.json: the signed manifest a hot update is
// checked against (src/main/hot-update.ts). Signed with Ed25519 by Node crypto, from the PEM in
// $HOT_SIGNING_KEY (or the file $HOT_SIGNING_KEY_FILE). Usage: node scripts/hot-pack.mjs <out-dir>
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const out = process.argv[2] ?? 'release/hot';
const pem = process.env.HOT_SIGNING_KEY || (process.env.HOT_SIGNING_KEY_FILE ? readFileSync(process.env.HOT_SIGNING_KEY_FILE, 'utf8') : '');
if (!pem) throw new Error('HOT_SIGNING_KEY (or HOT_SIGNING_KEY_FILE) is not set');

const files = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
const entries = files('dist')
  .filter((f) => !f.endsWith('.map') && !f.startsWith(join('dist', 'meta')))
  .sort()
  .map((f) => ({ name: relative('.', f).split('\\').join('/'), data: readFileSync(f) }));

// A plain zip: deflate, regular files with mode 0644, no directories, no symlinks.
const locals = [];
const central = [];
let offset = 0;
for (const e of entries) {
  const name = Buffer.from(e.name, 'utf8');
  const comp = deflateRawSync(e.data, { level: 9 });
  const crc = crc32(e.data);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0x0800, 6);
  lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(e.data.length, 22);
  lh.writeUInt16LE(name.length, 26);
  locals.push(lh, name, comp);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE((3 << 8) | 20, 4);
  ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(8, 10);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(comp.length, 20);
  ch.writeUInt32LE(e.data.length, 24);
  ch.writeUInt16LE(name.length, 28);
  ch.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  ch.writeUInt32LE(offset, 42);
  central.push(ch, name);
  offset += lh.length + name.length + comp.length;
}
const cd = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(entries.length, 8);
eocd.writeUInt16LE(entries.length, 10);
eocd.writeUInt32LE(cd.length, 12);
eocd.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...locals, cd, eocd]);

const build = JSON.parse(readFileSync('dist/build.json', 'utf8'));
const shell = JSON.parse(readFileSync('dist/shell.json', 'utf8'));
// Named by commit, so a client holding this manifest never finds the file replaced under it.
const file = `hot-${build.commit.slice(0, 12)}.zip`;
const manifest = JSON.stringify({
  commit: build.commit,
  version: build.version,
  built: build.built,
  parts: build.parts,
  shell,
  file,
  sha512: createHash('sha512').update(zip).digest('base64'),
  size: zip.length,
});
const signature = sign(null, Buffer.from(manifest, 'utf8'), createPrivateKey(pem)).toString('base64');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, file), zip);
writeFileSync(join(out, 'hot.zip'), zip);
writeFileSync(join(out, 'hot.json'), `${JSON.stringify({ manifest, signature })}\n`);
console.log(`${out}/${file} (${zip.length} bytes, ${entries.length} files) and hot.json for ${build.commit.slice(0, 12)}`);
