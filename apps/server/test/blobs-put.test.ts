/**
 * M5 (Phase 0 final review): PUT /v1/blobs/:hash must not tell the uploader
 * whether anyone already had the bytes. The status and body must be
 * byte-identical for a first-ever upload and a repeat upload by someone else.
 */
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
