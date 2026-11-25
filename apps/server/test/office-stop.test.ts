/**
 * Office worker shutdown (Phase 0 final review). No real converter: a fake
 * `opts.fetch` whose `/convert` never resolves until the request's
 * AbortSignal fires. Exercises `RunningServer.close()`, not `OfficeWorker`
 * directly, since the hardening is "close() waits for the worker to really
 * stop", not just a method on the worker.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256, startServer } from '../src/index';
import { IDS, requirePostgres, serverConfig, tempDir, testSchema } from './helpers';

const PPTX_MEDIA = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

describe('office worker shutdown', () => {
  it('close() aborts the in-flight /convert and resolves quickly without recording anything', async () => {
    await requirePostgres();
    const schema = testSchema();
    const dir = tempDir('office-stop');

    let sawConvert: () => void;
    const convertSeen = new Promise<void>((resolve) => {
      sawConvert = resolve;
    });
    let convertSignal: AbortSignal | undefined;
    let convertCalls = 0;

    const fakeFetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ converter: 'fake/1' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/convert')) {
        convertCalls++;
        convertSignal = init?.signal ?? undefined;
        sawConvert();
        // Never resolves on its own: only an abort ends it, like a real stuck converter call.
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      throw new Error(`office-stop test: unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

    const cfg = serverConfig({
      dataDir: dir.path,
      pgSchema: schema.name,
      workers: { office: { url: 'http://127.0.0.1:1', fetch: fakeFetch, retryDelayMs: 10 } },
    });

    const server = await startServer(cfg);
    try {
      const svc = server.service;
      const actor = IDS.lin;
      await svc.submit(actor, { id: randomUUID(), type: 'project.created', payload: { projectId: 'p-office-stop', name: 'Office stop' } });
      await svc.submit(actor, {
        id: randomUUID(),
        type: 'artifact.created',
        payload: { artifactId: 'a-office-stop', projectId: 'p-office-stop', kind: 'pptx', title: 'deck', where: 'local', needIds: [] },
      });
      const bytes = new TextEncoder().encode('fake pptx bytes for office-stop test');
      const hash = sha256(bytes);
      await svc.putBlob(actor, hash, bytes, PPTX_MEDIA);
      await svc.submit(actor, {
        id: randomUUID(),
        type: 'artifact.version_added',
        payload: { artifactId: 'a-office-stop', versionId: 'v-office-stop', label: 'deck', date: '2026-11-24', note: '', blobHash: hash, mediaType: PPTX_MEDIA },
      });

      await convertSeen; // the worker is now blocked inside the fake /convert call

      const start = Date.now();
      await server.close();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(2000);
      expect(convertCalls).toBe(1);
      expect(convertSignal?.aborted).toBe(true);
      const derived = svc.current.artifacts['a-office-stop']?.versions.find((v) => v.id === 'v-office-stop')?.derived;
      expect(derived).toBeFalsy();
    } finally {
      await schema.drop();
      dir.rm();
    }
  }, 10_000);
});
