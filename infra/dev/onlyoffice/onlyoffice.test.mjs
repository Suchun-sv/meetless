// node --test infra/dev/onlyoffice/onlyoffice.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, request } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { commandsFor, conflicts, DEFAULT_PUBLIC_URL, ensureEnv, ONLYOFFICE, probeVerdict, RELAY, sockDir } from './onlyoffice.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const tmp = mkdtempSync(join(tmpdir(), 'meetless-onlyoffice-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

// The text of one service block under `services:` in infra/dev/compose.yaml (2-space indented key).
function serviceBlock(name) {
  const lines = readFileSync(resolve(REPO, 'infra/dev/compose.yaml'), 'utf8').split('\n');
  const start = lines.indexOf(`  ${name}:`);
  assert.ok(start >= 0, `compose has service ${name}`);
  let end = start + 1;
  while (end < lines.length && !/^ {0,2}\S/.test(lines[end])) end++;
  return lines.slice(start, end).join('\n');
}

test('ONLYOFFICE names the DocumentServer container, image, loopback port and env file', () => {
  assert.deepEqual({ ...ONLYOFFICE }, {
    name: 'meetless-onlyoffice',
    image: 'onlyoffice/documentserver:8.3',
    host: '127.0.0.1',
    port: 55435,
    envFile: resolve(REPO, 'infra/dev/onlyoffice/.env.local'),
  });
  assert.equal(RELAY.name, 'meetless-onlyoffice-files');
  assert.equal(RELAY.image, 'meetless-office:dev');
  assert.equal(DEFAULT_PUBLIC_URL, 'http://meetless-onlyoffice-files:8080');
});

test('ensureEnv writes one 64-hex secret under both names with mode 0600 and never overwrites', () => {
  const f = join(tmp, 'a', '.env.local');
  assert.deepEqual(ensureEnv(f), { created: true });
  const text = readFileSync(f, 'utf8');
  const secretOf = (k) => text.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1];
  assert.match(text, /^JWT_ENABLED=true$/m);
  assert.match(text, /^JWT_SECRET=([0-9a-f]{64})$/m);
  assert.match(text, /^MEETLESS_ONLYOFFICE_JWT_SECRET=([0-9a-f]{64})$/m);
  assert.equal(secretOf('JWT_SECRET'), secretOf('MEETLESS_ONLYOFFICE_JWT_SECRET'));
  assert.equal(statSync(f).mode & 0o777, 0o600);
  assert.equal(ensureEnv(f).created, false);
  assert.equal(ensureEnv(f, () => 'f'.repeat(64)).created, false);
  assert.equal(readFileSync(f, 'utf8'), text);
});

test('ensureEnv uses the given generator, rejects a secret that is not 64 hex, and leaves an existing file alone', () => {
  const f = join(tmp, 'b.env');
  assert.equal(ensureEnv(f, () => 'ab'.repeat(32)).created, true);
  assert.match(readFileSync(f, 'utf8'), new RegExp(`^JWT_SECRET=${'ab'.repeat(32)}$`, 'm'));
  assert.throws(() => ensureEnv(join(tmp, 'c.env'), () => 'short'));
  const own = join(tmp, 'own.env');
  writeFileSync(own, 'JWT_SECRET=mine\n', { mode: 0o644 });
  assert.equal(ensureEnv(own).created, false);
  assert.equal(readFileSync(own, 'utf8'), 'JWT_SECRET=mine\n');
});

test('two fresh files get different secrets', () => {
  ensureEnv(join(tmp, 'd1.env'));
  ensureEnv(join(tmp, 'd2.env'));
  const s = (f) => readFileSync(join(tmp, f), 'utf8').match(/^JWT_SECRET=(.*)$/m)[1];
  assert.notEqual(s('d1.env'), s('d2.env'));
});

test('conflicts names a foreign meetless-onlyoffice and a port held by something else; none for our own container', () => {
  const ours = [
    { name: 'meetless-onlyoffice', image: 'onlyoffice/documentserver:8.3', ports: '127.0.0.1:55435->80/tcp' },
    { name: 'meetless-onlyoffice-files', image: 'meetless-office:dev', ports: '' },
    { name: 'meetless-pg', image: 'postgres:16-alpine', ports: '127.0.0.1:55433->5432/tcp' },
  ];
  assert.deepEqual(conflicts(ours, false), []);
  assert.deepEqual(conflicts([], false), []);

  const foreignDs = conflicts([{ name: 'meetless-onlyoffice', image: 'onlyoffice/documentserver:7.5', ports: '' }], false);
  assert.equal(foreignDs.length, 1);
  assert.match(foreignDs[0], /meetless-onlyoffice/);
  assert.match(foreignDs[0], /documentserver:7\.5/);

  const foreignRelay = conflicts([{ name: 'meetless-onlyoffice-files', image: 'nginx:alpine', ports: '' }], false);
  assert.equal(foreignRelay.length, 1);
  assert.match(foreignRelay[0], /meetless-onlyoffice-files/);
  assert.match(foreignRelay[0], /nginx:alpine/);

  const port = conflicts([], true);
  assert.equal(port.length, 1);
  assert.match(port[0], /55435/);

  const other = conflicts([{ name: 'someone-else', image: 'x:1', ports: '127.0.0.1:55435->8000/tcp' }], false);
  assert.equal(other.length, 1);
  assert.match(other[0], /someone-else/);
  assert.match(other[0], /55435/);
});

