import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { join, resolve, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { BRIDGE_METHODS, ClientNode, createFileLog, type BridgeMethod } from '@meetless/client';
import { decodeWire, encodeWire } from '../shared/wire';

/**
 * DEV/TEST BRIDGE HOST — not the shipping path.
 *
 * Runs the same ClientNode the Electron main process uses (own data directory,
 * own SQLite cache, own sync connection) in a plain Node process, and exposes
 * the bridge contract to a renderer served by Vite over loopback HTTP + WS.
 * It exists because this dev machine has no display for Electron; it lets
 * headless Chromium drive the real renderer against real client instances.
 * Bound to 127.0.0.1 and protected by a per-run token.
 */
export interface BridgeHost {
  url: string;
  token: string;
  node: ClientNode;
  close(): Promise<void>;
}

export async function startBridgeHost(opts: { dataDir: string; port?: number; systemLocales?: string[]; token?: string; repoRoot?: string }): Promise<BridgeHost> {
  // No folder dialog here: a repository "hint" is accepted only inside MEETLESS_DEV_REPO_ROOT (dev/test only).
  const root = opts.repoRoot ?? process.env.MEETLESS_DEV_REPO_ROOT;
  const pickDirectory = async (hint?: string) => {
    if (!root || !hint) return null;
    const p = resolve(root, hint);
    return p === resolve(root) || p.startsWith(resolve(root) + sep) ? p : null;
  };
  const log = createFileLog(join(opts.dataDir, 'logs'));
  const node = await ClientNode.open({ dataDir: opts.dataDir, systemLocales: opts.systemLocales ?? ['en-US'], host: 'dev-bridge', pickDirectory, log: (m) => log.info(m) });
  const token = opts.token ?? randomUUID();
  const methods = new Set<string>(BRIDGE_METHODS);

  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-meetless-bridge-token',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((res, rej) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
      req.on('error', rej);
    });

  const server: Server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    const m = /^\/rpc\/(\w+)$/.exec(req.url ?? '');
    if (req.method !== 'POST' || !m || !methods.has(m[1]!)) return res.writeHead(404, cors).end();
    if (req.headers['x-meetless-bridge-token'] !== token) return res.writeHead(403, cors).end();
    try {
      const { args } = JSON.parse(await readBody(req)) as { args: unknown[] };
      const fn = node[m[1] as BridgeMethod] as (...a: unknown[]) => Promise<unknown>;
      const result = await fn.apply(node, decodeWire(args) as unknown[]);
      res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ result: encodeWire(result ?? null) }));
    } catch (e) {
      res.writeHead(500, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ error: String((e as Error).message) }));
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/push' || url.searchParams.get('token') !== token) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      const off = node.subscribe((e) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(e)));
      ws.on('close', off);
    });
  });

  await new Promise<void>((r) => server.listen(opts.port ?? 0, '127.0.0.1', () => r()));
  const a = server.address();
  const url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
  return {
    url,
    token,
    node,
    async close() {
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await node.close();
    },
  };
}
