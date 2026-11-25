/**
 * OnlyOffice view config, signed file tickets and the files socket (Task 8; contract §12.6,
 * §12.13; plan "DocumentServer reachability"). `office.config` builds a view-only config for
 * one artifact version and signs it; the actual file is fetched later by DocumentServer's
 * relay through a ticket on a Unix socket this server listens on — never on the TCP server.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { connect } from 'node:net';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { sha256 } from '../src/blobs';
import type { ApiDeps } from '../src/api/frame';
import { startFilesSocket } from '../src/office/files-socket';
import { signHs256, verifyHs256 } from '../src/office/jwt';
import { OfficeViewer } from '../src/office/onlyoffice';
import { OfficeWorker } from '../src/office/worker';
import { PdfTextWorker } from '../src/office/pdf-text';
import { OfficeTickets, TICKET_TTL_MS } from '../src/office/tickets';
import { configFromEnv, startServer } from '../src/index';
import type { SyncService } from '../src/service';
import { MemoryBlobMetaStore } from '../src/store/memory';
import { BlobFiles } from '../src/blobs';
import { http, IDS, requirePostgres, serverConfig, TOKENS, tempDir, testSchema, withServer } from './helpers';
import { seedTeam } from './seed';
import { minimalPdf } from './support/pdf';

const PDF_MEDIA = 'application/pdf';
const DOCX_MEDIA = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SECRET = 'test-onlyoffice-jwt-secret';
const PUBLIC_URL = 'http://meetless-onlyoffice-files:8080';

/** A bare node:http stub standing in for DocumentServer's own healthcheck endpoint. */
function dsStub(healthy: boolean): Promise<{ url: string; close(): Promise<void> }> {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      if (req.url === '/healthcheck') {
        res.writeHead(healthy ? 200 : 503, { 'content-type': 'text/plain' });
        res.end(healthy ? 'true' : 'false');
        return;
      }
      res.writeHead(404);
      res.end();
    });
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => srv.close(() => r())) });
    });
  });
}