test('the compose service binds 127.0.0.1:55435 only, uses the 8.3 image, the onlyoffice profile and an optional env file', () => {
  const ds = serviceBlock('meetless-onlyoffice');
  assert.match(ds, /^ {4}image: onlyoffice\/documentserver:8\.3$/m);
  assert.match(ds, /^ {4}container_name: meetless-onlyoffice$/m);
  assert.match(ds, /^ {4}profiles: \["onlyoffice"\]$/m);
  const ports = [...ds.matchAll(/^ {6}- "([^"]+)"$/gm)].map((m) => m[1]).filter((p) => /:\d+$/.test(p));
  assert.deepEqual(ports, ['127.0.0.1:55435:80']);
  assert.match(ds, /^ {4}env_file:\n {6}- path: \.\/onlyoffice\/\.env\.local\n {8}required: false$/m);
  assert.match(ds, /^ {6}JWT_ENABLED: "true"$/m);
  assert.match(ds, /^ {6}ALLOW_PRIVATE_IP_ADDRESS: "true"$/m);
  assert.match(ds, /^ {4}restart: "no"$/m);
  assert.doesNotMatch(ds, /host\.docker\.internal|extra_hosts|network_mode/);
  assert.doesNotMatch(ds, /JWT_SECRET/, 'the secret comes from the env file only');
});

test('the relay service publishes no port, runs as 0:0, mounts the socket dir read-only and runs relay.py', () => {
  const relay = serviceBlock('meetless-onlyoffice-files');
  assert.match(relay, /^ {4}image: meetless-office:dev$/m);
  assert.match(relay, /^ {4}container_name: meetless-onlyoffice-files$/m);
  assert.match(relay, /^ {4}profiles: \["onlyoffice"\]$/m);
  assert.match(relay, /^ {4}user: "0:0"$/m);
  assert.doesNotMatch(relay, /^ {4}(ports|expose|network_mode|env_file):/m);
  assert.match(relay, /^ {6}- "\$\{MEETLESS_OFFICE_SOCK_DIR:-\.\.\/\.\.\/\.data\/u3\/server\/office-sock\}:\/run\/meetless:ro"$/m);
  assert.match(relay, /^ {6}- "\.\/onlyoffice\/relay\.py:\/opt\/relay\/relay\.py:ro"$/m);
  assert.match(relay, /^ {4}command: \["python3", "\/opt\/relay\/relay\.py"\]$/m);
  assert.match(relay, /^ {4}restart: "no"$/m);
  assert.doesNotMatch(relay, /host\.docker\.internal|JWT/);
});

test('both services sit on the default network meetless-dev-net', () => {
  const text = readFileSync(resolve(REPO, 'infra/dev/compose.yaml'), 'utf8');
  assert.match(text, /^networks:\n {2}default:\n {4}name: meetless-dev-net$/m);
  for (const s of ['meetless-onlyoffice', 'meetless-onlyoffice-files']) assert.doesNotMatch(serviceBlock(s), /^ {4}networks:/m);
});

test('the socket dir defaults to the block data dir office-sock and follows the env', () => {
  assert.equal(sockDir({}), resolve(REPO, '.data/u3/server/office-sock'));
  assert.equal(sockDir({ MEETLESS_DATA_DIR: '.data/u3/server' }), resolve(REPO, '.data/u3/server/office-sock'));
  assert.equal(sockDir({ MEETLESS_DATA_DIR: '/srv/m' }), '/srv/m/office-sock');
  assert.equal(sockDir({ MEETLESS_DATA_DIR: '/srv/m', MEETLESS_OFFICE_SOCK_DIR: '/run/x' }), '/run/x');
});

test('commandsFor brings up and stops both services and filters status to both', () => {
  assert.deepEqual(commandsFor('start'), [
    ['docker', 'compose', '-f', 'infra/dev/compose.yaml', '--profile', 'onlyoffice', 'up', '-d', 'meetless-onlyoffice', 'meetless-onlyoffice-files'],
  ]);
  assert.deepEqual(commandsFor('stop'), [['docker', 'stop', 'meetless-onlyoffice', 'meetless-onlyoffice-files']]);
  const [status] = commandsFor('status');
  assert.deepEqual(status.slice(0, 3), ['docker', 'ps', '-a']);
  const filters = status.flatMap((a, i) => (status[i - 1] === '--filter' ? [a] : []));
  assert.deepEqual(filters, ['name=^meetless-onlyoffice$', 'name=^meetless-onlyoffice-files$']);
  assert.throws(() => commandsFor('rm'));
});

