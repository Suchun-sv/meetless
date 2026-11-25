import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DomainEvent } from '@meetless/core';
import { ClientNode, LocalCache } from '../src/index';
import { callApi } from '../src/api-call';

/**
 * `ClientNode.api()` (routes reachable from the app), `redeemInvite` (the one
 * route callable before sign-in), the v3 blob-reference shape of `readBlob`,
 * `signOut`'s best-effort `session.revoke`, and `callApi`'s own error mapping.
 * Each test runs its own `node:http` stub; nothing here talks to a real server.
 */

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function startStub(handlers: Record<string, Handler>): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const key = `${req.method} ${new URL(req.url ?? '/', 'http://x').pathname}`;
    const handler = handlers[key];
    if (!handler) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    void readBody(req).then((body) => handler(req, res, body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${port}` };
}

/** Accepts every connection and never answers (for timeout tests). */
async function startHang(): Promise<{ server: Server; url: string }> {
  const server = createServer(() => undefined);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${port}` };
}

const meOk = (userId = 'u1'): Handler => (_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ user: { id: userId, displayName: userId } }));

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmpDataDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'meetless-api-'));
  dirs.push(d);
  return d;
}

const accountKey = (serverUrl: string, userId: string) => createHash('sha256').update(`${serverUrl}\n${userId}`).digest('hex').slice(0, 16);
const sha256Of = (b: Buffer) => `sha256:${createHash('sha256').update(b).digest('hex')}`;

/** Seeds one account's cache with events (as if sync had already happened) and drops blob files on disk. */
function seedAccount(dataDir: string, serverUrl: string, userId: string, events: DomainEvent[], blobs: [string, Buffer][] = []): void {
  const accountDir = join(dataDir, 'accounts', accountKey(serverUrl, userId));
  const seed = new LocalCache(join(accountDir, 'cache.sqlite'));
  const cursor = events.reduce((max, e) => Math.max(max, e.seq), 0);
  seed.append(events, cursor, null);
  seed.close();
  for (const [hash, bytes] of blobs) {
    const file = join(accountDir, 'blobs', hash.slice(7, 9), hash.slice(9));
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, bytes);
  }
}

describe('ClientNode.api', () => {
  it('sends the route with the bearer token and returns typed data', async () => {
    let seenAuth: string | undefined;
    const { server, url } = await startStub({
      'GET /v1/me': meOk(),
      'GET /v1/tokens': (req, res) => {
        seenAuth = req.headers.authorization;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ tokens: [] }));
      },
    });
    servers.push(server);
    const node = await ClientNode.open({ dataDir: tmpDataDir() });
    expect((await node.signIn(url, 'dev-lin')).ok).toBe(true);
    const r = await node.api('tokens.list', {});
    expect(r).toEqual({ ok: true, data: { tokens: [] } });
    expect(seenAuth).toBe('Bearer dev-lin');
    await node.close();
  });

  it('maps {error:{code}} to {ok:false, code} and a 404 to HTTP_404', async () => {
    const { server, url } = await startStub({
      'GET /v1/me': meOk(),
      'GET /v1/tokens': (_req, res) => res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'TOKEN_REVOKED' } })),
      // 'GET /v1/agent-calls' (agentCalls.list) is deliberately not wired: a plain 404.
    });
    servers.push(server);
    const node = await ClientNode.open({ dataDir: tmpDataDir() });
    await node.signIn(url, 'dev-lin');
    expect(await node.api('tokens.list', {})).toEqual({ ok: false, code: 'TOKEN_REVOKED' });
    expect(await node.api('agentCalls.list', {})).toEqual({ ok: false, code: 'HTTP_404' });
    await node.close();
  });

  it('refuses a non-app route without making a request', async () => {
    let tokenHits = 0;
    const { server, url } = await startStub({
      'GET /v1/me': meOk(),
      'POST /v1/projects/p1/work': (_req, res) => {
        tokenHits++;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ workId: 'w1', seq: 1 }));
      },
    });
    servers.push(server);
    const node = await ClientNode.open({ dataDir: tmpDataDir() });
    await node.signIn(url, 'dev-lin');
    // `work.record` is MCP-only (contract §3): the client refuses it before any request.
    expect(await node.api('work.record' as never, {} as never)).toEqual({ ok: false, code: 'NOT_AVAILABLE' });
    expect(tokenHits).toBe(0);
    await node.close();
  });
});

