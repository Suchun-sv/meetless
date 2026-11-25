import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { pickEncoding, prepareIndexHtml, registerWebStatic } from '../src/web/static';
import { tempDir } from './helpers';

let app: FastifyInstance | null = null;
let dir: { path: string; rm(): void } | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
  dir?.rm();
  dir = null;
});

const JS = `export const x = ${JSON.stringify('meetless '.repeat(4000))};\n`;

async function build(lines: string[]): Promise<FastifyInstance> {
  dir = tempDir('webz');
  mkdirSync(join(dir.path, 'assets'));
  writeFileSync(join(dir.path, 'index.html'), '<html><head></head><body></body></html>');
  writeFileSync(join(dir.path, 'assets', 'index-abc.js'), JS);
  writeFileSync(join(dir.path, 'assets', 'f.woff2'), Buffer.alloc(2048, 7));
  writeFileSync(join(dir.path, 'boot.js'), '/* boot */');
  app = Fastify();
  registerWebStatic(app, { webDir: dir.path, print: (l) => lines.push(l) });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return app;
}

describe('pickEncoding', () => {
  it('prefers brotli, then gzip, and honours q=0', () => {
    expect(pickEncoding('gzip, deflate, br')).toBe('br');
    expect(pickEncoding('gzip')).toBe('gzip');
    expect(pickEncoding('br;q=0, gzip;q=0.5')).toBe('gzip');
    expect(pickEncoding('identity')).toBeNull();
    expect(pickEncoding(undefined)).toBeNull();
  });
});

describe('prepareIndexHtml', () => {
  it('drops crossorigin from script and link tags', () => {
    const out = prepareIndexHtml('<head><script type="module" crossorigin src="./assets/a.js"></script><link rel="stylesheet" crossorigin href="./assets/a.css"></head>');
    expect(out).not.toContain('crossorigin');
    expect(out).toContain('<script type="module" src="./assets/a.js">');
    expect(out).toContain('<link rel="stylesheet" href="./assets/a.css">');
  });
});

describe('compressed assets', () => {
  it('serves brotli, gzip or identity by Accept-Encoding, with Vary', async () => {
    const lines: string[] = [];
    const a = await build(lines);
    const br = await a.inject({ method: 'GET', url: '/assets/index-abc.js', headers: { 'accept-encoding': 'gzip, br' } });
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.headers.vary).toBe('Accept-Encoding');
    expect(br.rawPayload.length).toBeLessThan(JS.length / 10);
    expect(brotliDecompressSync(br.rawPayload).toString()).toBe(JS);
    const gz = await a.inject({ method: 'GET', url: '/assets/index-abc.js', headers: { 'accept-encoding': 'gzip' } });
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gz.rawPayload).toString()).toBe(JS);
    const plain = await a.inject({ method: 'GET', url: '/assets/index-abc.js' });
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body).toBe(JS);
  });

  it('never compresses fonts, and a cache-busting query serves the same file', async () => {
    const a = await build([]);
    const font = await a.inject({ method: 'GET', url: '/assets/f.woff2', headers: { 'accept-encoding': 'br' } });
    expect(font.headers['content-encoding']).toBeUndefined();
    expect(font.rawPayload.length).toBe(2048);
    const busted = await a.inject({ method: 'GET', url: '/assets/index-abc.js?r=2' });
    expect(busted.body).toBe(JS);
  });

  it('boot.js is revalidated, not pinned for a year', async () => {
    const a = await build([]);
    const boot = await a.inject({ method: 'GET', url: '/boot.js' });
    expect(boot.headers['cache-control']).toBe('no-cache');
  });

  it('logs one line per asset transfer with status, bytes, encoding and duration', async () => {
    const lines: string[] = [];
    const a = await build(lines);
    const res = await fetch(`http://127.0.0.1:${(a.server.address() as { port: number }).port}/assets/index-abc.js`, { headers: { 'accept-encoding': 'br' } });
    await res.arrayBuffer();
    await new Promise((r) => setTimeout(r, 50));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[meetless-web-asset\] GET \/assets\/index-abc\.js 200 \d+B br \d+ms$/);
  });
});