test('no command removes containers, networks or volumes', () => {
  for (const c of ['start', 'stop', 'status']) {
    for (const argv of commandsFor(c)) assert.ok(!argv.some((a) => /^(rm|down|prune|volume|kill|-v|--volumes|--remove-orphans)$/.test(a)), argv.join(' '));
  }
  const src = readFileSync(resolve(HERE, 'onlyoffice.mjs'), 'utf8');
  assert.doesNotMatch(src, /'(rm|down|prune|volume|kill)'/);
});

test('check treats any HTTP status as reachable and 000 or a failure as unreachable', () => {
  assert.equal(probeVerdict({ stdout: '404' }), 'reachable');
  assert.equal(probeVerdict({ stdout: '403\n' }), 'reachable');
  assert.equal(probeVerdict({ stdout: '200' }), 'reachable');
  assert.equal(probeVerdict({ stdout: '502' }), 'reachable');
  const v = probeVerdict({ stdout: '000', stderr: 'curl: (52) Empty reply from server\n' });
  assert.equal(v, 'unreachable: curl: (52) Empty reply from server');
  assert.match(probeVerdict({ stdout: '000' }), /^unreachable: \S/);
  assert.match(probeVerdict({ stdout: '', stderr: 'Error response from daemon: container is not running' }), /^unreachable: Error response from daemon/);
  assert.match(probeVerdict({ error: 'spawn docker ENOENT' }), /^unreachable: spawn docker ENOENT$/);
  assert.match(probeVerdict({ stdout: 'abc' }), /^unreachable: /);
});

test('the CLI rejects an unknown command without touching docker', async () => {
  const child = spawn(process.execPath, [resolve(HERE, 'onlyoffice.mjs'), 'down'], { env: { ...process.env, PATH: '' } });
  let err = '';
  child.stderr.on('data', (d) => (err += d));
  const code = await new Promise((r) => child.on('close', r));
  assert.equal(code, 1);
  assert.match(err, /start \| stop \| status \| check/);
});

// relay.py, run on the host with python3: TCP in, Unix socket out, byte for byte.
async function startRelay(socketPath) {
  const child = spawn('python3', [resolve(HERE, 'relay.py')], {
    env: { ...process.env, RELAY_HOST: '127.0.0.1', RELAY_PORT: '0', RELAY_SOCKET: socketPath },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let err = '';
  const port = await new Promise((res, rej) => {
    child.stderr.on('data', (d) => {
      err += d;
      const m = err.match(/listening on 127\.0\.0\.1:(\d+)/);
      if (m) res(Number(m[1]));
    });
    child.on('exit', (c) => rej(new Error(`relay exited ${c}: ${err}`)));
  });
  return { port, stop: () => new Promise((r) => { child.once('exit', r); child.kill('SIGTERM'); }) };
}

test('relay.py closes the connection without a byte when the socket is missing', async () => {
  const relay = await startRelay(join(tmp, 'missing', 'files.sock'));
  try {
    const got = await new Promise((res, rej) => {
      const s = connect(relay.port, '127.0.0.1', () => s.write('GET /v1/office-files/x HTTP/1.1\r\nHost: r\r\n\r\n'));
      let n = 0;
      s.on('data', (d) => (n += d.length));
      s.on('close', () => res(n));
      s.on('error', () => res(n));
      s.setTimeout(5000, () => rej(new Error('relay kept the connection open')));
    });
    assert.equal(got, 0);
  } finally {
    await relay.stop();
  }
});

test('relay.py forwards HTTP to the Unix socket byte for byte, status and body intact', async () => {
  const dir = mkdtempSync(join(tmp, 'sock-'));
  const sock = join(dir, 'files.sock');
  const big = Buffer.alloc(1024 * 1024 + 7, 0);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff;
  const upstream = createHttpServer((req, res) => {
    if (req.url === '/v1/office-files/big') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(big); return; }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ path: req.url }));
  });
  await new Promise((r) => upstream.listen(sock, r));
  const relay = await startRelay(sock);
  const get = (path) => new Promise((res, rej) => {
    const req = request({ host: '127.0.0.1', port: relay.port, path, agent: false }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', rej);
    req.end();
  });
  try {
    const probe = await get('/v1/office-files/healthcheck-probe');
    assert.equal(probe.status, 404);
    assert.deepEqual(JSON.parse(probe.body.toString()), { path: '/v1/office-files/healthcheck-probe' });
    const file = await get('/v1/office-files/big');
    assert.equal(file.status, 200);
    assert.ok(file.body.equals(big), 'body is byte-identical');
  } finally {
    await relay.stop();
    await new Promise((r) => upstream.close(r));
  }
});
