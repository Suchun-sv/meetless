/**
 * The `/office` reverse proxy to DocumentServer (design 2026-11-25 §5), against a fake
 * DocumentServer (`node:http` plus a `ws` echo server), and `office.config` giving a web session
 * the proxied URL while the desktop keeps the direct one.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { sha256 } from '../src/blobs';
import { IDS, TOKENS, http, tempDir, withServer, type TestServer } from './helpers';
import { seedTeam } from './seed';
import { minimalPdf } from './support/pdf';

interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** A fake DocumentServer: records every request, answers `api.js`, `healthcheck`, echoes POST bodies, and echoes websocket messages. */
function fakeDocumentServer(): Promise<{ url: string; seen: Seen[]; upgrades: Seen[]; close(): Promise<void> }> {
  const seen: Seen[] = [];
  const upgrades: Seen[] = [];
  const srv = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      if (req.url === '/healthcheck') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end('true');
      }
      if (req.url?.startsWith('/web-apps/apps/api/documents/api.js')) {
        res.writeHead(200, { 'content-type': 'application/javascript', 'set-cookie': 'ds=1; Path=/' });
        return res.end('window.DocsAPI = {};');
      }
      res.writeHead(201, { 'content-type': 'application/octet-stream' });
      res.end(body);
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  srv.on('upgrade', (req, socket, head) => {
    upgrades.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.alloc(0) });
    wss.handleUpgrade(req, socket, head, (ws) => ws.on('message', (m) => ws.send(`echo:${String(m)}`)));
  });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        seen,
        upgrades,
        close: () =>
          new Promise((r) => {
            for (const c of wss.clients) c.terminate();
            wss.close();
            srv.closeAllConnections();
            srv.close(() => r());
          }),
      });
    });
  });
}

const SECRET = 'test-onlyoffice-jwt-secret';
const PUBLIC_URL = 'http://meetless-onlyoffice-files:8080';

describe('/office proxy', () => {
  let ds: Awaited<ReturnType<typeof fakeDocumentServer>> | undefined;
  let server: TestServer | undefined;
  let dir: { path: string; rm(): void } | undefined;
  afterEach(async () => {
    await server?.stop();
    await ds?.close();
    dir?.rm();
    server = ds = dir = undefined;
  });

  async function start(): Promise<void> {
    ds = await fakeDocumentServer();
    dir = tempDir('office-proxy');
    server = await withServer({ onlyoffice: { url: ds.url, jwtSecret: SECRET, publicUrl: PUBLIC_URL, filesSocket: join(dir.path, 's', 'files.sock') } });
  }

  it('proxies api.js with the prefix stripped, the forwarded host set and no cookie or authorization', async () => {
    await start();
    const res = await fetch(`${server!.base}/office/web-apps/apps/api/documents/api.js?ver=1`, {
      headers: { cookie: 'ml_session=mlp_secret; ml_csrf=x', authorization: 'Bearer dev-alex' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/javascript');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(await res.text()).toBe('window.DocsAPI = {};');
    const got = ds!.seen.find((s) => s.url.startsWith('/web-apps/'))!;
    expect(got.url).toBe('/web-apps/apps/api/documents/api.js?ver=1');
    const host = new URL(server!.base).host;
    expect(got.headers['x-forwarded-host']).toBe(`${host}/office`);
    expect(got.headers['x-forwarded-proto']).toBe('http');
    expect(got.headers.cookie).toBeUndefined();
    expect(got.headers.authorization).toBeUndefined();

    // A 64 KB POST body arrives intact (no body parser in the way).
    const big = Buffer.alloc(64 * 1024, 7);
    const post = await fetch(`${server!.base}/office/converter?x=1`, { method: 'POST', headers: { 'content-type': 'application/x-weird' }, body: big });
    expect(post.status).toBe(201);
    expect(Buffer.from(await post.arrayBuffer()).equals(big)).toBe(true);
  });

  it('proxies a websocket under /office/ both ways', async () => {
    await start();
    const ws = new WebSocket(`${server!.base.replace('http', 'ws')}/office/doc/x/c/?EIO=4&transport=websocket`, { headers: { cookie: 'ml_session=mlp_secret' } });
    const reply = await new Promise<string>((resolve, reject) => {
      ws.on('open', () => ws.send('hi'));
      ws.on('message', (m) => resolve(String(m)));
      ws.on('error', reject);
    });
    ws.close();
    expect(reply).toBe('echo:hi');
    expect(ds!.upgrades[0]!.url).toBe('/doc/x/c/?EIO=4&transport=websocket');
    expect(ds!.upgrades[0]!.headers.cookie).toBeUndefined();
  });

  it('answers 404 with OnlyOffice off and 502 BAD_GATEWAY with DocumentServer down', async () => {
    server = await withServer();
    expect((await fetch(`${server.base}/office/healthcheck`)).status).toBe(404);
    await server.stop();
    ds = await fakeDocumentServer();
    const url = ds.url;
    await ds.close();
    ds = undefined;
    server = await withServer({ onlyoffice: { url, jwtSecret: SECRET, publicUrl: PUBLIC_URL, filesSocket: null } });
    const res = await fetch(`${server.base}/office/healthcheck`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { code: 'BAD_GATEWAY' } });
  });

  it('office.config gives a web session the proxied url and the desktop the direct url', async () => {
    await start();
    const team = await seedTeam(server!.base);
    const bytes = minimalPdf(['hello']);
    const hash = sha256(bytes);
    await server!.svc.putBlob(IDS.alex, hash, bytes, 'application/pdf');
    const r = await server!.svc.submit(IDS.alex, {
      id: randomUUID(),
      type: 'artifact.version_added',
      payload: { artifactId: team.artifacts.deck, versionId: 'v-web', label: 'v1', date: '2026-11-24', note: '', blobHash: hash, mediaType: 'application/pdf' },
    });
    expect(r.status).toBe('accepted');
    const path = `/v1/projects/${team.projectId}/artifacts/${team.artifacts.deck}/versions/v-web/office`;

    const desktop = await http(server!.base, TOKENS.alex, 'GET', path);
    expect(desktop.json).toMatchObject({ available: true, documentServerUrl: ds!.url });

    const signIn = await fetch(`${server!.base}/v1/web/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server!.base },
      body: JSON.stringify({ token: TOKENS.alex }),
    });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const web = await fetch(`${server!.base}${path}`, { headers: { cookie } });
    expect(web.status).toBe(200);
    expect(await web.json()).toMatchObject({ available: true, documentServerUrl: `${server!.base}/office` });
  });
});
