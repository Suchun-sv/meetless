// Isolation per block (contract §9). Each parallel block gets its own ports, Postgres schema,
// data dir, Xvfb container and screenshot dir, so blocks can run side by side on one machine.
import { createServer } from 'node:net';

/** Contract §9, rows s / u1 / u2 / u3, verbatim. The "v3" row is `DEV_DEFAULTS` (scripts/dev.mjs), not a block. */
export const BLOCKS = {
  s: { branch: 'v3-s', worktree: '~/work/meetless-v3-s', schema: 'meetless_v3_s', server: 4881, vite: 5181, bridges: [4951, 4952], e2eBase: 4910, e2eRenderer: 5191, xvfb: 'meetless-xvfb-s' },
  u1: { branch: 'v3-u1', worktree: '~/work/meetless-v3-u1', schema: 'meetless_v3_u1', server: 4882, vite: 5182, bridges: [4961, 4962], e2eBase: 4920, e2eRenderer: 5192, xvfb: 'meetless-xvfb-u1' },
  u2: { branch: 'v3-u2', worktree: '~/work/meetless-v3-u2', schema: 'meetless_v3_u2', server: 4883, vite: 5183, bridges: [4971, 4972], e2eBase: 4930, e2eRenderer: 5193, xvfb: 'meetless-xvfb-u2' },
  u3: { branch: 'v3-u3', worktree: '~/work/meetless-v3-u3', schema: 'meetless_v3_u3', server: 4884, vite: 5184, bridges: [4981, 4982], e2eBase: 4940, e2eRenderer: 5194, xvfb: 'meetless-xvfb-u3' },
};

/** The §9 "v3" row: what `pnpm dev` uses without `--block`. */
export const DEV_DEFAULTS = { schema: 'meetless', server: 4870, vite: 5173, bridges: [4871, 4872], e2eBase: 4890, e2eRenderer: 5179, xvfb: 'meetless-xvfb', dataDir: '.data/dev' };

export function block(name) {
  if (!Object.hasOwn(BLOCKS, name)) throw new Error(`unknown block ${JSON.stringify(name)}; one of ${Object.keys(BLOCKS).join(', ')}`);
  return BLOCKS[name];
}

/** Environment for one block. Paths are relative to the repo root. */
export function blockEnv(name) {
  const b = block(name);
  return {
    MEETLESS_PG_SCHEMA: b.schema,
    MEETLESS_PORT: String(b.server),
    MEETLESS_DATA_DIR: `.data/${name}/server`,
    MEETLESS_DEV_AUTH: '1',
    MEETLESS_VITE_PORT: String(b.vite),
    MEETLESS_BRIDGE_PORTS: b.bridges.join(','),
    MEETLESS_E2E_BASE: String(b.e2eBase),
    MEETLESS_E2E_RENDERER_PORT: String(b.e2eRenderer),
    MEETLESS_XVFB_NAME: b.xvfb,
    MEETLESS_SHOTS_DIR: `.data/${name}/electron-shots`,
  };
}

/** Every TCP port a block uses: server, Vite, two dev bridges, the e2e server and its 9 bridges, the e2e renderer. */
export function blockPorts(name) {
  const b = block(name);
  return [b.server, b.vite, ...b.bridges, ...Array.from({ length: 10 }, (_, i) => b.e2eBase + i), b.e2eRenderer];
}

/** `block.mjs reset` drops only a block schema; the user's trial and the shared dev schema are never resettable. */
export function assertResettableSchema(name) {
  if (typeof name !== 'string' || !/^meetless_v3_(s|u1|u2|u3)$/.test(name)) throw new Error(`refusing to reset schema ${JSON.stringify(name)}: only meetless_v3_(s|u1|u2|u3)`);
}

const isBusy = (port) =>
  new Promise((res) => {
    const srv = createServer();
    srv.once('error', () => res(true));
    srv.listen({ port, host: '127.0.0.1', exclusive: true }, () => srv.close(() => res(false)));
  });

/** The ports of `ports` that cannot be bound on 127.0.0.1, in order. */
export async function busyPorts(ports) {
  const busy = [];
  for (const p of ports) if (await isBusy(p)) busy.push(p);
  return busy;
}

/** `{ ok, text }`: `ok` when every port is free; `text` names each busy port by number. */
export async function portsReport(ports) {
  const busy = await busyPorts(ports);
  return busy.length === 0 ? { ok: true, text: `all ${ports.length} ports free` } : { ok: false, text: busy.map((p) => `port ${p} is busy`).join('\n') };
}
