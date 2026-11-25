import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { chmod, lstat, mkdir, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { BlobFiles } from '../blobs';
import type { BlobMetaStore } from '../store/types';
import type { OfficeTickets } from './tickets';

export interface FilesSocketOptions {
  /** The Unix socket path to listen on (its directory is created with mode 0700; the socket itself is chmod 0600 after listen). */
  path: string;
  tickets: OfficeTickets;
  blobMeta: BlobMetaStore;
  blobFiles: BlobFiles;
  /**
   * True only for the server's own default directory (`<dataDir>/office-sock`), which it
   * fully owns and keeps at mode 0700 on every start. Anything else is a directory the
   * operator pointed `MEETLESS_OFFICE_FILES_SOCKET` at directly: this code creates it (at
   * 0700) only if it does not exist yet, and otherwise only ever *verifies* it is already
   * 0700 — it never chmods a pre-existing directory it does not own.
   */
  ownDir?: boolean;
}

const errorBody = (code: string) => JSON.stringify({ error: { code } });

function sendError(res: ServerResponse, status: number, code: string): void {
  if (res.writableEnded) return;
  if (res.headersSent) {
    // A 200 response had already started (e.g. the blob stream broke mid-way): there is no
    // clean way to turn that into an error response any more, so just drop the connection
    // rather than appending corrupt bytes after a promised content-length.
    res.destroy();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(errorBody(code));
}

/** Path matcher for `GET /v1/office-files/<ticket>.<ext>`, parsed without `new URL` (a malformed request-target, e.g. an unterminated `[` in an absolute-URI target, must never throw here — the whole point of this function). */
const OFFICE_FILE_PATH = /^\/v1\/office-files\/([^/?#]+)(?:[?#].*)?$/;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prepares the socket's directory (contract §12.6: "its directory holds nothing else").
 * Creates it at 0700 if it is missing; otherwise only chmods it when this server owns it
 * (`ownDir`), and otherwise verifies — never silently modifies — a pre-existing directory
 * the operator configured directly.
 */
async function prepareDir(dir: string, ownDir: boolean): Promise<void> {
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700); // mkdir's `mode` can be weakened by umask; enforce it explicitly.
    return;
  }
  if (ownDir) {
    await chmod(dir, 0o700); // ours across restarts too: keep it correct even if something else touched it.
    return;
  }
  const st = await stat(dir);
  if ((st.mode & 0o777) !== 0o700) {
    throw new Error(`the OnlyOffice files-socket directory ${dir} is not mode 0700, and this server did not create it — fix its permissions, it will not be chmod'd automatically`);
  }
}

/**
 * Removes a stale socket file left by a crash, replacing only an actual Unix socket.
 * Anything else at that path (a regular file, a directory, ...) is left untouched and the
 * whole function throws, naming the path, so a start never silently destroys someone else's
 * file.
 */
async function clearStaleSocket(path: string): Promise<void> {
  let st;
  try {
    st = await lstat(path);
  } catch {
    return; // nothing there: nothing to clear.
  }
  if (!st.isSocket()) {
    throw new Error(`refusing to start the files socket: ${path} already exists and is not a socket — leaving it in place`);
  }
  await unlink(path);
}

/**
 * The relay's only entry point (design: "DocumentServer reachability"): `GET
 * /v1/office-files/<ticket>.<ext>` on a Unix socket, never on the TCP listener. The ticket
 * alone is the authorisation — there is no bearer token here, since the relay container that
 * calls this runs as a different, unauthenticated party (DocumentServer, via the TCP-to-Unix
 * relay `meetless-onlyoffice-files`). A tampered, expired or other-secret ticket answers 403
 * `NOT_AUTHORISED` without ever touching blob bytes; anything else — a malformed path shape, a
 * bare ticket with no extension, a wrong extension on an otherwise-valid ticket, no such blob
 * any more — answers 404. Nothing a malformed request can contain is allowed to throw past
 * this server's own request handler: an unhandled rejection there would take the whole
 * process down.
 */
export async function startFilesSocket(opts: FilesSocketOptions): Promise<{ close(): Promise<void> }> {
  const dir = dirname(opts.path);
  await prepareDir(dir, opts.ownDir === true);
  await clearStaleSocket(opts.path);

  /** Resolves `true` once `stream` has actually opened the file, `false` on open error (destroying the stream either way it settles on error). Lets the caller choose 200 vs. 404 *before* writing any headers, instead of promising 200 and then resetting the connection mid-stream. */
  function opened(stream: Readable): Promise<boolean> {
    return new Promise((resolve) => {
      stream.once('open', () => resolve(true));
      stream.once('error', () => resolve(false));
    });
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const m = req.method === 'GET' && typeof req.url === 'string' ? OFFICE_FILE_PATH.exec(req.url) : null;
    if (!m) return sendError(res, 404, 'NOT_FOUND');

    // A well-formed path is exactly `<payload>.<sig>.<ext>` — three non-empty dot-separated
    // parts. A bare ticket (no `.ext` at all, just `<payload>.<sig>`) has only two: splitting
    // it on its *last* dot would otherwise cut the ticket itself in half (taking `.<sig>` as
    // if it were the extension), which happens to fail ticket verification anyway but for the
    // wrong reason and with the wrong status — require the shape first, or 404 outright.
    const parts = m[1]!.split('.');
    if (parts.length !== 3 || parts.some((p) => p.length === 0)) return sendError(res, 404, 'NOT_FOUND');
    const [payloadPart, sigPart, extStr] = parts as [string, string, string];

    const verified = opts.tickets.verify(`${payloadPart}.${sigPart}`);
    if (!verified) return sendError(res, 403, 'NOT_AUTHORISED');
    // The ticket verified, but names a different file type than the URL's own extension:
    // treat this exact path as not found rather than serving a mismatched content-type.
    if (extStr !== verified.ext) return sendError(res, 404, 'NOT_FOUND');

    const meta = await opts.blobMeta.get(verified.hash);
    if (!meta) return sendError(res, 404, 'NOT_FOUND');

    // Metadata says the blob exists, but the bytes might not (a prior inconsistency): confirm
    // the file actually opens *before* committing to a 200, so a missing file is a clean 404
    // rather than a connection reset after promising a content-length.
    const stream = opts.blobFiles.read(verified.hash);
    if (!(await opened(stream))) {
      stream.destroy();
      return sendError(res, 404, 'NOT_FOUND');
    }

    res.writeHead(200, { 'content-type': verified.mediaType, 'content-length': String(meta.size), 'cache-control': 'no-store' });
    await pipeline(stream, res);
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => sendError(res, 404, 'NOT_FOUND'));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.path, resolve);
  });
  await chmod(opts.path, 0o600);

  return {
    async close() {
      // Matches the main Fastify app's `forceCloseConnections`: an idle keep-alive
      // connection (the relay reusing one, or just a test) would otherwise make this wait
      // out Node's default ~5s keep-alive timeout instead of actually closing promptly.
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
