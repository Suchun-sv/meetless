#!/usr/bin/env node
// OnlyOffice DocumentServer for read-only artifact viewing (U3; design §8.5, contract §12.6).
//   node infra/dev/onlyoffice/onlyoffice.mjs start | stop | status | check
// Two containers on meetless-dev-net, both in compose profile "onlyoffice":
//   meetless-onlyoffice        DocumentServer 8.3 with JWT on, published on 127.0.0.1:55435 only.
//   meetless-onlyoffice-files  relay.py: TCP 8080 inside the network to the server's Unix socket
//                              <dataDir>/office-sock/files.sock (mounted read-only). No published port.
// Rootless Docker here runs with --disable-host-loopback, so no container can reach the host's 127.0.0.1;
// DocumentServer fetches files through the relay instead (MEETLESS_PUBLIC_URL).
// This script never removes containers, networks or volumes, and never stops or kills anything it did not start.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const COMPOSE_FILE = 'infra/dev/compose.yaml';

export const ONLYOFFICE = Object.freeze({
  name: 'meetless-onlyoffice',
  image: 'onlyoffice/documentserver:8.3',
  host: '127.0.0.1',
  port: 55435,
  envFile: resolve(HERE, '.env.local'),
});
export const RELAY = Object.freeze({ name: 'meetless-onlyoffice-files', image: 'meetless-office:dev', port: 8080 });
export const ONLYOFFICE_URL = `http://${ONLYOFFICE.host}:${ONLYOFFICE.port}`;
export const DEFAULT_PUBLIC_URL = `http://${RELAY.name}:${RELAY.port}`;
// The socket server serves only /v1/office-files/:ticket, so this answers 4xx once it is up.
export const PROBE_PATH = '/v1/office-files/healthcheck-probe';
const NAMES = [ONLYOFFICE.name, RELAY.name];
const OUR_IMAGE = new Map([[ONLYOFFICE.name, ONLYOFFICE.image], [RELAY.name, RELAY.image]]);
const START_TIMEOUT_MS = 180_000;

const HEX64 = /^[0-9a-f]{64}$/;

/** Writes the JWT secret file if it is missing (mode 0600). Never overwrites, never prints the secret. */
export function ensureEnv(file, rand = () => randomBytes(32).toString('hex')) {
  if (existsSync(file)) return { created: false };
  const secret = rand();
  if (!HEX64.test(secret)) throw new Error('ensureEnv: the secret must be 64 lower-case hex characters');
  mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileSync(file, `JWT_ENABLED=true\nJWT_SECRET=${secret}\nMEETLESS_ONLYOFFICE_JWT_SECRET=${secret}\n`, { flag: 'wx', mode: 0o600 });
  } catch (e) {
    if (e.code === 'EEXIST') return { created: false };
    throw e;
  }
  chmodSync(file, 0o600);
  return { created: true };
}

/** Host directory of the server's office-files socket, bind-mounted read-only into the relay at /run/meetless. */
export function sockDir(env = process.env) {
  if (env.MEETLESS_OFFICE_SOCK_DIR) return resolve(REPO, env.MEETLESS_OFFICE_SOCK_DIR);
  return resolve(REPO, env.MEETLESS_DATA_DIR || '.data/u3/server', 'office-sock');
}

const publishes = (ports, port) => new RegExp(`:${port}->`).test(ports ?? '');

/**
 * Reasons not to start. `ps` is every container (`docker ps -a`); `portHeldByOther` is true when
 * 127.0.0.1:55435 is taken by something other than our own running DocumentServer.
 */
export function conflicts(ps, portHeldByOther) {
  const out = [];
  for (const c of ps) {
    const want = OUR_IMAGE.get(c.name);
    if (want && c.image !== want) out.push(`container ${c.name} exists from image ${c.image}, not ${want}; it is left alone`);
    else if (!want && publishes(c.ports, ONLYOFFICE.port)) out.push(`container ${c.name} publishes port ${ONLYOFFICE.port}`);
  }
  if (portHeldByOther) out.push(`port ${ONLYOFFICE.host}:${ONLYOFFICE.port} is held by something other than ${ONLYOFFICE.name}`);
  return out;
}

