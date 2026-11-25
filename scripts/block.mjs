#!/usr/bin/env node
// Per-block isolation helper (contract §9).
//   node scripts/block.mjs env <block>     prints `export ...` lines: eval "$(node scripts/block.mjs env u2)"
//   node scripts/block.mjs ports <block>   exits 1 and names each busy port of the block
//   node scripts/block.mjs reset <block>   drops the block's schema meetless_v3_<block> and .data/<block> only
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { assertResettableSchema, block, blockEnv, blockPorts, busyPorts, portsReport } from './blocks.mjs';

const root = resolve(import.meta.dirname, '..');
const DEFAULT_DATABASE_URL = 'postgres://meetless:meetless-dev-only@127.0.0.1:55433/meetless';
const [cmd, name] = process.argv.slice(2).filter((a) => a !== '--');
const usage = () => {
  console.error('usage: node scripts/block.mjs env|ports|reset <s|u1|u2|u3>');
  process.exit(2);
};
if (!cmd || !name) usage();
try {
  block(name);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

if (cmd === 'env') {
  for (const [k, v] of Object.entries(blockEnv(name))) console.log(`export ${k}='${v}'`);
} else if (cmd === 'ports') {
  const r = await portsReport(blockPorts(name));
  (r.ok ? console.log : console.error)(`block ${name}: ${r.text}`);
  process.exit(r.ok ? 0 : 1);
} else if (cmd === 'reset') {
  const { schema, server } = block(name);
  assertResettableSchema(schema);
  if ((await busyPorts([server])).length) {
    console.error(`block ${name}: its server port ${server} is in use; stop the dev stack first`);
    process.exit(1);
  }
  const pg = createRequire(resolve(root, 'apps/server/package.json'))('pg');
  const c = new pg.Client({ connectionString: process.env.MEETLESS_DATABASE_URL ?? DEFAULT_DATABASE_URL });
  await c.connect();
  try {
    await c.query(`drop schema if exists "${schema}" cascade`);
  } finally {
    await c.end();
  }
  rmSync(resolve(root, '.data', name), { recursive: true, force: true });
  console.log(`block ${name}: dropped schema ${schema} and .data/${name}`);
} else usage();