describe('callApi', () => {
  it('reports NETWORK (not an unhandled rejection) when reading the response body fails', async () => {
    const fetchImpl = (async () => ({ ok: true, status: 200, text: () => Promise.reject(new Error('stream broke')) })) as unknown as typeof fetch;
    const r = await callApi('http://127.0.0.1:1', null, 'tokens.list', {}, { fetchImpl });
    expect(r).toEqual({ ok: false, code: 'NETWORK', details: 'stream broke' });
  });
});

describe('ClientNode.redeemInvite', () => {
  it('strips whitespace from the code and upper-cases it, signs in with the returned token, and reports a bad code or a 404 with the URL tried', async () => {
    let seenBody: unknown;
    const { server, url } = await startStub({
      'GET /v1/me': meOk('u-new'),
      'POST /v1/invites/redeem': (_req, res, body) => {
        const parsed = JSON.parse(body) as { code: string; displayName: string; locale: string };
        seenBody = parsed;
        if (parsed.code === 'ABC123') {
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ token: 'tok-new', user: { id: 'u-new', displayName: 'New User', locale: 'en' }, projectId: null }));
        } else {
          res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'INVITE_INVALID' } }));
        }
      },
    });
    servers.push(server);
    const node = await ClientNode.open({ dataDir: tmpDataDir() });

    const ok = await node.redeemInvite(url, ' abc123 ', ' New User ');
    expect(ok.ok && ok.session.userId).toBe('u-new');
    expect(seenBody).toEqual({ code: 'ABC123', displayName: 'New User', locale: 'en' });

    // Every whitespace character goes, also inside the code (a code read out or pasted as "ABCD 1234").
    const spaced = await node.redeemInvite(url, ' ab c\t1\u00a023\n', 'New User');
    expect(spaced.ok).toBe(true);
    expect(seenBody).toEqual({ code: 'ABC123', displayName: 'New User', locale: 'en' });

    const bad = await node.redeemInvite(url, 'nope', 'Someone');
    expect(bad).toMatchObject({ ok: false, code: 'INVITE_INVALID', details: { url, cause: undefined } });

    const { server: bare, url: bareUrl } = await startStub({});
    servers.push(bare);
    const notFound = await node.redeemInvite(bareUrl, 'anycode', 'Someone');
    expect(notFound).toMatchObject({ ok: false, code: 'HTTP_404', details: { url: bareUrl } });

    await node.close();
  });

  it('rejects a URL with no scheme before making a request', async () => {
    const node = await ClientNode.open({ dataDir: tmpDataDir() });
    const r = await node.redeemInvite('127.0.0.1:4875', 'code1', 'Name');
    expect(r).toEqual({ ok: false, code: 'URL_NO_SCHEME', details: { url: '127.0.0.1:4875' } });
    await node.close();
  });

  it('strips a trailing slash from the server URL and signs in under the stripped form', async () => {
    let seenPath: string | undefined;
    const { server, url } = await startStub({
      'POST /v1/invites/redeem': (req, res) => {
        seenPath = req.url;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ token: 'tok', user: { id: 'u2', displayName: 'U2' } }));
      },
    });
    servers.push(server);
    const node = await ClientNode.open({ dataDir: tmpDataDir() });
    const r = await node.redeemInvite(`${url}/`, 'code1', 'Name');
    expect(r.ok && r.session.serverUrl).toBe(url);
    expect(seenPath).toBe('/v1/invites/redeem');
    await node.close();
  });

  it('reports BAD_RESPONSE for a 2xx with an unexpected body, without throwing', async () => {
    for (const body of ['', '{}', '<html>ok</html>']) {
      const { server, url } = await startStub({
        'POST /v1/invites/redeem': (_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end(body),
      });
      servers.push(server);
      const node = await ClientNode.open({ dataDir: tmpDataDir() });
      const r = await node.redeemInvite(url, 'code1', 'Name');
      expect(r).toEqual({ ok: false, code: 'BAD_RESPONSE', details: { url } });
      await node.close();
    }
  });

  it('times out instead of hanging when the server never answers', async () => {
    const { server, url } = await startHang();
    servers.push(server);
    const node = await ClientNode.open({ dataDir: tmpDataDir(), signInTimeoutMs: 100 });
    const r = await node.redeemInvite(url, 'code1', 'Name');
    expect(r).toMatchObject({ ok: false, code: 'TIMEOUT' });
    await node.close();
  });
});