/** The docker commands for start, stop and status. None removes anything. */
export function commandsFor(cmd) {
  switch (cmd) {
    case 'start':
      return [['docker', 'compose', '-f', COMPOSE_FILE, '--profile', 'onlyoffice', 'up', '-d', ...NAMES]];
    case 'stop':
      return [['docker', 'stop', ...NAMES]];
    case 'status':
      return [['docker', 'ps', '-a', ...NAMES.flatMap((n) => ['--filter', `name=^${n}$`]), '--format', 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}']];
    default:
      throw new Error(`commandsFor: unknown command ${cmd}`);
  }
}

/**
 * The verdict of `curl -s -o /dev/null -w '%{http_code}'` run inside meetless-onlyoffice against the relay.
 * Any HTTP status means the DocumentServer can reach the server; 000 or no output means it cannot.
 */
export function probeVerdict({ stdout = '', stderr = '', error } = {}) {
  const code = String(stdout).trim();
  if (/^[1-5]\d\d$/.test(code)) return 'reachable';
  const last = String(stderr).trim().split('\n').filter(Boolean).pop();
  const why = error || last || (code && code !== '000' ? `unexpected output ${code}` : 'no HTTP response (code 000)');
  return `unreachable: ${why}`;
}

// --- CLI -------------------------------------------------------------------------------------------

function run(argv, opts = {}) {
  return spawnSync(argv[0], argv.slice(1), { cwd: REPO, encoding: 'utf8', ...opts });
}

function dockerPs() {
  const r = run(['docker', 'ps', '-a', '--no-trunc', '--format', '{{json .}}']);
  if (r.error || r.status !== 0) throw new Error(`docker ps failed: ${r.error?.message ?? r.stderr.trim()}`);
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .map((c) => ({ name: c.Names, image: c.Image, ports: c.Ports ?? '', state: c.State ?? '' }));
}

function portInUse(host, port) {
  return new Promise((res) => {
    const s = createServer();
    s.once('error', (e) => res(e.code === 'EADDRINUSE' || e.code === 'EACCES'));
    s.listen(port, host, () => s.close(() => res(false)));
  });
}

async function healthBody() {
  try {
    const r = await fetch(`${ONLYOFFICE_URL}/healthcheck`, { signal: AbortSignal.timeout(3000) });
    return (await r.text()).trim();
  } catch (e) {
    return `error: ${e.cause?.code ?? e.message}`;
  }
}

async function start() {
  const env = ensureEnv(ONLYOFFICE.envFile);
  console.log(env.created ? `wrote ${ONLYOFFICE.envFile} (mode 0600)` : `using ${ONLYOFFICE.envFile}`);
  const ps = dockerPs();
  const ownHolds = ps.some((c) => c.name === ONLYOFFICE.name && c.image === ONLYOFFICE.image && c.state === 'running' && publishes(c.ports, ONLYOFFICE.port));
  const found = conflicts(ps, (await portInUse(ONLYOFFICE.host, ONLYOFFICE.port)) && !ownHolds);
  if (found.length) {
    for (const f of found) console.error(`conflict: ${f}`);
    process.exit(1);
  }
  const dir = sockDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const argv of commandsFor('start')) {
    const r = run(argv, { stdio: 'inherit', env: { ...process.env, MEETLESS_OFFICE_SOCK_DIR: dir } });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  const deadline = Date.now() + START_TIMEOUT_MS;
  let body = '';
  while ((body = await healthBody()) !== 'true') {
    if (Date.now() > deadline) {
      console.error(`${ONLYOFFICE.name} not healthy after ${START_TIMEOUT_MS / 1000} s (last: ${body.slice(0, 80)})`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`${ONLYOFFICE.name} ready: ${ONLYOFFICE_URL}`);
  console.log(`MEETLESS_ONLYOFFICE_URL=${ONLYOFFICE_URL}`);
  console.log(`MEETLESS_PUBLIC_URL=${DEFAULT_PUBLIC_URL}`);
  console.log(`MEETLESS_OFFICE_FILES_SOCKET=${resolve(dir, 'files.sock')}`);
}

async function check() {
  const body = await healthBody();
  if (body !== 'true') {
    console.log(`unreachable: ${ONLYOFFICE_URL}/healthcheck answered ${JSON.stringify(body.slice(0, 80))}`);
    process.exit(1);
  }
  const url = `${(process.env.MEETLESS_PUBLIC_URL || DEFAULT_PUBLIC_URL).replace(/\/+$/, '')}${PROBE_PATH}`;
  const r = run(['docker', 'exec', ONLYOFFICE.name, 'curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '10', url]);
  const verdict = probeVerdict({ stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error?.message });
  console.log(verdict);
  if (verdict !== 'reachable') process.exit(1);
}

function passthrough(cmd) {
  for (const argv of commandsFor(cmd)) {
    const r = run(argv, { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const cmd = process.argv[2];
  if (cmd === 'start') await start();
  else if (cmd === 'check') await check();
  else if (cmd === 'stop' || cmd === 'status') passthrough(cmd);
  else {
    console.error('usage: node infra/dev/onlyoffice/onlyoffice.mjs start | stop | status | check');
    process.exit(1);
  }
}
