// node --test scripts/blocks.test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { assertResettableSchema, BLOCKS, blockEnv, blockPorts, busyPorts, portsReport } from './blocks.mjs';

const FORBIDDEN = new Set([4870, 4871, 4872, 4873, 4874, 4875, 4876, 5173]);

test('block table: unique ports and schemas, none of 4870-4876 or 5173', () => {
  assert.deepEqual(Object.keys(BLOCKS), ['s', 'u1', 'u2', 'u3']);
  // Contract §9, row u2, verbatim.
  assert.deepEqual(BLOCKS.u2, {
    branch: 'v3-u2',
    worktree: '~/work/meetless-v3-u2',
    schema: 'meetless_v3_u2',
    server: 4883,
    vite: 5183,
    bridges: [4971, 4972],
    e2eBase: 4930,
    e2eRenderer: 5193,
    xvfb: 'meetless-xvfb-u2',
  });
  const seen = new Map();
  for (const name of Object.keys(BLOCKS)) {
    for (const p of blockPorts(name)) {
      assert.ok(!FORBIDDEN.has(p), `${name} uses forbidden port ${p}`);
      assert.ok(!seen.has(p), `${name} and ${seen.get(p)} share port ${p}`);
      seen.set(p, name);
    }
  }
  // Each block owns its server, Vite, two dev bridges, the e2e server + 9 bridges and the e2e renderer.
  assert.equal(seen.size, Object.keys(BLOCKS).length * 15);
  const schemas = Object.values(BLOCKS).map((b) => b.schema);
  assert.equal(new Set(schemas).size, schemas.length);
  for (const s of schemas) assert.ok(!['meetless', 'meetless_trial', 'meetless_trial_v3'].includes(s), s);
  const xvfb = Object.values(BLOCKS).map((b) => b.xvfb);
  assert.equal(new Set(xvfb).size, xvfb.length);
  assert.ok(!xvfb.includes('meetless-xvfb'));
});

test('blockEnv gives the block its schema, ports, data dir, dev auth, Xvfb name and screenshot dir', () => {
  assert.deepEqual(blockEnv('u2'), {
    MEETLESS_PG_SCHEMA: 'meetless_v3_u2',
    MEETLESS_PORT: '4883',
    MEETLESS_DATA_DIR: '.data/u2/server',
    MEETLESS_DEV_AUTH: '1',
    MEETLESS_VITE_PORT: '5183',
    MEETLESS_BRIDGE_PORTS: '4971,4972',
    MEETLESS_E2E_BASE: '4930',
    MEETLESS_E2E_RENDERER_PORT: '5193',
    MEETLESS_XVFB_NAME: 'meetless-xvfb-u2',
    MEETLESS_SHOTS_DIR: '.data/u2/electron-shots',
  });
  assert.throws(() => blockEnv('v3'), /unknown block/);
  assert.throws(() => blockEnv('__proto__'), /unknown block/);
});

test('reset guard refuses meetless, meetless_trial and meetless_trial_v3 and accepts meetless_v3_u2', () => {
  for (const bad of ['meetless', 'meetless_trial', 'meetless_trial_v3', 'meetless_v3', 'meetless_v3_x', 'meetless_v3_u2 ', 'MEETLESS_V3_U2', 'meetless_v3_u2;drop', 'e2e_abc', '']) {
    assert.throws(() => assertResettableSchema(bad), /refusing/, JSON.stringify(bad));
  }
  assert.throws(() => assertResettableSchema(undefined));
  assert.throws(() => assertResettableSchema('meetless_trial'));
  for (const ok of ['meetless_v3_s', 'meetless_v3_u1', 'meetless_v3_u2', 'meetless_v3_u3']) assert.doesNotThrow(() => assertResettableSchema(ok));
  assert.doesNotThrow(() => assertResettableSchema('meetless_v3_u2'));
});

test('ports reports a busy port by number', async () => {
  // A throw-away listener in 4830-4839 (never a block's port), released afterwards.
  const srv = createServer();
  let port = 0;
  for (const p of [4830, 4831, 4832, 4833, 4834, 4835, 4836, 4837, 4838, 4839]) {
    const ok = await new Promise((res) => {
      srv.once('error', () => res(false));
      srv.listen({ port: p, host: '127.0.0.1', exclusive: true }, () => res(true));
    });
    if (ok) {
      port = p;
      break;
    }
  }
  assert.ok(port, 'no free port in 4830-4839');
  try {
    const free = port === 4839 ? 4838 : port + 1;
    assert.deepEqual(await busyPorts([port, free]), [port]);
    const report = await portsReport([port, free]);
    assert.equal(report.ok, false);
    assert.match(report.text, new RegExp(`\\b${port}\\b.*busy`));
    assert.doesNotMatch(report.text, new RegExp(`\\b${free}\\b`));
  } finally {
    await new Promise((r) => srv.close(r));
  }
  assert.deepEqual(await busyPorts([port]), []);
  assert.equal((await portsReport([port])).ok, true);
});