describe('ClientNode.readBlob', () => {
  it('serves only blobs referenced by v3 events (input.imported)', async () => {
    const { server, url } = await startStub({ 'GET /v1/me': meOk() });
    servers.push(server);
    const dataDir = tmpDataDir();

    const keepBytes = Buffer.from('keep me');
    const dropBytes = Buffer.from('drop me');
    const keepHash = sha256Of(keepBytes);
    const dropHash = sha256Of(dropBytes);

    const event = {
      seq: 1,
      id: 'ev1',
      type: 'input.imported',
      actorId: 'u1',
      recordedAt: '2026-11-24T09:00:00Z',
      payload: { inputId: 'in1', projectId: 'p1', kind: 'txt', title: 'Doc', date: '2026-11-24', blobHash: keepHash, body: [], extracts: [], detector: 'rules/1' },
    } as unknown as DomainEvent;
    // Both blobs already sit on disk (as if downloaded earlier); only `keepHash` is referenced.
    seedAccount(dataDir, url, 'u1', [event], [[keepHash, keepBytes], [dropHash, dropBytes]]);

    const node = await ClientNode.open({ dataDir });
    expect((await node.signIn(url, 'dev-lin')).ok).toBe(true);

    const kept = await node.readBlob(keepHash);
    expect(kept.ok && Buffer.from(kept.bytes).toString('utf8')).toBe('keep me');
    expect(await node.readBlob(dropHash)).toEqual({ ok: false, code: 'NOT_AUTHORISED' });

    await node.close();
  });

  it('serves a blob referenced via an `input.shared` snapshot', async () => {
    const { server, url } = await startStub({ 'GET /v1/me': meOk() });
    servers.push(server);
    const dataDir = tmpDataDir();
    const bytes = Buffer.from('shared input');
    const hash = sha256Of(bytes);
    const event = {
      seq: 1,
      id: 'ev1',
      type: 'input.shared',
      actorId: 'u1',
      recordedAt: '2026-11-24T09:00:00Z',
      payload: {
        inputId: 'in1',
        snapshot: { input: { id: 'in1', projectId: 'p1', kind: 'txt', title: 'Doc', from: null, date: '2026-11-24', blobHash: hash, body: [], extracts: [], detector: 'rules/1', importedBy: 'u1', privateTo: null, seq: 1 } },
      },
    } as unknown as DomainEvent;
    seedAccount(dataDir, url, 'u1', [event], [[hash, bytes]]);

    const node = await ClientNode.open({ dataDir });
    await node.signIn(url, 'dev-lin');
    const r = await node.readBlob(hash);
    expect(r.ok && Buffer.from(r.bytes).toString('utf8')).toBe('shared input');
    await node.close();
  });

  it('serves a blob referenced via `artifact.version_added`', async () => {
    const { server, url } = await startStub({ 'GET /v1/me': meOk() });
    servers.push(server);
    const dataDir = tmpDataDir();
    const bytes = Buffer.from('version content');
    const hash = sha256Of(bytes);
    const event = {
      seq: 1,
      id: 'ev1',
      type: 'artifact.version_added',
      actorId: 'u1',
      recordedAt: '2026-11-24T09:00:00Z',
      payload: { artifactId: 'af1', versionId: 'v1', label: 'v1', date: '2026-11-24', note: '', blobHash: hash },
    } as unknown as DomainEvent;
    seedAccount(dataDir, url, 'u1', [event], [[hash, bytes]]);

    const node = await ClientNode.open({ dataDir });
    await node.signIn(url, 'dev-lin');
    const r = await node.readBlob(hash);
    expect(r.ok && Buffer.from(r.bytes).toString('utf8')).toBe('version content');
    await node.close();
  });

  it('serves blobs referenced via an `artifact.shared` snapshot, including a version\'s derived page hashes', async () => {
    const { server, url } = await startStub({ 'GET /v1/me': meOk() });
    servers.push(server);
    const dataDir = tmpDataDir();
    const versionBytes = Buffer.from('shared version');
    const pageBytes = Buffer.from('shared page');
    const versionHash = sha256Of(versionBytes);
    const pageHash = sha256Of(pageBytes);
    const event = {
      seq: 1,
      id: 'ev1',
      type: 'artifact.shared',
      actorId: 'u1',
      recordedAt: '2026-11-24T09:00:00Z',
      payload: {
        artifactId: 'af1',
        snapshot: {
          artifact: {
            id: 'af1',
            projectId: 'p1',
            kind: 'pdf',
            title: 'Doc',
            where: 'upload',
            url: null,
            needIds: [],
            privateTo: null,
            createdBy: 'u1',
            seq: 1,
            versions: [
              {
                id: 'v1',
                label: 'v1',
                date: '2026-11-24',
                roundId: null,
                note: '',
                blobHash: versionHash,
                mediaType: null,
                url: null,
                by: 'u1',
                seq: 1,
                derived: { status: 'ready', pageHashes: [pageHash], texts: [], error: null, converter: null },
              },
            ],
          },
        },
      },
    } as unknown as DomainEvent;
    seedAccount(dataDir, url, 'u1', [event], [[versionHash, versionBytes], [pageHash, pageBytes]]);

    const node = await ClientNode.open({ dataDir });
    await node.signIn(url, 'dev-lin');
    const version = await node.readBlob(versionHash);
    expect(version.ok && Buffer.from(version.bytes).toString('utf8')).toBe('shared version');
    const page = await node.readBlob(pageHash);
    expect(page.ok && Buffer.from(page.bytes).toString('utf8')).toBe('shared page');
    await node.close();
  });

  it('serves blobs referenced via `artifactVersion.derived` page hashes', async () => {
    const { server, url } = await startStub({ 'GET /v1/me': meOk() });
    servers.push(server);
    const dataDir = tmpDataDir();
    const pageBytes = Buffer.from('derived page');
    const pageHash = sha256Of(pageBytes);
    const event = {
      seq: 1,
      id: 'ev1',
      type: 'artifactVersion.derived',
      actorId: 'u1',
      recordedAt: '2026-11-24T09:00:00Z',
      payload: { artifactId: 'af1', versionId: 'v1', status: 'ready', pageHashes: [pageHash], texts: [], error: null, converter: null },
    } as unknown as DomainEvent;
    seedAccount(dataDir, url, 'u1', [event], [[pageHash, pageBytes]]);

    const node = await ClientNode.open({ dataDir });
    await node.signIn(url, 'dev-lin');
    const r = await node.readBlob(pageHash);
    expect(r.ok && Buffer.from(r.bytes).toString('utf8')).toBe('derived page');
    await node.close();
  });
});

