/**
 * Per-page PDF text for artifact versions (Task 5b, contract §12.21): the PDF text
 * worker extracts `derived.texts` with unpdf, one entry per page, so artifact search
 * can read PDFs the same way it already reads `derived.texts` from the office worker.
 * Modelled on `office.e2e.test.ts` / `office-stop.test.ts`, but no external converter
 * service is involved — unpdf runs in-process — so these run against real Postgres
 * only (`withServer`), no `infra/dev/deps.sh` dependency.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { DerivedPreview } from '@meetless/core';
import { configFromEnv, sha256, startServer, type SyncService } from '../src/index';
import { capTexts, MAX_PDF_TEXT_CHARS } from '../src/office/pdf-text';
import { cmd, http, IDS, make, requirePostgres, serverConfig, tempDir, TEST_DATABASE_URL, testSchema, TOKENS, until, withServer } from './helpers';
import { MAX_IMPORT_BYTES } from '../src/imports/extract';
import { minimalPdf } from './support/pdf';

const PDF_MEDIA = 'application/pdf';

async function ok(svc: SyncService, actor: string, c: { id: string; type: string; payload: unknown }) {
  const r = await svc.submit(actor, c as never);
  expect(r, `${c.type} by ${actor}`).toMatchObject({ status: 'accepted' });
  return r;
}

/** Uploads `bytes` as a pdf blob and appends `artifact.version_added` for it. */
async function publishPdf(svc: SyncService, actor: string, artifactId: string, versionId: string, bytes: Uint8Array): Promise<string> {
  const hash = sha256(bytes);
  await svc.putBlob(actor, hash, bytes, PDF_MEDIA);
  await ok(svc, actor, cmd('artifact.version_added', { artifactId, versionId, label: versionId, date: '2026-11-24', note: '', blobHash: hash, mediaType: PDF_MEDIA }));
  return hash;
}

function derivedOf(svc: SyncService, artifactId: string, versionId: string): DerivedPreview | null | undefined {
  return svc.current.artifacts[artifactId]?.versions.find((v) => v.id === versionId)?.derived;
}

async function waitDerived(svc: SyncService, artifactId: string, versionId: string, ms = 8000): Promise<DerivedPreview> {
  return until(() => derivedOf(svc, artifactId, versionId), ms, `pdf text of ${artifactId}/${versionId}`);
}

