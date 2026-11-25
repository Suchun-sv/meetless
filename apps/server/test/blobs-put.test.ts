/**
 * M5 (Phase 0 final review): PUT /v1/blobs/:hash must not tell the uploader
 * whether anyone already had the bytes. The status and body must be
 * byte-identical for a first-ever upload and a repeat upload by someone else.
 */
import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '../src/index';
import { TOKENS, withServer, type TestServer } from './helpers';

async function putBlob(base: string, token: string, bytes: Uint8Array): Promise<{ status: number; json: unknown; headers: Headers }> {
  const hash = sha256(bytes);
  const res = await fetch(`${base}/v1/blobs/${hash}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
    body: bytes,
  });
  const json = await res.json();
  return { status: res.status, json, headers: res.headers };
}

describe('PUT /v1/blobs/:hash answers the same way whether the bytes were new or already known', () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await withServer();
  });
  afterAll(() => s.stop());

  it('a first-ever upload answers 200 with exactly { hash, size }, same as a repeat by a different user', async () => {
    const bytes = new TextEncoder().encode(`blobs-put M5 ${Math.random()}`);
    const hash = sha256(bytes);

    const first = await putBlob(s.base, TOKENS.lin, bytes);
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ hash, size: bytes.byteLength });
    expect(Object.keys(first.json as object).sort()).toEqual(['hash', 'size']);

    const second = await putBlob(s.base, TOKENS.zhou, bytes);
    expect(second.status).toBe(first.status);
    expect(second.json).toEqual(first.json);
  });

  it('the same bytes uploaded a third time by the original uploader still answer identically', async () => {
    const bytes = new TextEncoder().encode(`blobs-put M5 repeat-by-owner ${Math.random()}`);
    const hash = sha256(bytes);
    await putBlob(s.base, TOKENS.lin, bytes);
    const repeat = await putBlob(s.base, TOKENS.lin, bytes);
    expect(repeat.status).toBe(200);
    expect(repeat.json).toEqual({ hash, size: bytes.byteLength });
  });
});

describe('blob upload and download hardening (M6, S-L7)', () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await withServer();
  });
  afterAll(() => s.stop());

  it('an upload with no token is refused at its headers, before the body is read', async () => {
    const { port } = new URL(s.base);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: Number(port), method: 'PUT', path: `/v1/blobs/sha256:${'0'.repeat(64)}`, headers: { 'content-type': 'application/octet-stream', 'content-length': String(150 * 1024 * 1024) } });
      req.on('response', (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
        req.destroy();
      });
      req.on('error', (e) => (e.message.includes('socket hang up') || (e as NodeJS.ErrnoException).code === 'ECONNRESET' ? undefined : reject(e)));
      // Only 64 KB of the declared 150 MB is ever sent: the answer must come anyway.
      req.write(Buffer.alloc(64 * 1024));
      setTimeout(() => reject(new Error('no answer before the body')), 5000).unref();
    });
    expect(status).toBe(401);
  });

  it('a download is never sniffed or rendered: nosniff, attachment and a sandbox CSP', async () => {
    const bytes = new TextEncoder().encode(`<html><script>alert(1)</script>${Math.random()}</html>`);
    const hash = sha256(bytes);
    const put = await fetch(`${s.base}/v1/blobs/${hash}`, { method: 'PUT', headers: { authorization: `Bearer ${TOKENS.lin}`, 'content-type': 'application/octet-stream', 'x-meetless-media-type': 'text/html' }, body: bytes });
    expect(put.status).toBe(200);
    const get = await fetch(`${s.base}/v1/blobs/${hash}`, { headers: { authorization: `Bearer ${TOKENS.lin}` } });
    expect(get.status).toBe(200);
    expect(get.headers.get('x-content-type-options')).toBe('nosniff');
    expect(get.headers.get('content-disposition')).toBe('attachment');
    expect(get.headers.get('content-security-policy')).toMatch(/^sandbox/);
  });
});