describe('ClientNode.signOut', () => {
  it('best-effort revokes the server session (coordinator ruling) but always clears the local one', async () => {
    let revokeHits = 0;
    let revokeAuth: string | undefined;
    const { server, url } = await startStub({
      'GET /v1/me': meOk(),
      'DELETE /v1/session': (req, res) => {
        revokeHits++;
        revokeAuth = req.headers.authorization;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ revoked: true }));
      },
    });
    servers.push(server);
    const node = await ClientNode.open({ dataDir: tmpDataDir() });
    await node.signIn(url, 'dev-lin');
    await node.signOut();
    // Fire-and-forget: poll briefly for the loopback round trip to land, instead of a fixed sleep.
    const deadline = Date.now() + 2000;
    while (revokeHits === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
    expect(revokeHits).toBe(1);
    expect(revokeAuth).toBe('Bearer dev-lin');
    expect((await node.snapshot()).session).toBeNull();
    await node.close();
  });

  it('clears the local session even when the revoke call fails', async () => {
    // No '/v1/session' handler registered: the revoke call 404s and is ignored.
    const { server, url } = await startStub({ 'GET /v1/me': meOk() });
    servers.push(server);
    const node = await ClientNode.open({ dataDir: tmpDataDir() });
    await node.signIn(url, 'dev-lin');
    await expect(node.signOut()).resolves.toBeUndefined();
    expect((await node.snapshot()).session).toBeNull();
    await node.close();
  });
});
