import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { Authenticator, DevAuth } from '../src/auth';
import { BlobFiles } from '../src/blobs';
import { buildApp } from '../src/http';
import { SyncService } from '../src/service';
import { MemoryAccountStore, MemoryBlobMetaStore, MemoryEventStore } from '../src/store/memory';
import { prepareIndexHtml, webCsp } from '../src/web/static';
import { serverConfig, tempDir } from './helpers';

/** `fetch`'s `Response.json()` typed `unknown`; every body this file reads is a small object, read loosely as the rest of this suite does. */
async function asJson(res: Response): Promise<any> {
  return res.json();
}

/** The exact meta vite's packaged-desktop CSP plugin injects (apps/desktop/vite.config.ts), entity-escaped as the real build emits it. */
const DESKTOP_CSP_META =
  '<meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39; http://127.0.0.1:55435; script-src &#39;self&#39; http://127.0.0.1:55435">';

function fixtureHtml(): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    `    ${DESKTOP_CSP_META}`,
    '    <meta charset="utf-8" />',
    '    <title>Meetless</title>',
    '    <script type="module" crossorigin src="./assets/index-abc.js"></script>',
    '    <link rel="stylesheet" crossorigin href="./assets/index-abc.css">',
    '  </head>',
    '  <body>',
    '    <div id="root"></div>',
    '  </body>',
    '</html>',
    '',
  ].join('\n');
}

/** A webDir laid out like a real `vite build` output: index.html (desktop CSP meta) + assets/. */
function buildFixture(): { path: string; rm(): void } {
  const t = tempDir('web-static-fixture');
  writeFileSync(join(t.path, 'index.html'), fixtureHtml());
  mkdirSync(join(t.path, 'assets'));
  writeFileSync(join(t.path, 'assets', 'index-abc.js'), 'console.log("app")');
  writeFileSync(join(t.path, 'assets', 'index-abc.css'), 'body { margin: 0; }');
  writeFileSync(join(t.path, 'assets', 'f.woff2'), Buffer.from([1, 2, 3, 4]));
  writeFileSync(join(t.path, 'assets', 'icon.svg'), '<svg></svg>');
  return t;
}

/** A full app (in-memory store, no Postgres: this task touches no data) with `cfg.webDir` set as given. */
async function appWithWebDir(webDir: string | null): Promise<{ app: FastifyInstance; base: string; close(): Promise<void> }> {
  const dir = tempDir('web-static-data');
  const cfg = serverConfig({ dataDir: dir.path, databaseUrl: null, webDir });
  const service = await SyncService.open({
    store: new MemoryEventStore(),
    blobMeta: new MemoryBlobMetaStore(),
    blobFiles: new BlobFiles(dir.path),
    devUsers: cfg.devUsers,
  });
  const accounts = new MemoryAccountStore();
  const auth = new Authenticator(accounts, new DevAuth(cfg.devUsers), cfg.now);
  const app = await buildApp({ service, accounts, auth, cfg });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    app,
    base: `http://127.0.0.1:${port}`,
    async close() {
      await app.close();
      dir.rm();
    },
  };
}

describe('webCsp (pure)', () => {
  it('is the spec §3 string with <host> replaced', () => {
    expect(webCsp('example.test:8445')).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; " +
        "font-src 'self'; connect-src 'self' wss://example.test:8445 ws://example.test:8445; frame-src 'self'; worker-src 'self' blob:; " +
        "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
  });

  it('uses the given host verbatim, whatever it is', () => {
    expect(webCsp('127.0.0.1:4876')).toContain('wss://127.0.0.1:4876');
    expect(webCsp('127.0.0.1:4876')).toContain('ws://127.0.0.1:4876');
  });
});

describe('prepareIndexHtml (pure)', () => {
  it('adds the web marker and removes the desktop CSP meta', () => {
    const out = prepareIndexHtml(fixtureHtml());
    expect(out).toContain('<meta name="meetless-host" content="web">');
    expect(out).not.toContain('Content-Security-Policy');
    expect(out).toContain('<div id="root"></div>');
  });

  it('is a no-op on a page with neither', () => {
    const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>hi</body></html>';
    const out = prepareIndexHtml(html);
    expect(out).toContain('<meta name="meetless-host" content="web">');
    expect(out).toContain('hi');
  });

  it('prepends the marker to a fragment with no <head> at all', () => {
    const out = prepareIndexHtml('<body>hi</body>');
    expect(out.startsWith('<meta name="meetless-host" content="web">')).toBe(true);
  });
});

