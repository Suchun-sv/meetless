// Runs the packaged app's headless smoke mode (MEETLESS_SMOKE=1) and checks its JSON result.
// No window is created and the Dock icon is hidden; userData and the client data dir are
// temp dirs that the app removes itself. Usage: node scripts/smoke-packaged.mjs [path/to/binary] [--out result.json]
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const desktop = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? resolve(args[outIdx + 1]) : null;
const positional = args.filter((_, i) => i !== outIdx && i !== outIdx + 1);
const defaultBin =
  process.platform === 'darwin' ? 'release/dist/mac-arm64/Meetless.app/Contents/MacOS/Meetless' : 'release/dist/linux-unpacked/meetless';
const bin = resolve(desktop, positional[0] ?? defaultBin);
if (!existsSync(bin)) {
  console.error(`packaged binary not found: ${bin}`);
  process.exit(2);
}

const { ELECTRON_RUN_AS_NODE: _drop, MEETLESS_USER_DATA_DIR: _u, MEETLESS_CLIENT_DATA_DIR: _c, ...env } = process.env;
const r = spawnSync(bin, [], { env: { ...env, MEETLESS_SMOKE: '1' }, encoding: 'utf8', timeout: 90_000 });
const line = (r.stdout ?? '').split('\n').reverse().find((l) => l.startsWith('{"meetlessSmoke"'));
if (!line) {
  console.error(`no smoke JSON (exit ${r.status}, signal ${r.signal})\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  process.exit(1);
}
const result = JSON.parse(line);
if (outFile) writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
for (const c of result.checks) console.error(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}`);
console.error(`exit ${r.status}; overall ${result.ok ? 'PASS' : 'FAIL'}`);
process.exit(result.ok && r.status === 0 ? 0 : 1);