/** A raw GET through a Unix socket (bypasses any TCP server entirely), as DocumentServer's relay would make it. */
function viaSocket(socketPath: string, url: string): Promise<{ status: number; headers: IncomingHttpHeaders; bytes: Buffer; json: unknown }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpRequest({ socketPath, path: u.pathname, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        let json: unknown = null;
        try {
          json = JSON.parse(bytes.toString('utf8'));
        } catch {
          // body is not JSON (a real blob) - leave json null
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, bytes, json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Sends literal bytes over a raw connection to a Unix socket and waits (bounded) for either
 * a reply or the connection closing. Used only to prove a malformed request cannot crash the
 * server — the real assertion in that test is the *next*, well-formed request still working.
 */
function rawRequest(socketPath: string, raw: string): Promise<void> {
  return new Promise((resolve) => {
    const sock = connect(socketPath, () => sock.write(raw));
    const done = () => {
      sock.destroy();
      resolve();
    };
    sock.on('data', done);
    sock.on('end', done);
    sock.on('close', done);
    sock.on('error', done);
    setTimeout(done, 1000);
  });
}

async function publishVersion(
  svc: SyncService,
  actor: string,
  artifactId: string,
  versionId: string,
  bytes: Uint8Array | null,
  mediaType: string,
  label = 'v1',
): Promise<string | null> {
  let hash: string | null = null;
  if (bytes) {
    hash = sha256(bytes);
    await svc.putBlob(actor, hash, bytes, mediaType);
  }
  const r = await svc.submit(actor, {
    id: randomUUID(),
    type: 'artifact.version_added',
    payload: { artifactId, versionId, label, date: '2026-11-24', note: '', blobHash: hash, mediaType: hash ? mediaType : null },
  });
  expect(r.status, `artifact.version_added for ${artifactId}`).toBe('accepted');
  return hash;
}

describe('office.config: real server, end to end', () => {
  it('gives a view-only config signed with the secret and a ticket URL under MEETLESS_PUBLIC_URL', async () => {
    const stub = await dsStub(true);
    const dir = tempDir('office-e2e');
    const server = await withServer({
      onlyoffice: { url: stub.url, jwtSecret: SECRET, publicUrl: PUBLIC_URL, filesSocket: join(dir.path, 's', 'files.sock') },
    });
    try {
      const team = await seedTeam(server.base);
      await publishVersion(server.svc, IDS.alex, team.artifacts.deck, 'v-deck-ok', minimalPdf(['hello world']), PDF_MEDIA);

      const res = await http(
        server.base,
        TOKENS.alex,
        'GET',
        `/v1/projects/${team.projectId}/artifacts/${team.artifacts.deck}/versions/v-deck-ok/office`,
      );
      expect(res.status).toBe(200);
      const r = res.json as { available: true; documentServerUrl: string; config: Record<string, unknown> };
      expect(r).toMatchObject({ available: true, documentServerUrl: stub.url });

      const config = r.config as { editorConfig: { mode: string }; document: { permissions: { edit: boolean }; url: string }; token: string };
      expect(config.editorConfig.mode).toBe('view');
      expect(config.document.permissions.edit).toBe(false);
      expect(config.editorConfig).not.toHaveProperty('callbackUrl');
      expect(config.document.url).toMatch(/^http:\/\/meetless-onlyoffice-files:8080\/v1\/office-files\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.pdf$/);

      const { token, ...rest } = r.config as { token: string } & Record<string, unknown>;
      expect(verifyHs256(token, SECRET)).toEqual(rest);
    } finally {
      await server.stop();
      await stub.close();
      dir.rm();
    }
  });

  it('a dot symbol in the artifact title or version label never reaches the visible document title', async () => {
    const stub = await dsStub(true);
    const dir = tempDir('office-dots');
    const server = await withServer({
      onlyoffice: { url: stub.url, jwtSecret: SECRET, publicUrl: PUBLIC_URL, filesSocket: join(dir.path, 's', 'files.sock') },
    });
    try {
      const team = await seedTeam(server.base);
      const r = await server.svc.submit(IDS.alex, {
        id: randomUUID(),
        type: 'artifact.created',
        payload: { artifactId: 'art-dots', projectId: team.projectId, kind: 'pdf', title: 'Deck · v2 · final', where: 'local', needIds: [] },
      });
      expect(r.status).toBe('accepted');
      await publishVersion(server.svc, IDS.alex, 'art-dots', 'v-dots', minimalPdf(['x']), PDF_MEDIA, 'final cut • for review');

      const res = await http(server.base, TOKENS.alex, 'GET', `/v1/projects/${team.projectId}/artifacts/art-dots/versions/v-dots/office`);
      expect(res.status).toBe(200);
      const title = (res.json as { config: { document: { title: string } } }).config.document.title;
      for (const dot of ['·', '•', '●']) expect(title).not.toContain(dot);
    } finally {
      await server.stop();
      await stub.close();
      dir.rm();
    }
  });

  it('the TCP server does not serve /v1/office-files (the socket is the only way to reach a file)', async () => {
    const server = await withServer();
    try {
      const res = await http(server.base, null, 'GET', '/v1/office-files/anything.pdf');
      expect(res.status).toBe(404);
    } finally {
      await server.stop();
    }
  });
});

describe('office.config + the files socket: a real round trip, and what a restart does to it', () => {
  it('fetches the actual bytes through the real socket; restarting with the same dataDir/pgSchema invalidates the old ticket', async () => {
    await requirePostgres();
    const schema = testSchema();
    const dir = tempDir('office-roundtrip');
    const stub = await dsStub(true);
    const onlyoffice = { url: stub.url, jwtSecret: SECRET, publicUrl: PUBLIC_URL, filesSocket: join(dir.path, 'office-sock', 'files.sock') };
    const cfg = { dataDir: dir.path, pgSchema: schema.name, onlyoffice };
    try {
      let pathname = '';
      const bytes = minimalPdf(['round trip bytes']);

      const server1 = await startServer(serverConfig(cfg));
      try {
        const team = await seedTeam(server1.url);
        await publishVersion(server1.service, IDS.alex, team.artifacts.deck, 'v-rt', bytes, PDF_MEDIA);

        const res = await http(server1.url, TOKENS.alex, 'GET', `/v1/projects/${team.projectId}/artifacts/${team.artifacts.deck}/versions/v-rt/office`);
        expect(res.status).toBe(200);
        pathname = new URL((res.json as { config: { document: { url: string } } }).config.document.url).pathname;

        const before = await viaSocket(server1.filesSocket!, `http://x${pathname}`);
        expect(before.status).toBe(200);
        expect(before.headers['content-type']).toBe(PDF_MEDIA);
        expect(before.bytes.equals(Buffer.from(bytes))).toBe(true);
      } finally {
        await server1.close();
      }

      const server2 = await startServer(serverConfig(cfg));
      try {
        const after = await viaSocket(server2.filesSocket!, `http://x${pathname}`);
        expect(after.status).toBe(403);
        expect(after.json).toEqual({ error: { code: 'NOT_AUTHORISED' } });
        expect(after.bytes.length).toBeLessThan(bytes.byteLength); // no blob bytes, just the small error body
      } finally {
        await server2.close();
      }
    } finally {
      await stub.close();
      await schema.drop();
      dir.rm();
    }
  }, 15_000);
});

describe('office.config: reasons it cannot serve', () => {
  it('not_configured without a secret (url and socket present)', async () => {
    const stub = await dsStub(true);
    const dir = tempDir('office-reasons-noconf');
    const server = await withServer({
      onlyoffice: { url: stub.url, jwtSecret: null, publicUrl: PUBLIC_URL, filesSocket: join(dir.path, 's', 'files.sock') },
    });
    try {
      const team = await seedTeam(server.base);
      await publishVersion(server.svc, IDS.alex, team.artifacts.deck, 'v-deck-noconf', minimalPdf(['x']), PDF_MEDIA);
      const res = await http(server.base, TOKENS.alex, 'GET', `/v1/projects/${team.projectId}/artifacts/${team.artifacts.deck}/versions/v-deck-noconf/office`);
      expect(res.json).toEqual({ available: false, reason: 'not_configured' });
    } finally {
      await server.stop();
      await stub.close();
      dir.rm();
    }
  });

  it('unsupported_kind for an overleaf artifact; no_file without a blob; unavailable when the health check fails; a private artifact is indistinguishable from one that never existed', async () => {
    const dir = tempDir('office-reasons');
    // url deliberately unreachable: unsupported_kind/no_file must not even get there, and it is exactly what "unavailable" needs.
    const server = await withServer({
      onlyoffice: { url: 'http://127.0.0.1:1', jwtSecret: SECRET, publicUrl: PUBLIC_URL, filesSocket: join(dir.path, 's', 'files.sock') },
    });
    try {
      const team = await seedTeam(server.base);
      const p = team.projectId;

      await server.svc.submit(IDS.alex, { id: randomUUID(), type: 'artifact.created', payload: { artifactId: 'art-overleaf', projectId: p, kind: 'overleaf', title: 'Paper', where: 'overleaf', needIds: [] } });
      await publishVersion(server.svc, IDS.alex, 'art-overleaf', 'v-overleaf', null, 'text/plain');

      await server.svc.submit(IDS.alex, { id: randomUUID(), type: 'artifact.created', payload: { artifactId: 'art-nofile', projectId: p, kind: 'pdf', title: 'No file yet', where: 'local', needIds: [] } });
      await publishVersion(server.svc, IDS.alex, 'art-nofile', 'v-nofile', null, PDF_MEDIA);

      await publishVersion(server.svc, IDS.alex, team.artifacts.deck, 'v-deck-unavail', minimalPdf(['y']), PDF_MEDIA);
      await publishVersion(server.svc, IDS.alex, team.artifacts.secret, 'v-secret', minimalPdf(['confidential']), DOCX_MEDIA);

      const ask = (artifactId: string, versionId: string, actor: string) =>
        http(server.base, actor, 'GET', `/v1/projects/${p}/artifacts/${artifactId}/versions/${versionId}/office`);

      expect((await ask('art-overleaf', 'v-overleaf', TOKENS.alex)).json).toEqual({ available: false, reason: 'unsupported_kind' });
      expect((await ask('art-nofile', 'v-nofile', TOKENS.alex)).json).toEqual({ available: false, reason: 'no_file' });
      expect((await ask(team.artifacts.deck, 'v-deck-unavail', TOKENS.alex)).json).toEqual({ available: false, reason: 'unavailable' });

      // Positive control: Alex, the owner, asking about the very same private artifact/version
      // is NOT NOT_FOUND. This is what proves the privacy check below is actually about
      // visibility, and not some other reason the whole route is failing for everyone.
      const asAlex = await ask(team.artifacts.secret, 'v-secret', TOKENS.alex);
      expect(asAlex.status).not.toBe(404);
      expect(asAlex.json).toMatchObject({ available: false, reason: 'unavailable' });

      // team.artifacts.secret is Alex's private docx: Lin is a project member but must not even
      // learn it has an office preview. Compared against a *never-existing* artifact id, Lin's
      // response must be byte-for-byte the same once the two different echoed ids are
      // normalised — a real artifact that is merely hidden must look exactly like nothing.
      const asLin = await ask(team.artifacts.secret, 'v-secret', TOKENS.lin);
      const neverExisted = await ask('art-does-not-exist-at-all', 'v-does-not-exist-either', TOKENS.lin);
      expect(asLin.status).toBe(404);
      expect(neverExisted.status).toBe(404);
      const normalise = (j: unknown) =>
        JSON.stringify(j)
          .replace(/art-[a-zA-Z0-9-]+/g, '<artifactId>')
          .replace(/v-(does-not-exist-either|secret)/g, '<versionId>');
      expect(normalise(asLin.json)).toBe(normalise(neverExisted.json));
    } finally {
      await server.stop();
      dir.rm();
    }
  });

  it('an unknown version id, and a version of another project, both answer NOT_FOUND', async () => {
    const dir = tempDir('office-reasons-notfound');
    const server = await withServer({
      onlyoffice: { url: 'http://127.0.0.1:1', jwtSecret: SECRET, publicUrl: PUBLIC_URL, filesSocket: join(dir.path, 's', 'files.sock') },
    });
    try {
      const team = await seedTeam(server.base);
      const r1 = await http(server.base, TOKENS.alex, 'GET', `/v1/projects/${team.projectId}/artifacts/${team.artifacts.deck}/versions/no-such-version/office`);
      expect(r1.status).toBe(404);
      expect(r1.json).toMatchObject({ error: { code: 'NOT_FOUND' } });

      const r2 = await http(server.base, TOKENS.alex, 'GET', `/v1/projects/${team.projectId}/artifacts/no-such-artifact/versions/no-such-version/office`);
      expect(r2.status).toBe(404);
      expect(r2.json).toMatchObject({ error: { code: 'NOT_FOUND' } });
    } finally {
      await server.stop();
      dir.rm();
    }
  });
});

describe('startFilesSocket: serving a ticket', () => {
  it('serves the blob for a valid ticket with its own media type, content-length and cache-control: no-store', async () => {
    const dir = tempDir('files-socket');
    const blobFiles = new BlobFiles(dir.path);
    const blobMeta = new MemoryBlobMetaStore();
    const bytes = minimalPdf(['socket test content']);
    const hash = sha256(bytes);
    await blobFiles.write(hash, bytes);
    await blobMeta.put({ hash, size: bytes.byteLength, mediaType: PDF_MEDIA }, 'u-alex');

    const secret = randomBytes(32);
    const tickets = new OfficeTickets(secret);
    const socketPath = join(dir.path, 'sock', 'files.sock');
    const socket = await startFilesSocket({ path: socketPath, tickets, blobMeta, blobFiles, ownDir: true });
    try {
      const ticket = tickets.issue({ hash, mediaType: PDF_MEDIA, ext: 'pdf' });
      const good = await viaSocket(socketPath, `http://x/v1/office-files/${ticket}.pdf`);
      expect(good.status).toBe(200);
      expect(good.headers['content-type']).toBe(PDF_MEDIA);
      expect(good.headers['content-length']).toBe(String(bytes.byteLength));
      expect(good.headers['cache-control']).toBe('no-store');
      expect(good.bytes.equals(Buffer.from(bytes))).toBe(true);
    } finally {
      await socket.close();
      dir.rm();
    }
  });

  it('a tampered, expired or other-server ticket is NOT_AUTHORISED with no bytes leaked', async () => {
    const dir = tempDir('files-socket-bad-tickets');
    const blobFiles = new BlobFiles(dir.path);
    const blobMeta = new MemoryBlobMetaStore();
    const bytes = minimalPdf(['socket test content']);
    const hash = sha256(bytes);
    await blobFiles.write(hash, bytes);
    await blobMeta.put({ hash, size: bytes.byteLength, mediaType: PDF_MEDIA }, 'u-alex');

    const secret = randomBytes(32);
    const tickets = new OfficeTickets(secret);
    const socketPath = join(dir.path, 'sock', 'files.sock');
    const socket = await startFilesSocket({ path: socketPath, tickets, blobMeta, blobFiles, ownDir: true });
    try {
      const ticket = tickets.issue({ hash, mediaType: PDF_MEDIA, ext: 'pdf' });

      const tamperedTicket = ticket.slice(0, -2) + (ticket.endsWith('AA') ? 'BB' : 'AA');
      const tampered = await viaSocket(socketPath, `http://x/v1/office-files/${tamperedTicket}.pdf`);
      expect(tampered.status).toBe(403);
      expect(tampered.json).toEqual({ error: { code: 'NOT_AUTHORISED' } });
      expect(tampered.bytes.length).toBeLessThan(bytes.byteLength);

      const expiredIssuer = new OfficeTickets(secret, () => Date.now() - TICKET_TTL_MS - 10_000);
      const expiredTicket = expiredIssuer.issue({ hash, mediaType: PDF_MEDIA, ext: 'pdf' });
      const expired = await viaSocket(socketPath, `http://x/v1/office-files/${expiredTicket}.pdf`);
      expect(expired.status).toBe(403);
      expect(expired.json).toEqual({ error: { code: 'NOT_AUTHORISED' } });

      const otherServer = new OfficeTickets();
      const otherTicket = otherServer.issue({ hash, mediaType: PDF_MEDIA, ext: 'pdf' });
      const other = await viaSocket(socketPath, `http://x/v1/office-files/${otherTicket}.pdf`);
      expect(other.status).toBe(403);
      expect(other.json).toEqual({ error: { code: 'NOT_AUTHORISED' } });

      // Anything else: wrong method/path shape.
      const missing = await viaSocket(socketPath, 'http://x/v1/not-office-files/whatever.pdf');
      expect(missing.status).toBe(404);
    } finally {
      await socket.close();
      dir.rm();
    }
  });

  it('a valid ticket served under the wrong extension (or a bogus one) is NOT_FOUND, never served as if it matched', async () => {
    const dir = tempDir('files-socket-ext');
    const blobFiles = new BlobFiles(dir.path);
    const blobMeta = new MemoryBlobMetaStore();
    const bytes = minimalPdf(['ext test']);
    const hash = sha256(bytes);
    await blobFiles.write(hash, bytes);
    await blobMeta.put({ hash, size: bytes.byteLength, mediaType: PDF_MEDIA }, 'u-alex');

    const tickets = new OfficeTickets();
    const socketPath = join(dir.path, 'sock', 'files.sock');
    const socket = await startFilesSocket({ path: socketPath, tickets, blobMeta, blobFiles, ownDir: true });
    try {
      const ticket = tickets.issue({ hash, mediaType: PDF_MEDIA, ext: 'pdf' });

      const wrongRealExt = await viaSocket(socketPath, `http://x/v1/office-files/${ticket}.docx`);
      expect(wrongRealExt.status).toBe(404);
      expect(wrongRealExt.bytes.length).toBeLessThan(bytes.byteLength);

      const bogusExt = await viaSocket(socketPath, `http://x/v1/office-files/${ticket}.xyz`);
      expect(bogusExt.status).toBe(404);

      // A bare ticket with no extension at all: `<payload>.<sig>`, no third dot-separated
      // part. Splitting on the *last* dot (the naive approach) would cut the ticket itself in
      // half instead of finding a missing extension, and happen to fail verification for the
      // wrong reason — require exactly three non-empty parts before ever calling verify(), so
      // this is 404, not 403.
      const bare = await viaSocket(socketPath, `http://x/v1/office-files/${ticket}`);
      expect(bare.status).toBe(404);
      expect(bare.json).toEqual({ error: { code: 'NOT_FOUND' } });
      expect(bare.bytes.length).toBeLessThan(bytes.byteLength);

      // The correct extension on the very same ticket still works.
      const right = await viaSocket(socketPath, `http://x/v1/office-files/${ticket}.pdf`);
      expect(right.status).toBe(200);
      expect(right.bytes.equals(Buffer.from(bytes))).toBe(true);
    } finally {
      await socket.close();
      dir.rm();
    }
  });

  it('a blob whose metadata exists but whose file is missing answers 404 cleanly, not a connection reset mid-stream', async () => {
    const dir = tempDir('files-socket-missing-file');
    const blobFiles = new BlobFiles(dir.path);
    const blobMeta = new MemoryBlobMetaStore();
    // Metadata only: blobFiles.write() is deliberately never called, simulating a blob whose
    // bytes went missing (or were never written) after its metadata was recorded.
    const hash = sha256(minimalPdf(['never actually written to disk']));
    await blobMeta.put({ hash, size: 123, mediaType: PDF_MEDIA }, 'u-alex');

    const tickets = new OfficeTickets();
    const socketPath = join(dir.path, 'sock', 'files.sock');
    const socket = await startFilesSocket({ path: socketPath, tickets, blobMeta, blobFiles, ownDir: true });
    try {
      const ticket = tickets.issue({ hash, mediaType: PDF_MEDIA, ext: 'pdf' });
      const res = await viaSocket(socketPath, `http://x/v1/office-files/${ticket}.pdf`);
      expect(res.status).toBe(404);
      expect(res.json).toEqual({ error: { code: 'NOT_FOUND' } });
    } finally {
      await socket.close();
      dir.rm();
    }
  });

  it('a malformed request-target does not crash the server; a later valid ticket still answers 200', async () => {
    const dir = tempDir('files-socket-malformed');
    const blobFiles = new BlobFiles(dir.path);
    const blobMeta = new MemoryBlobMetaStore();
    const bytes = minimalPdf(['malformed-request regression']);
    const hash = sha256(bytes);
    await blobFiles.write(hash, bytes);
    await blobMeta.put({ hash, size: bytes.byteLength, mediaType: PDF_MEDIA }, 'u-alex');

    const tickets = new OfficeTickets();
    const socketPath = join(dir.path, 'sock', 'files.sock');
    const socket = await startFilesSocket({ path: socketPath, tickets, blobMeta, blobFiles, ownDir: true });
    try {
      // An absolute-form request-target with an unterminated IPv6 literal: Node's own HTTP
      // parser accepts this as a request line (the target is opaque text to it), but
      // `new URL(req.url, base)` throws on it. That throw, if it ever escapes the request
      // handler unhandled, takes the whole process down.
      await rawRequest(socketPath, 'GET http://[::1 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');

      const ticket = tickets.issue({ hash, mediaType: PDF_MEDIA, ext: 'pdf' });
      const good = await viaSocket(socketPath, `http://x/v1/office-files/${ticket}.pdf`);
      expect(good.status).toBe(200);
      expect(good.bytes.equals(Buffer.from(bytes))).toBe(true);
    } finally {
      await socket.close();
      dir.rm();
    }
  });
});

describe('startFilesSocket: stale-file and directory safety', () => {
  it('a real leftover socket from a crashed process is replaced and gets mode 600', async () => {
    const dir = tempDir('files-socket-stale-real');
    const blobFiles = new BlobFiles(dir.path);
    const blobMeta = new MemoryBlobMetaStore();
    const socketPath = join(dir.path, 'sock', 'files.sock');

    // A real socket, never cleanly closed (simulating a process that died without unlinking
    // it): the socket *file* survives on disk even though nothing serves it any more.
    mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
    const leftover = createServer();
    await new Promise<void>((resolve, reject) => {
      leftover.once('error', reject);
      leftover.listen(socketPath, resolve);
    });
    expect(statSync(socketPath).isSocket()).toBe(true);

    const socket = await startFilesSocket({ path: socketPath, tickets: new OfficeTickets(), blobMeta, blobFiles, ownDir: true });
    try {
      expect(statSync(socketPath).mode & 0o777).toBe(0o600);
    } finally {
      await socket.close();
      await new Promise<void>((resolve) => leftover.close(() => resolve()));
      dir.rm();
    }
  });

  it('a regular file at the socket path makes start fail, naming the path, and the file survives untouched', async () => {
    const dir = tempDir('files-socket-regular-file');
    const blobFiles = new BlobFiles(dir.path);
    const blobMeta = new MemoryBlobMetaStore();
    const socketPath = join(dir.path, 'sock', 'files.sock');
    mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
    writeFileSync(socketPath, 'a real file, not a socket');

    try {
      await expect(startFilesSocket({ path: socketPath, tickets: new OfficeTickets(), blobMeta, blobFiles, ownDir: true })).rejects.toThrow(/not a socket/);
      expect(readFileSync(socketPath, 'utf8')).toBe('a real file, not a socket');
    } finally {
      dir.rm();
    }
  });

  it('creates a missing directory at 0700 regardless of ownDir', async () => {
    const dir = tempDir('files-socket-dir-create');
    const socketPath = join(dir.path, 'sock', 'files.sock');
    const blobFiles = new BlobFiles(dir.path);
    const blobMeta = new MemoryBlobMetaStore();
    const socket = await startFilesSocket({ path: socketPath, tickets: new OfficeTickets(), blobMeta, blobFiles });
    try {
      expect(statSync(dirname(socketPath)).mode & 0o777).toBe(0o700);
    } finally {
      await socket.close();
      dir.rm();
    }
  });

  it('ownDir re-asserts 0700 on its own already-existing directory, even at a different mode', async () => {
    const dir = tempDir('files-socket-owndir-fix');
    const socketPath = join(dir.path, 'sock', 'files.sock');
    mkdirSync(dirname(socketPath), { recursive: true, mode: 0o755 });
    const blobFiles = new BlobFiles(dir.path);
    const blobMeta = new MemoryBlobMetaStore();
    const socket = await startFilesSocket({ path: socketPath, tickets: new OfficeTickets(), blobMeta, blobFiles, ownDir: true });
    try {
      expect(statSync(dirname(socketPath)).mode & 0o777).toBe(0o700);
    } finally {
      await socket.close();
      dir.rm();
    }
  });

  it('a custom (non-owned) pre-existing directory at the wrong mode makes start fail, and is left untouched', async () => {
    const dir = tempDir('files-socket-custom-wrong-mode');
    const socketPath = join(dir.path, 'sock', 'files.sock');
    mkdirSync(dirname(socketPath), { recursive: true, mode: 0o755 });
    const blobFiles = new BlobFiles(dir.path);
    const blobMeta = new MemoryBlobMetaStore();
    try {
      await expect(startFilesSocket({ path: socketPath, tickets: new OfficeTickets(), blobMeta, blobFiles })).rejects.toThrow(/not mode 0700/);
      expect(statSync(dirname(socketPath)).mode & 0o777).toBe(0o755);
    } finally {
      dir.rm();
    }
  });

  it('a custom (non-owned) pre-existing directory already at 0700 just works', async () => {
    const dir = tempDir('files-socket-custom-right-mode');
    const socketPath = join(dir.path, 'sock', 'files.sock');
    mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
    const blobFiles = new BlobFiles(dir.path);
    const blobMeta = new MemoryBlobMetaStore();
    const socket = await startFilesSocket({ path: socketPath, tickets: new OfficeTickets(), blobMeta, blobFiles });
    try {
      expect(statSync(socketPath).mode & 0o777).toBe(0o600);
    } finally {
      await socket.close();
      dir.rm();
    }
  });
});

describe('startServer: cleanup on a failed start', () => {
  it('a listen() failure stops the workers and leaves nothing listening on the files-socket path', async () => {
    await requirePostgres();
    const schema = testSchema();
    const dir = tempDir('office-listen-fail');
    const busy = createServer();
    await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', resolve));
    const addr = busy.address();
    const busyPort = typeof addr === 'object' && addr ? addr.port : 0;
    const socketPath = join(dir.path, 'sock', 'files.sock');

    // The files socket starts fine (nothing wrong with its path); it is `app.listen()` for
    // the already-occupied port that fails. Spying on the worker classes' own `stop()` lets
    // this test assert they were actually called, independent of whether either worker had
    // anything in flight to abort (this server never gets as far as serving a real request).
    const officeStopSpy = vi.spyOn(OfficeWorker.prototype, 'stop');
    const pdfTextStopSpy = vi.spyOn(PdfTextWorker.prototype, 'stop');
    try {
      await expect(
        startServer(
          serverConfig({
            dataDir: dir.path,
            pgSchema: schema.name,
            port: busyPort,
            workers: { office: { url: 'http://127.0.0.1:1' }, pdfText: true },
            onlyoffice: { url: null, jwtSecret: SECRET, publicUrl: PUBLIC_URL, filesSocket: socketPath },
          }),
        ),
      ).rejects.toThrow();

      expect(officeStopSpy).toHaveBeenCalledTimes(1);
      expect(pdfTextStopSpy).toHaveBeenCalledTimes(1);

      // Proof the files socket itself was closed, not just that a *retry* happens to
      // succeed (`startFilesSocket` unlinks and re-listens unconditionally, so a retry would
      // "succeed" even over a genuinely leaked listener — it proves nothing on its own).
      // Connecting directly must find nobody home: either the path is gone (ENOENT) or
      // nothing answers on it any more (ECONNREFUSED).
      await expect(viaSocket(socketPath, 'http://x/v1/office-files/whatever.pdf')).rejects.toThrow(/ENOENT|ECONNREFUSED/);
    } finally {
      officeStopSpy.mockRestore();
      pdfTextStopSpy.mockRestore();
      await new Promise<void>((resolve) => busy.close(() => resolve()));
      await schema.drop();
      dir.rm();
    }
  });

  it('a refused files-socket start (a non-socket file at the path) stops the workers and closes the stores before rethrowing', async () => {
    await requirePostgres();
    const schema = testSchema();
    const dir = tempDir('office-filesocket-refuse');
    const socketPath = join(dir.path, 'sock', 'files.sock');
    mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
    writeFileSync(socketPath, 'not a socket');

    const officeStopSpy = vi.spyOn(OfficeWorker.prototype, 'stop');
    const pdfTextStopSpy = vi.spyOn(PdfTextWorker.prototype, 'stop');
    const cfg = serverConfig({
      dataDir: dir.path,
      pgSchema: schema.name,
      workers: { office: { url: 'http://127.0.0.1:1' }, pdfText: true },
      onlyoffice: { url: null, jwtSecret: SECRET, publicUrl: PUBLIC_URL, filesSocket: socketPath },
    });
    try {
      await expect(startServer(cfg)).rejects.toThrow(/not a socket/);
      expect(officeStopSpy).toHaveBeenCalledTimes(1);
      expect(pdfTextStopSpy).toHaveBeenCalledTimes(1);

      // Remove the offending file (an operator fixing the misconfiguration) and start again
      // on the exact same schema and dataDir: if the first attempt had left a Postgres
      // connection, an admin-invite lock, or anything else open, this would hang or fail.
      rmSync(socketPath, { force: true });
      const server2 = await startServer(cfg);
      try {
        expect(server2.filesSocket).toBe(socketPath);
      } finally {
        await server2.close();
      }
    } finally {
      officeStopSpy.mockRestore();
      pdfTextStopSpy.mockRestore();
      await schema.drop();
      dir.rm();
    }
  }, 15_000);
});

describe('OfficeTickets: signature handling', () => {
  it('a signature with an appended "=" or a flipped last character is refused (string comparison, never a lenient decode-then-compare)', () => {
    const tickets = new OfficeTickets(randomBytes(32));
    const ticket = tickets.issue({ hash: `sha256:${'a'.repeat(64)}`, mediaType: PDF_MEDIA, ext: 'pdf' });
    expect(tickets.verify(ticket)).not.toBeNull(); // sanity

    const dot = ticket.indexOf('.');
    const payloadPart = ticket.slice(0, dot);
    const sigPart = ticket.slice(dot + 1);

    expect(tickets.verify(`${payloadPart}.${sigPart}=`)).toBeNull();
    const flipped = sigPart.slice(0, -1) + (sigPart.endsWith('A') ? 'B' : 'A');
    expect(tickets.verify(`${payloadPart}.${flipped}`)).toBeNull();
  });

  it('editing the payload while keeping the original signature is refused', () => {
    const tickets = new OfficeTickets(randomBytes(32));
    const ticket = tickets.issue({ hash: `sha256:${'a'.repeat(64)}`, mediaType: PDF_MEDIA, ext: 'pdf' });
    const dot = ticket.indexOf('.');
    const sigPart = ticket.slice(dot + 1);
    const payload = JSON.parse(Buffer.from(ticket.slice(0, dot), 'base64url').toString('utf8')) as { hash: string };
    const edited = { ...payload, hash: `sha256:${'b'.repeat(64)}` };
    const editedPayloadPart = Buffer.from(JSON.stringify(edited)).toString('base64url');
    expect(tickets.verify(`${editedPayloadPart}.${sigPart}`)).toBeNull();
  });
});

describe('OfficeViewer.available(): 30s cache', () => {
  it('caches the health-check result for 30s on its own injectable clock; a cache miss calls fetch again', async () => {
    let now = 0;
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response('true', { status: 200 });
    }) as unknown as typeof fetch;
    const deps = {
      cfg: { now: () => new Date(now), onlyoffice: { url: 'http://stub.invalid', jwtSecret: 's', publicUrl: PUBLIC_URL, filesSocket: '/tmp/x' } },
    } as unknown as ApiDeps;
    const viewer = new OfficeViewer(deps, new OfficeTickets(), fetchImpl);

    expect(await viewer.available()).toBe(true);
    expect(calls).toBe(1);

    now += 10_000; // 10s later: still within the 30s cache window.
    expect(await viewer.available()).toBe(true);
    expect(calls).toBe(1);

    now += 25_000; // 35s after the first call: the cache has expired.
    expect(await viewer.available()).toBe(true);
    expect(calls).toBe(2);
  });
});

describe('configFromEnv: onlyoffice', () => {
  it('defaults url/publicUrl; "off" disables url and the files socket; the socket defaults under dataDir', () => {
    const cfg = configFromEnv({ MEETLESS_DATA_DIR: '/tmp/meetless-onlyoffice-cfg-test' });
    expect(cfg.onlyoffice.url).toBe('http://127.0.0.1:55435');
    expect(cfg.onlyoffice.publicUrl).toBe('http://meetless-onlyoffice-files:8080');
    expect(cfg.onlyoffice.jwtSecret).toBeNull();
    expect(cfg.onlyoffice.filesSocket).toBe(join(cfg.dataDir, 'office-sock', 'files.sock'));

    expect(configFromEnv({ MEETLESS_ONLYOFFICE_URL: 'off' }).onlyoffice.url).toBeNull();
    expect(configFromEnv({ MEETLESS_OFFICE_FILES_SOCKET: 'off' }).onlyoffice.filesSocket).toBeNull();
    expect(configFromEnv({ MEETLESS_PUBLIC_URL: 'http://example.org' }).onlyoffice.publicUrl).toBe('http://example.org');
  });

  it('strips trailing slashes from MEETLESS_ONLYOFFICE_URL and MEETLESS_PUBLIC_URL', () => {
    expect(configFromEnv({ MEETLESS_ONLYOFFICE_URL: 'http://127.0.0.1:55435///' }).onlyoffice.url).toBe('http://127.0.0.1:55435');
    expect(configFromEnv({ MEETLESS_PUBLIC_URL: 'http://example.org/' }).onlyoffice.publicUrl).toBe('http://example.org');
  });

  it('reads the secret from infra/dev/onlyoffice/.env.local under the repo root when the env var is unset; the env var wins when both are set; surrounding quotes are stripped', () => {
    const dir = tempDir('onlyoffice-env-file');
    try {
      mkdirSync(join(dir.path, 'infra/dev/onlyoffice'), { recursive: true });
      writeFileSync(
        join(dir.path, 'infra/dev/onlyoffice/.env.local'),
        'SOME_OTHER_VAR=1\nMEETLESS_ONLYOFFICE_JWT_SECRET="from-env-file"\n',
      );

      expect(configFromEnv({ MEETLESS_REPO_ROOT: dir.path }).onlyoffice.jwtSecret).toBe('from-env-file');
      expect(configFromEnv({ MEETLESS_REPO_ROOT: dir.path, MEETLESS_ONLYOFFICE_JWT_SECRET: 'explicit-env-var' }).onlyoffice.jwtSecret).toBe('explicit-env-var');

      const noFileDir = tempDir('onlyoffice-no-env-file');
      try {
        expect(configFromEnv({ MEETLESS_REPO_ROOT: noFileDir.path }).onlyoffice.jwtSecret).toBeNull();
      } finally {
        noFileDir.rm();
      }
    } finally {
      dir.rm();
    }
  });
});

describe('signHs256 / verifyHs256', () => {
  it('round-trips a payload and rejects tampering or the wrong secret', () => {
    const payload = { a: 1, b: 'two', nested: { c: [1, 2, 3] } };
    const token = signHs256(payload, SECRET);
    expect(verifyHs256(token, SECRET)).toEqual(payload);
    expect(verifyHs256(token, 'wrong-secret')).toBeNull();
    expect(verifyHs256(`${token}x`, SECRET)).toBeNull();
    expect(verifyHs256('not.a.jwt.at.all', SECRET)).toBeNull();
    expect(verifyHs256('garbage', SECRET)).toBeNull();
  });

  it('a signature with an appended "=" or a flipped last character is refused', () => {
    const payload = { a: 1 };
    const token = signHs256(payload, SECRET);
    const parts = token.split('.');
    const [headerPart, payloadPart, sigPart] = parts as [string, string, string];
    expect(verifyHs256(`${headerPart}.${payloadPart}.${sigPart}=`, SECRET)).toBeNull();
    const flipped = sigPart.slice(0, -1) + (sigPart.endsWith('A') ? 'B' : 'A');
    expect(verifyHs256(`${headerPart}.${payloadPart}.${flipped}`, SECRET)).toBeNull();
  });
});
