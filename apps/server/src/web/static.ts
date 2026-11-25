import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { WEB_HOST_META } from '@meetless/api';
import type { ServerConfig } from '../server';

/**
 * The CSP header on every page `registerWebStatic` serves at `/` (design 2026-11-25 §3). `host`
 * is the request's own host (`request.host`, proxy-aware through `fastifyTrustProxy`), so
 * `connect-src` allows this page's own websocket origin and no other.
 */
export function webCsp(host: string): string {
  return (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; " +
    `font-src 'self'; connect-src 'self' wss://${host} ws://${host}; frame-src 'self'; worker-src 'self' blob:; ` +
    "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );
}

/** Any `<meta http-equiv="Content-Security-Policy" ...>` tag, attributes in either order, plus trailing whitespace. */
const CSP_META = /<meta\b[^>]*\bhttp-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>\s*/gi;

/** `<meta name="meetless-host" content="web">`: the marker that selects the web bridge (design 2026-11-25 §2). */
const MARKER_META = `<meta name="${WEB_HOST_META}" content="web">`;

/**
 * The vite-built `index.html`, for serving on the web: the packaged desktop CSP meta (design
 * 2026-11-25 §3, "the build's desktop CSP meta is removed") is stripped — the CSP travels as a
 * header instead — and the web marker meta is added, right after `<head>` (or prepended, for a
 * fragment with no `<head>` at all).
 */
export function prepareIndexHtml(html: string): string {
  // `crossorigin` on same-origin tags only changes the request mode; dropping it keeps a slow or
  // flaky mobile link (Tailscale DERP relay) on the plainest possible request.
  const stripped = html.replace(CSP_META, '').replace(/(<(?:script|link)\b[^>]*?)\s+crossorigin(?:=["'][^"']*["'])?/gi, '$1');
  const headOpen = /<head[^>]*>/i.exec(stripped);
  if (!headOpen) return MARKER_META + stripped;
  const at = headOpen.index + headOpen[0].length;
  return stripped.slice(0, at) + MARKER_META + stripped.slice(at);
}

/** A fixed extension -> content-type map; no new dependency (no `mime-types` package). */
const EXT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

/** Text types worth compressing; fonts and images are compressed already. */
const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.html', '.json', '.map', '.svg', '.txt']);

export type Encoding = 'br' | 'gzip';

/**
 * The best encoding the client accepts, brotli first: `Accept-Encoding` tokens with `q=0` are
 * refused, everything else counts. `null` means identity.
 */
export function pickEncoding(accept: string | string[] | undefined): Encoding | null {
  const raw = Array.isArray(accept) ? accept.join(',') : (accept ?? '');
  const ok = new Set<string>();
  for (const part of raw.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    const q = params.map((x) => x.trim()).find((x) => x.startsWith('q='));
    if (q && Number(q.slice(2)) === 0) continue;
    ok.add(name);
  }
  if (ok.has('br')) return 'br';
  if (ok.has('gzip')) return 'gzip';
  return null;
}

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

interface Packed {
  mtimeMs: number;
  size: number;
  br: Buffer;
  gzip: Buffer;
}

/**
 * Compressed copies of the build's text assets, made once per file version (keyed by path, checked
 * against mtime and size) and kept in memory: `tailscale serve` passes bytes through uncompressed,
 * and on a phone behind a DERP relay the difference is several seconds.
 */
class PackCache {
  private readonly packs = new Map<string, Promise<Packed>>();

  get(full: string, data: Buffer, mtimeMs: number): Promise<Packed> {
    const hit = this.packs.get(full);
    if (hit) {
      return hit.then((p) => (p.mtimeMs === mtimeMs && p.size === data.length ? p : this.make(full, data, mtimeMs)));
    }
    return this.make(full, data, mtimeMs);
  }

  private make(full: string, data: Buffer, mtimeMs: number): Promise<Packed> {
    const p = Promise.all([
      brotli(data, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: data.length } }),
      gz(data, { level: 9 }),
    ]).then(([b, g]) => ({ mtimeMs, size: data.length, br: b, gzip: g }));
    this.packs.set(full, p);
    p.catch(() => this.packs.delete(full));
    return p;
  }
}

/** Compresses every text asset under `webDir/assets` in the background, so the first phone to ask does not wait for brotli. */
async function warm(webDir: string, cache: PackCache): Promise<void> {
  let names: string[];
  try {
    names = await readdir(join(webDir, 'assets'));
  } catch {
    return;
  }
  for (const name of names) {
    if (!COMPRESSIBLE.has(extname(name).toLowerCase())) continue;
    const full = join(webDir, 'assets', name);
    try {
      const [data, st] = await Promise.all([readFile(full), stat(full)]);
      await cache.get(full, data, st.mtimeMs);
    } catch {
      // A file that vanished mid-scan is simply not warmed.
    }
  }
}