describe('registerWebStatic (real server, in-memory store)', () => {
  let fixture: { path: string; rm(): void } | undefined;
  let server: { app: FastifyInstance; base: string; close(): Promise<void> } | undefined;
  afterEach(async () => {
    await server?.close();
    fixture?.rm();
  });

  it('GET / serves index.html with the marker, without the CSP meta, with the CSP header and the other headers', async () => {
    fixture = buildFixture();
    server = await appWithWebDir(fixture.path);
    const res = await fetch(`${server.base}/`);
    expect(res.status).toBe(200);
    const host = new URL(server.base).host;
    expect(res.headers.get('content-security-policy')).toBe(webCsp(host));
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('same-origin');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('<meta name="meetless-host" content="web">');
    expect(text).not.toContain('Content-Security-Policy');
    expect(text).toContain('<div id="root"></div>');
  });

  it('GET /index.html answers the same prepared page', async () => {
    fixture = buildFixture();
    server = await appWithWebDir(fixture.path);
    const res = await fetch(`${server.base}/index.html`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<meta name="meetless-host" content="web">');
    expect(text).not.toContain('Content-Security-Policy');
  });

  it('assets get their content type and immutable caching', async () => {
    fixture = buildFixture();
    server = await appWithWebDir(fixture.path);
    const cases: [string, string][] = [
      ['/assets/index-abc.js', 'text/javascript; charset=utf-8'],
      ['/assets/index-abc.css', 'text/css; charset=utf-8'],
      ['/assets/f.woff2', 'font/woff2'],
      ['/assets/icon.svg', 'image/svg+xml'],
    ];
    for (const [path, contentType] of cases) {
      const res = await fetch(`${server.base}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type'), path).toBe(contentType);
      expect(res.headers.get('cache-control'), path).toBe('public, max-age=31536000, immutable');
    }
  });

  it('traversal and missing files are 404 NOT_FOUND', async () => {
    fixture = buildFixture();
    server = await appWithWebDir(fixture.path);
    for (const path of ['/assets/..%2f..%2fetc/passwd', '/assets/../../etc/passwd', '/%2e%2e/x', '/assets/nope.js']) {
      const res = await fetch(`${server.base}${path}`);
      expect(res.status, path).toBe(404);
      expect((await asJson(res)).error.code, path).toBe('NOT_FOUND');
    }
  });

  it('API, MCP, health and office paths are never shadowed', async () => {
    fixture = buildFixture();
    // A file at each of those names/prefixes in webDir must still never be served there.
    writeFileSync(join(fixture.path, 'health'), 'not the real /health');
    writeFileSync(join(fixture.path, 'mcp'), 'not the real /mcp');
    mkdirSync(join(fixture.path, 'office'));
    writeFileSync(join(fixture.path, 'office', 'x'), 'not a real office proxy');
    server = await appWithWebDir(fixture.path);

    const health = await fetch(`${server.base}/health`);
    expect(health.status).toBe(200);
    expect(await asJson(health)).toMatchObject({ ok: true });

    const me = await fetch(`${server.base}/v1/me`);
    expect(me.status).toBe(401);
    expect((await asJson(me)).error.code).toBe('UNAUTHENTICATED');

    // registerMcp already answers GET /mcp with 405 Method Not Allowed (no GET support at all);
    // the point here is that it still does, rather than quietly turning into the static file.
    const mcp = await fetch(`${server.base}/mcp`);
    expect(mcp.status).toBe(405);
    expect((await asJson(mcp)).error.message).toBe('Method not allowed');

    const office = await fetch(`${server.base}/office/x`);
    expect(office.status).toBe(404);
    expect((await asJson(office)).error.code).toBe('NOT_FOUND');
  });

  it('webDir off answers 404 at /', async () => {
    server = await appWithWebDir(null);
    const res = await fetch(`${server.base}/`);
    expect(res.status).toBe(404);
    expect((await asJson(res)).error.code).toBe('NOT_FOUND');
  });

  it('webDir set but without index.html answers 404 at /', async () => {
    fixture = tempDir('web-static-empty');
    server = await appWithWebDir(fixture.path);
    const res = await fetch(`${server.base}/`);
    expect(res.status).toBe(404);
    expect((await asJson(res)).error.code).toBe('NOT_FOUND');
  });
});
