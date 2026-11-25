import { describe, expect, it } from 'vitest';
import type { MeetlessBridge } from '@meetless/client/bridge';
import { resolveBridge } from '../../src/renderer/app/bridge';

/** A document whose only `<meta>` is the web marker, or none. */
const doc = (marker: boolean) => ({
  querySelector: (sel: string) => (marker && sel === 'meta[name="meetless-host"]' ? { getAttribute: (n: string) => (n === 'content' ? 'web' : null) } : null),
}) as unknown as Pick<Document, 'querySelector'>;
const win = (search = '', meetless?: MeetlessBridge) => ({ meetless, location: { search, origin: 'https://meetless.test' } });

describe('resolveBridge', () => {
  it('the Electron bridge wins over everything', () => {
    const electron = {} as MeetlessBridge;
    expect(resolveBridge(win('?bridge=http://x&bridgeToken=t', electron), doc(true))).toBe(electron);
  });

  it('dev params win over the web marker', () => {
    const b = resolveBridge(win('?bridge=http://127.0.0.1:1&bridgeToken=t'), doc(true))!;
    expect(b).not.toBeNull();
    // The dev HTTP bridge has no web snapshot logic; it is not the web bridge (which answers DESKTOP_ONLY locally).
    return expect(b.pickRepo()).rejects.toBeDefined();
  });

  it('the marker alone gives the web bridge, signed out on a 401 from /v1/me', async () => {
    const realFetch = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), { status: 401 });
    }) as typeof fetch;
    try {
      const b = resolveBridge(win(), doc(true))!;
      const s = await b.snapshot();
      expect(s).toMatchObject({ host: 'web', cacheKind: 'memory', session: null, outbox: [] });
      expect(seen).toEqual(['https://meetless.test/v1/me']);
      expect(await b.pickRepo()).toEqual({ ok: false, code: 'DESKTOP_ONLY' });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('no marker and no params gives null', () => {
    expect(resolveBridge(win(), doc(false))).toBeNull();
  });
});