describe('PdfTextWorker (real Postgres via withServer)', () => {
  it('a shared PDF artifact version gets derived.texts with one entry per page, status ready, no page images', async () => {
    const server = await withServer();
    try {
      const { svc } = server;
      await ok(svc, IDS.lin, make.project('P-pdf1'));
      await ok(svc, IDS.lin, cmd('artifact.created', { artifactId: 'art-1', projectId: 'P-pdf1', kind: 'pdf', title: 'Spec', where: 'local', needIds: [] }));

      const bytes = minimalPdf([['first page text'], ['second page text']]);
      await publishPdf(svc, IDS.lin, 'art-1', 'v-1', bytes);

      const d = await waitDerived(svc, 'art-1', 'v-1');
      expect(d.status).toBe('ready');
      expect(d.error).toBeNull();
      expect(d.pageHashes).toEqual([]); // no page images are rendered by this worker
      expect(d.texts).toHaveLength(2);
      expect(d.texts[0]).toContain('first page text');
      expect(d.texts[1]).toContain('second page text');
      expect(d.converter).toMatch(/^unpdf\//);
    } finally {
      await server.stop();
    }
  });

  it('a PDF with no text records failed no_text; a corrupt PDF records failed corrupt', async () => {
    const server = await withServer();
    try {
      const { svc } = server;
      await ok(svc, IDS.lin, make.project('P-pdf2'));
      await ok(svc, IDS.lin, cmd('artifact.created', { artifactId: 'art-empty', projectId: 'P-pdf2', kind: 'pdf', title: 'Empty', where: 'local', needIds: [] }));
      await ok(svc, IDS.lin, cmd('artifact.created', { artifactId: 'art-bad', projectId: 'P-pdf2', kind: 'pdf', title: 'Corrupt', where: 'local', needIds: [] }));

      await publishPdf(svc, IDS.lin, 'art-empty', 'v-empty', minimalPdf([]));
      await publishPdf(svc, IDS.lin, 'art-bad', 'v-bad', new TextEncoder().encode('not a pdf at all'));

      const empty = await waitDerived(svc, 'art-empty', 'v-empty');
      expect(empty).toMatchObject({ status: 'failed', error: 'no_text', texts: [], pageHashes: [] });

      const bad = await waitDerived(svc, 'art-bad', 'v-bad');
      expect(bad).toMatchObject({ status: 'failed', error: 'corrupt', texts: [], pageHashes: [] });
    } finally {
      await server.stop();
    }
  });

  it("a private PDF artifact's text reaches only its owner's view", async () => {
    const server = await withServer();
    try {
      const { svc } = server;
      const WORD = `glyphwatermelon${randomUUID().replaceAll('-', '').slice(0, 8)}`;
      await ok(svc, IDS.lin, make.project('P-pdf3'));
      await ok(svc, IDS.lin, make.member('P-pdf3', IDS.alex));
      await ok(
        svc,
        IDS.alex,
        cmd('artifact.created', { artifactId: 'art-priv', projectId: 'P-pdf3', kind: 'pdf', title: 'private notes', where: 'local', needIds: [], private: true }),
      );

      await publishPdf(svc, IDS.alex, 'art-priv', 'v-priv', minimalPdf([`secret word ${WORD}`]));
      await waitDerived(svc, 'art-priv', 'v-priv');

      const ownerView = svc.view(IDS.alex);
      const ownerDerived = ownerView.artifacts['art-priv']?.versions.find((v) => v.id === 'v-priv')?.derived;
      expect(ownerDerived?.texts.join(' ')).toContain(WORD);

      expect(JSON.stringify(svc.view(IDS.lin))).not.toContain(WORD);
      expect(JSON.stringify(svc.eventsFor(IDS.lin, 0))).not.toContain(WORD);
    } finally {
      await server.stop();
    }
  });

  it('versions that already have derived are not processed again after a restart', async () => {
    await requirePostgres();
    const schema = testSchema();
    const dir = tempDir('pdf-text-restart');
    const cfg = { dataDir: dir.path, pgSchema: schema.name };
    try {
      const server1 = await startServer(serverConfig(cfg));
      const svc1 = server1.service;
      await ok(svc1, IDS.lin, make.project('P-pdf4'));
      await ok(svc1, IDS.lin, cmd('artifact.created', { artifactId: 'art-r', projectId: 'P-pdf4', kind: 'pdf', title: 'Restart', where: 'local', needIds: [] }));
      await publishPdf(svc1, IDS.lin, 'art-r', 'v-r', minimalPdf(['restart text']));
      const first = await waitDerived(svc1, 'art-r', 'v-r');
      expect(first.status).toBe('ready');
      await server1.close();

      const server2 = await startServer(serverConfig(cfg));
      try {
        const svc2 = server2.service;
        // The restart scan only re-queues versions with blobHash and derived === null; this one
        // already has derived, so start() must not touch it again. Positive signal instead of a
        // blind sleep: drain() is a strictly serial FIFO queue (one item fully processed, including
        // its appendSystem, before the next is dequeued), so if the restart scan had wrongly
        // re-enqueued art-r/v-r, that reprocessing would have to finish before this sentinel's own
        // derived event ever appears.
        const headAfterRestart = svc2.head;
        await ok(svc2, IDS.lin, cmd('artifact.created', { artifactId: 'art-r2', projectId: 'P-pdf4', kind: 'pdf', title: 'Sentinel', where: 'local', needIds: [] }));
        await publishPdf(svc2, IDS.lin, 'art-r2', 'v-r2', minimalPdf(['sentinel text']));
        await waitDerived(svc2, 'art-r2', 'v-r2');

        // Exactly the sentinel's own 3 events (created, version_added, derived) were appended
        // since the restart — no fourth event from a wrongful re-derive of art-r/v-r.
        expect(svc2.head).toBe(headAfterRestart + 3);
        expect(derivedOf(svc2, 'art-r', 'v-r')).toEqual(first);
      } finally {
        await server2.close();
      }
    } finally {
      await schema.drop();
      dir.rm();
    }
  });

  it('MEETLESS_PDF_TEXT=off disables the worker', async () => {
    await requirePostgres();
    const schema = testSchema();
    const dir = tempDir('pdf-text-off');
    try {
      expect(configFromEnv({}).workers?.pdfText).toBe(true);
      expect(configFromEnv({ MEETLESS_PDF_TEXT: 'off' }).workers?.pdfText).toBe(false);

      const cfg = {
        ...configFromEnv({
          MEETLESS_DATA_DIR: dir.path,
          MEETLESS_DATABASE_URL: TEST_DATABASE_URL,
          MEETLESS_PG_SCHEMA: schema.name,
          MEETLESS_DEV_AUTH: '1',
          MEETLESS_OFFICE_URL: 'off',
          MEETLESS_PDF_TEXT: 'off',
        }),
        adminInvite: false,
        print: () => {},
      };
      const server = await startServer(cfg);
      try {
        // The worker was never constructed, so there is nothing to await, poll or race with:
        // this is the proof, not a behavioural side effect that needs a wait to observe.
        expect(server.pdfText).toBeNull();
      } finally {
        await server.close();
      }
    } finally {
      await schema.drop();
      dir.rm();
    }
  });
});

describe('PdfTextWorker stop() and parse timeout (injected parser, no real hang)', () => {
  it('close() resolves quickly while an injected parse never resolves; nothing is appended, even once its internal timeout later fires', async () => {
    await requirePostgres();
    const schema = testSchema();
    const dir = tempDir('pdf-text-hang');
    try {
      let sawParse: () => void;
      const parseStarted = new Promise<void>((resolve) => {
        sawParse = resolve;
      });
      const neverResolves = (): Promise<string[]> => {
        sawParse();
        return new Promise<string[]>(() => {}); // like a pathological PDF parse: never settles on its own
      };
      const cfg = serverConfig({
        dataDir: dir.path,
        pgSchema: schema.name,
        workers: { pdfText: { parse: neverResolves, stopGraceMs: 80, parseTimeoutMs: 150 } },
      });
      const server = await startServer(cfg);
      try {
        const svc = server.service;
        await ok(svc, IDS.lin, make.project('P-pdf-hang'));
        await ok(svc, IDS.lin, cmd('artifact.created', { artifactId: 'art-hang', projectId: 'P-pdf-hang', kind: 'pdf', title: 'Hang', where: 'local', needIds: [] }));
        await publishPdf(svc, IDS.lin, 'art-hang', 'v-hang', minimalPdf(['never parsed']));
        await parseStarted; // the worker is now blocked inside the injected, never-resolving parse call

        const start = Date.now();
        await server.close();
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(2500); // bounded by stopGraceMs (80ms) + overhead, not by the parse ever settling
        expect(derivedOf(svc, 'art-hang', 'v-hang')).toBeFalsy();

        // Bounded: past parseTimeoutMs (150ms), proving that even once the stopped parse's own
        // internal timeout eventually fires in the background, record() still writes nothing.
        await new Promise((r) => setTimeout(r, 300));
        expect(derivedOf(svc, 'art-hang', 'v-hang')).toBeFalsy();
      } finally {
        await server.close(); // idempotent; a no-op if the body above already closed it
      }
    } finally {
      await schema.drop();
      dir.rm();
    }
  });

  it('a parse slower than its injected timeout records status failed, error timeout', async () => {
    await requirePostgres();
    const schema = testSchema();
    const dir = tempDir('pdf-text-timeout');
    try {
      const slowParse = (): Promise<string[]> => new Promise((resolve) => setTimeout(() => resolve(['too slow']), 300));
      const cfg = serverConfig({ dataDir: dir.path, pgSchema: schema.name, workers: { pdfText: { parse: slowParse, parseTimeoutMs: 50 } } });
      const server = await startServer(cfg);
      try {
        const svc = server.service;
        await ok(svc, IDS.lin, make.project('P-pdf-to'));
        await ok(svc, IDS.lin, cmd('artifact.created', { artifactId: 'art-to', projectId: 'P-pdf-to', kind: 'pdf', title: 'Timeout', where: 'local', needIds: [] }));
        await publishPdf(svc, IDS.lin, 'art-to', 'v-to', minimalPdf(['slow']));

        const d = await waitDerived(svc, 'art-to', 'v-to');
        expect(d).toMatchObject({ status: 'failed', error: 'timeout', texts: [], pageHashes: [] });
      } finally {
        await server.close();
      }
    } finally {
      await schema.drop();
      dir.rm();
    }
  });

  it('a parse that finally resolves after stop() has already returned appends nothing', async () => {
    await requirePostgres();
    const schema = testSchema();
    const dir = tempDir('pdf-text-late');
    try {
      let resolveParse: ((pages: string[]) => void) | undefined;
      const lateParse = (): Promise<string[]> =>
        new Promise((resolve) => {
          resolveParse = resolve;
        });
      const cfg = serverConfig({
        dataDir: dir.path,
        pgSchema: schema.name,
        workers: { pdfText: { parse: lateParse, stopGraceMs: 30, parseTimeoutMs: 10_000 } },
      });
      const server = await startServer(cfg);
      try {
        const svc = server.service;
        await ok(svc, IDS.lin, make.project('P-pdf-late'));
        await ok(svc, IDS.lin, cmd('artifact.created', { artifactId: 'art-late', projectId: 'P-pdf-late', kind: 'pdf', title: 'Late', where: 'local', needIds: [] }));
        await publishPdf(svc, IDS.lin, 'art-late', 'v-late', minimalPdf(['late text']));

        // Positive signal: wait for the worker to actually have dequeued the version and called
        // the injected parse (which hangs until resolveParse is called below), not a fixed guess.
        await until(() => resolveParse !== undefined, 2000, 'injected parse invoked');

        await server.close(); // returns after stopGraceMs (30ms); the parse promise is still unresolved

        resolveParse!(['late text']); // let it finish now, well after stop() has already returned
        // Bounded: there is no positive signal for "nothing happens" — this just gives the
        // now-resolved promise's continuation (record()'s stopped check) a chance to run.
        await new Promise((r) => setTimeout(r, 100));
        expect(derivedOf(svc, 'art-late', 'v-late')).toBeFalsy();
      } finally {
        await server.close(); // idempotent; a no-op if the body above already closed it
      }
    } finally {
      await schema.drop();
      dir.rm();
    }
  });
});

describe('PdfTextWorker size cap and one parse at a time (final review I3)', () => {
  it('a pdf blob over MAX_IMPORT_BYTES records failed too_large without its bytes ever being read, and artifacts.read gives []', async () => {
    const server = await withServer();
    try {
      const { svc } = server;
      await ok(svc, IDS.lin, make.project('P-pdf-big'));
      await ok(svc, IDS.lin, cmd('artifact.created', { artifactId: 'art-big', projectId: 'P-pdf-big', kind: 'pdf', title: 'Big', where: 'local', needIds: [] }));
      const bytes = minimalPdf(['would be text if it were parsed']);
      const hash = sha256(bytes);
      // The stored meta says the blob is one byte over the cap (uploading 25 MB in a test is pointless).
      const realGet = svc.blobMeta.get.bind(svc.blobMeta);
      vi.spyOn(svc.blobMeta, 'get').mockImplementation(async (h) => {
        const m = await realGet(h);
        return m && h === hash ? { ...m, size: MAX_IMPORT_BYTES + 1 } : m;
      });
      const reads = vi.spyOn(svc.blobFiles, 'readBytes');
      await publishPdf(svc, IDS.lin, 'art-big', 'v-big', bytes);

      const d = await waitDerived(svc, 'art-big', 'v-big');
      expect(d).toMatchObject({ status: 'failed', error: 'too_large', texts: [], pageHashes: [], converter: null });
      expect(reads.mock.calls.filter(([h]) => h === hash)).toEqual([]);

      const r = await http(server.base, TOKENS.lin, 'GET', '/v1/projects/P-pdf-big/artifacts/art-big');
      expect(r.status).toBe(200);
      expect(r.json.text).toEqual([]);
      expect(reads.mock.calls.filter(([h]) => h === hash)).toEqual([]);
    } finally {
      vi.restoreAllMocks();
      await server.stop();
    }
  });

  it('after a parse times out, the next one does not start until the timed-out parse settles', async () => {
    const log: string[] = [];
    let releaseFirst!: () => void;
    const firstParse = new Promise<string[]>((resolve) => {
      releaseFirst = () => {
        log.push('settle:1');
        resolve(['late text']);
      };
    });
    let calls = 0;
    const parse = (): Promise<string[]> => {
      calls += 1;
      log.push(`start:${calls}`);
      return calls === 1 ? firstParse : Promise.resolve(['second pdf text']);
    };
    const server = await withServer({ workers: { pdfText: { parse, parseTimeoutMs: 1000, stopGraceMs: 50 } } });
    try {
      const { svc } = server;
      await ok(svc, IDS.lin, make.project('P-pdf-q'));
      for (const a of ['art-qa', 'art-qb']) await ok(svc, IDS.lin, cmd('artifact.created', { artifactId: a, projectId: 'P-pdf-q', kind: 'pdf', title: a, where: 'local', needIds: [] }));
      const bBytes = minimalPdf(['b']);
      const bHash = sha256(bBytes);

      // Once a's timeout is on record, count every step the worker takes toward b (its meta
      // lookup, its byte read). Without the wait, the worker moves on to b in the same run of
      // microtasks (both are called before any I/O completes), so by the next macrotask it would
      // already have asked for b.
      let armed = false;
      let bLookups = 0;
      const realGet = svc.blobMeta.get.bind(svc.blobMeta);
      vi.spyOn(svc.blobMeta, 'get').mockImplementation(async (h) => {
        if (armed && h === bHash) bLookups += 1;
        return realGet(h);
      });
      const realRead = svc.blobFiles.readBytes.bind(svc.blobFiles);
      vi.spyOn(svc.blobFiles, 'readBytes').mockImplementation(async (h) => {
        if (armed && h === bHash) bLookups += 1;
        return realRead(h);
      });
      const seen: { bLookups: number; calls: number }[] = [];
      const realAppend = svc.appendSystem.bind(svc);
      vi.spyOn(svc, 'appendSystem').mockImplementation(async (actor, c) => {
        const r = await realAppend(actor, c);
        const pl = c.payload as { versionId?: string; error?: string };
        if (pl.versionId === 'v-qa' && pl.error === 'timeout') {
          armed = true;
          setImmediate(() => {
            seen.push({ bLookups, calls });
            releaseFirst();
          });
        }
        return r;
      });

      await publishPdf(svc, IDS.lin, 'art-qa', 'v-qa', minimalPdf(['a']));
      await publishPdf(svc, IDS.lin, 'art-qb', 'v-qb', bBytes);

      const a = await waitDerived(svc, 'art-qa', 'v-qa');
      expect(a).toMatchObject({ status: 'failed', error: 'timeout' });
      const b = await waitDerived(svc, 'art-qb', 'v-qb');
      expect(b).toMatchObject({ status: 'ready', texts: ['second pdf text'] });
      // At the timeout the worker had not even looked b up, nor parsed it; b started only after a settled.
      expect(seen).toEqual([{ bLookups: 0, calls: 1 }]);
      expect(log).toEqual(['start:1', 'settle:1', 'start:2']);
    } finally {
      vi.restoreAllMocks();
      await server.stop();
    }
  });

  it('close() is still bounded by the stop grace while a timed-out parse never settles', async () => {
    let started = 0;
    const neverSettles = (): Promise<string[]> => {
      started += 1;
      return new Promise<string[]>(() => {});
    };
    const server = await withServer({ workers: { pdfText: { parse: neverSettles, parseTimeoutMs: 50, stopGraceMs: 50 } } });
    let stopped = false;
    try {
      const { svc } = server;
      await ok(svc, IDS.lin, make.project('P-pdf-ls'));
      for (const a of ['art-la', 'art-lb']) await ok(svc, IDS.lin, cmd('artifact.created', { artifactId: a, projectId: 'P-pdf-ls', kind: 'pdf', title: a, where: 'local', needIds: [] }));
      await publishPdf(svc, IDS.lin, 'art-la', 'v-la', minimalPdf(['a']));
      await publishPdf(svc, IDS.lin, 'art-lb', 'v-lb', minimalPdf(['b']));
      expect(await waitDerived(svc, 'art-la', 'v-la')).toMatchObject({ status: 'failed', error: 'timeout' });

      const closing = server.stop().then(() => 'closed');
      stopped = true;
      expect(await Promise.race([closing, new Promise((r) => setTimeout(() => r('hung'), 3000))])).toBe('closed');
      // The second version was never parsed: the queue was still waiting on the first.
      expect(started).toBe(1);
      expect(derivedOf(svc, 'art-lb', 'v-lb')).toBeNull();
    } finally {
      if (!stopped) await server.stop();
    }
  });
});

describe('capTexts (pure cap arithmetic)', () => {
  it('leaves pages under the cap untouched', () => {
    expect(capTexts(['a', 'b', 'c'], 100)).toEqual(['a', 'b', 'c']);
  });

  it('truncates only the page that crosses the cap; later pages become empty', () => {
    const texts = ['x'.repeat(6), 'y'.repeat(6), 'z'.repeat(6)];
    const capped = capTexts(texts, 10);
    expect(capped[0]).toBe('x'.repeat(6));
    expect(capped[1]).toBe('y'.repeat(4)); // 6 + 4 = 10
    expect(capped[2]).toBe('');
  });

  it('defaults to MAX_PDF_TEXT_CHARS (500000)', () => {
    expect(MAX_PDF_TEXT_CHARS).toBe(500_000);
    const capped = capTexts(['x'.repeat(500_001)]);
    expect(capped[0]).toHaveLength(500_000);
  });
});
