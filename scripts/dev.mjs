#!/usr/bin/env node
// Local development stack. Everything binds to 127.0.0.1.
//
//   pnpm dev                       Postgres (meetless-pg) + sync server + two dev client instances
//                                  (bridge hosts, zh-CN and en, separate data dirs) + Vite renderer.
//                                  Open the two printed URLs in a browser (headless-friendly; no Electron).
//   pnpm dev -- --block <x>        the same on block x's ports, schema and data dir (contract §9)
//   pnpm dev -- --sample zh-CN|en  load the sample projects into the server (a second load is a no-op)
//   pnpm dev -- --electron         Postgres + sync server + Vite + the Electron app (needs a display;
//                                  do not run on a machine whose desktop you must not touch).
// Without --block it uses the §9 "v3" row: schema meetless, server 4870, Vite 5173, bridges 4871/4872.
// Dev auth (dev-<name> tokens) is on: MEETLESS_DEV_AUTH=1.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { blockEnv, busyPorts, DEV_DEFAULTS } from './blocks.mjs';

const root = resolve(import.meta.dirname, '..');
let args;
try {
  ({ values: args } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: { block: { type: 'string' }, sample: { type: 'string' }, electron: { type: 'boolean', default: false } },
  }));
  if (args.sample !== undefined && args.sample !== 'zh-CN' && args.sample !== 'en') throw new Error(`--sample must be zh-CN or en, not ${args.sample}`);
} catch (e) {
  console.error(`${e.message}\nusage: pnpm dev -- [--block s|u1|u2|u3] [--sample zh-CN|en] [--electron]`);
  process.exit(2);
}

let cfg = { ...DEV_DEFAULTS, serverDataDir: `${DEV_DEFAULTS.dataDir}/server` };
if (args.block) {
  let env;
  try {
    env = blockEnv(args.block);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  cfg = {
    schema: env.MEETLESS_PG_SCHEMA,
    server: Number(env.MEETLESS_PORT),
    vite: Number(env.MEETLESS_VITE_PORT),
    bridges: env.MEETLESS_BRIDGE_PORTS.split(',').map(Number),
    dataDir: `.data/${args.block}`,
    serverDataDir: env.MEETLESS_DATA_DIR,
  };
}

const SERVER = `http://127.0.0.1:${cfg.server}`;
const RENDERER = `http://127.0.0.1:${cfg.vite}`;
const children = [];

const run = (name, cmd, argv, cwd, env = {}) => {
  const c = spawn(cmd, argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `[${name}]`.padEnd(10);
  for (const s of [c.stdout, c.stderr]) s.on('data', (d) => process.stdout.write(String(d).replace(/^(?=.)/gm, `${tag} `)));
  c.on('exit', (code) => console.log(`${tag} exited (${code})`));
  children.push(c);
  return c;
};
const stop = () => {
  for (const c of children) c.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const ports = [cfg.server, cfg.vite, ...(args.electron ? [] : cfg.bridges)];
const busy = await busyPorts(ports);
if (busy.length) {
  console.error(`busy port(s): ${busy.join(', ')}${args.block ? ` (block ${args.block})` : ''}; nothing started`);
  process.exit(1);
}

const deps = spawnSync('bash', [resolve(root, 'infra/dev/deps.sh'), 'start'], { stdio: 'inherit' });
if (deps.status !== 0) process.exit(deps.status ?? 1);

const desktop = resolve(root, 'apps/desktop');
mkdirSync(resolve(root, cfg.dataDir), { recursive: true });
run('server', 'node', ['--import', 'tsx', 'src/main.ts'], resolve(root, 'apps/server'), {
  MEETLESS_PORT: String(cfg.server),
  MEETLESS_PG_SCHEMA: cfg.schema,
  MEETLESS_DATA_DIR: resolve(root, cfg.serverDataDir),
  MEETLESS_DEV_AUTH: '1',
  ...(args.sample ? { MEETLESS_SAMPLE: args.sample } : {}),
});
run('vite', 'pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', String(cfg.vite), '--strictPort'], desktop);

if (args.electron) {
  spawnSync('node', ['scripts/build-main.mjs'], { cwd: desktop, stdio: 'inherit' });
  run('electron', 'pnpm', ['exec', 'electron', '.'], desktop, {
    MEETLESS_RENDERER_URL: RENDERER,
    // A block's Electron client keeps its own data dir; the default stack uses the app's normal one.
    ...(args.block ? { MEETLESS_CLIENT_DATA_DIR: resolve(root, cfg.dataDir, 'electron') } : {}),
  });
} else {
  const clients = [
    { name: 'client-a', port: cfg.bridges[0], token: 'dev-bridge-a', locale: 'zh-CN' },
    { name: 'client-b', port: cfg.bridges[1], token: 'dev-bridge-b', locale: 'en-US' },
  ];
  for (const c of clients) {
    run(c.name, 'node', ['--import', 'tsx', 'src/bridge-host/main.ts', '--data-dir', resolve(root, cfg.dataDir, c.name), '--port', String(c.port), '--locale', c.locale, '--token', c.token], desktop);
  }
  setTimeout(() => {
    console.log(`\nMeetless dev stack${args.block ? ` (block ${args.block}, schema ${cfg.schema})` : ''}. DEV-ONLY sign-in tokens: dev-alex, dev-lin, dev-ben, dev-zhou, dev-eve`);
    for (const c of clients) {
      console.log(`  ${c.name} (${c.locale}): ${RENDERER}/?bridge=${encodeURIComponent(`http://127.0.0.1:${c.port}`)}&bridgeToken=${c.token}&server=${encodeURIComponent(SERVER)}`);
    }
    console.log(`  From another machine: ssh -L ${cfg.vite}:127.0.0.1:${cfg.vite} ${clients.map((c) => `-L ${c.port}:127.0.0.1:${c.port}`).join(' ')} <user>@<dev-server>\n`);
  }, 2500);
}