/**
 * One line per asset transfer (`/assets/*`, `/boot.js`) when it ends: status, bytes, encoding and
 * duration, or `aborted` when the connection closed before the body was sent, so slow and cut-off
 * transfers over a relay show in the server log.
 */
function logTransfer(print: (line: string) => void, pathname: string, reply: FastifyReply, bytes: number, enc: Encoding | null): void {
  const started = Date.now();
  reply.raw.once('close', () => {
    const ms = Date.now() - started;
    const done = reply.raw.writableFinished;
    print(`[meetless-web-asset] GET ${pathname} ${reply.statusCode} ${bytes}B ${enc ?? 'identity'} ${ms}ms${done ? '' : ' aborted'}`);
  });
}

/** Routes this handler must never answer, however `cfg.webDir` is laid out (design 2026-11-25 §4). */
const SHADOW_PREFIXES = ['/v1', '/mcp', '/health', '/office'];

function isShadowedPath(pathname: string): boolean {
  return SHADOW_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** `GET /` and `GET /index.html`: the renderer's `index.html`, prepared, with the CSP and the no-store/no-sniff headers. */
async function serveIndex(webDir: string, req: FastifyRequest, reply: FastifyReply): Promise<void> {
  let html: string;
  try {
    html = await readFile(resolve(webDir, 'index.html'), 'utf8');
  } catch {
    reply.callNotFound();
    return;
  }
  reply
    .header('content-type', 'text/html; charset=utf-8')
    .header('content-security-policy', webCsp(req.host))
    .header('x-content-type-options', 'nosniff')
    .header('referrer-policy', 'same-origin')
    .header('cache-control', 'no-store')
    .send(prepareIndexHtml(html));
}

/**
 * Any other `GET` under `webDir`: resolved with `resolve(webDir, '.' + decoded)`, which must
 * still start with `webDir + sep` (or equal it, for an empty remainder) — a `..` segment or a
 * percent-encoded one (`/%2e%2e/x`) that escapes the directory is refused the same as a missing
 * file, both 404. A hashed asset is cached as `immutable`; the content type comes from a fixed
 * extension map, defaulting to `application/octet-stream` for an unknown one.
 */
async function serveAsset(webDir: string, pathname: string, req: FastifyRequest, reply: FastifyReply, cache: PackCache, print: (line: string) => void): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    reply.callNotFound();
    return;
  }
  const full = resolve(webDir, `.${decoded}`);
  if (full !== webDir && !full.startsWith(webDir + sep)) {
    reply.callNotFound();
    return;
  }
  let data: Buffer;
  let mtimeMs: number;
  try {
    [data, mtimeMs] = await Promise.all([readFile(full), stat(full).then((st) => st.mtimeMs)]);
  } catch {
    // Covers a missing file and a directory (EISDIR): neither is ever listed or served.
    reply.callNotFound();
    return;
  }
  const ext = extname(full).toLowerCase();
  const type = EXT_TYPES[ext] ?? 'application/octet-stream';
  const compressible = COMPRESSIBLE.has(ext);
  const enc = compressible ? pickEncoding(req.headers['accept-encoding']) : null;
  let body = data;
  if (enc) {
    try {
      body = (await cache.get(full, data, mtimeMs))[enc];
      reply.header('content-encoding', enc);
    } catch {
      body = data;
    }
  }
  if (compressible) reply.header('vary', 'Accept-Encoding');
  // boot.js has no content hash in its name: always revalidate it, never pin it for a year.
  const cacheControl = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  if (pathname.startsWith('/assets/') || pathname === '/boot.js') logTransfer(print, pathname, reply, body.length, reply.getHeader('content-encoding') ? enc : null);
  reply.header('content-type', type).header('cache-control', cacheControl).header('content-length', String(body.length)).send(body);
}

/**
 * Serves the renderer build at `/` (design 2026-11-25 §4). A no-op when `cfg.webDir` is `null`
 * (`MEETLESS_WEB_DIR=off`): nothing is registered, so `/` falls through to the server's normal
 * 404. `/v1`, `/mcp`, `/health` and `/office` are never shadowed, whatever files `webDir` holds,
 * both because those exact routes are already registered (a more specific match always wins)
 * and, defensively, because the wildcard handler below refuses those prefixes itself.
 */
export function registerWebStatic(app: FastifyInstance, cfg: Pick<ServerConfig, 'webDir'> & Partial<Pick<ServerConfig, 'print'>>): void {
  const webDir = cfg.webDir;
  if (webDir === null) return;
  const print = cfg.print ?? ((line: string) => console.log(line));
  const cache = new PackCache();
  void warm(webDir, cache);

  app.get('/', (req, reply) => serveIndex(webDir, req, reply));
  app.get('/index.html', (req, reply) => serveIndex(webDir, req, reply));
  app.get('/*', (req, reply) => {
    const pathname = new URL(req.url, 'http://web-static.invalid').pathname;
    if (isShadowedPath(pathname)) return reply.callNotFound();
    return serveAsset(webDir, pathname, req, reply, cache, print);
  });
}
