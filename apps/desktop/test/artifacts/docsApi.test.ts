import { describe, expect, it, vi } from 'vitest';
import { loadDocsApi, type DocLike, type DocsApi, type ScriptEl, type WinLike } from '../../src/renderer/artifacts/docsApi';

/*
 * Task 6 fix round 1 (review Important #1): `loadDocsApi`'s per-url cache must not keep serving a
 * rejected promise forever. These tests give the loader a fake `document`/`window` seam (there is
 * no jsdom in this repo) instead of exercising the real DOM. Real (small) timeouts are used
 * throughout, rather than vitest's fake timers, to avoid a stray leftover timer across tests
 * sharing the module-level cache.
 */

class FakeScript implements ScriptEl {
  src = '';
  async = false;
  removed = false;
  private listeners: Record<'load' | 'error', Array<() => void>> = { load: [], error: [] };
  addEventListener(type: 'load' | 'error', listener: () => void): void {
    this.listeners[type].push(listener);
  }
  remove(): void {
    this.removed = true;
  }
  fire(type: 'load' | 'error'): void {
    for (const l of this.listeners[type]) l();
  }
}

function fakeEnv(): { doc: DocLike; win: WinLike; scripts: FakeScript[]; appended: FakeScript[]; setDocsApi: (api: DocsApi | undefined) => void } {
  const scripts: FakeScript[] = [];
  const appended: FakeScript[] = [];
  let docsApi: DocsApi | undefined;
  const doc: DocLike = {
    createScript: () => {
      const s = new FakeScript();
      scripts.push(s);
      return s;
    },
    appendScript: (script) => appended.push(script as FakeScript),
  };
  const win: WinLike = { getDocsApi: () => docsApi };
  return { doc, win, scripts, appended, setDocsApi: (api) => void (docsApi = api) };
}

let nextPort = 61000;
/** A fresh url per test: `loadDocsApi`'s cache is module-level, so tests must not collide. */
function url(): string {
  return `http://127.0.0.1:${nextPort++}`;
}

const FAKE_API: DocsApi = { DocEditor: class {} as unknown as DocsApi['DocEditor'] };

describe('loadDocsApi', () => {
  it('a successful load is cached, and a second call for the same url appends no new script', async () => {
    const { doc, win, scripts, appended, setDocsApi } = fakeEnv();
    const u = url();
    setDocsApi(FAKE_API);

    const p1 = loadDocsApi(u, 10_000, { doc, win });
    expect(scripts).toHaveLength(1);
    expect(appended).toHaveLength(1);
    scripts[0]!.fire('load');
    await expect(p1).resolves.toBe(FAKE_API);

    const p2 = loadDocsApi(u, 10_000, { doc, win });
    expect(scripts).toHaveLength(1); // no new script
    expect(appended).toHaveLength(1);
    await expect(p2).resolves.toBe(FAKE_API);
    expect(p2).toBe(p1); // the same cached promise
  });

  it('a failed load followed by a second call appends a new script and can resolve', async () => {
    const { doc, win, scripts, appended, setDocsApi } = fakeEnv();
    const u = url();

    const p1 = loadDocsApi(u, 10_000, { doc, win });
    expect(scripts).toHaveLength(1);
    scripts[0]!.fire('error');
    await expect(p1).rejects.toThrow();
    expect(scripts[0]!.removed).toBe(true); // the failed script is removed, not left in the document

    setDocsApi(FAKE_API);
    const p2 = loadDocsApi(u, 10_000, { doc, win });
    expect(scripts).toHaveLength(2); // a retry appends a new script, not the same rejected promise
    expect(appended).toHaveLength(2);
    scripts[1]!.fire('load');
    await expect(p2).resolves.toBe(FAKE_API);
  });

  it('a timeout clears the cache entry and removes the script, so a later call retries', async () => {
    const { doc, win, scripts, setDocsApi } = fakeEnv();
    const u = url();

    // A short real timeout, never fired by the fake script: it must reject on its own.
    const p1 = loadDocsApi(u, 15, { doc, win });
    await expect(p1).rejects.toThrow('timeout');
    expect(scripts[0]!.removed).toBe(true);

    setDocsApi(FAKE_API);
    const p2 = loadDocsApi(u, 10_000, { doc, win });
    expect(scripts).toHaveLength(2); // the cache entry was cleared, so this is a fresh load, not the same rejection
    scripts[1]!.fire('load');
    await expect(p2).resolves.toBe(FAKE_API);
  });

  it('clears the load timer on every settle path: success, script error and a missing DocsAPI global', async () => {
    const clearSpy = vi.spyOn(global, 'clearTimeout');
    const callsBefore = () => clearSpy.mock.calls.length;

    // Success.
    {
      const { doc, win, scripts, setDocsApi } = fakeEnv();
      setDocsApi(FAKE_API);
      const before = callsBefore();
      const p = loadDocsApi(url(), 10_000, { doc, win });
      scripts[0]!.fire('load');
      await expect(p).resolves.toBe(FAKE_API);
      expect(callsBefore()).toBeGreaterThan(before);
    }
    // A script error.
    {
      const { doc, win, scripts } = fakeEnv();
      const before = callsBefore();
      const p = loadDocsApi(url(), 10_000, { doc, win });
      scripts[0]!.fire('error');
      await expect(p).rejects.toThrow();
      expect(callsBefore()).toBeGreaterThan(before);
    }
    // `load` fires, but `window.DocsAPI` never got defined.
    {
      const { doc, win, scripts } = fakeEnv();
      const before = callsBefore();
      const p = loadDocsApi(url(), 10_000, { doc, win });
      scripts[0]!.fire('load');
      await expect(p).rejects.toThrow();
      expect(callsBefore()).toBeGreaterThan(before);
    }

    clearSpy.mockRestore();
  });
});
