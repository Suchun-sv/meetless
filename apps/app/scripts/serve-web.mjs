// Serves a web export as a single-page app (every unknown path renders index.html) and proxies the
// server's own routes (/v1 with the /v1/ws upgrade, /mcp, /health, /office) to the Meetless server,
// so the cookie session stays same-origin. Env: PORT (4877), MEETLESS_UPSTREAM (http://127.0.0.1:4876),
// DIST (apps/app/dist), CSP=1 to send the server's own page headers (CSP, nosniff, same-origin
// referrer, no-store) on index.html. The Meetless server's static handler has no SPA fallback, which
// the Expo app's real paths need; hence this server in front of it.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 4877);
const UP = new URL(process.env.MEETLESS_UPSTREAM ?? 'http://127.0.0.1:4876');
const DIST = resolve(process.env.DIST ?? join(dirname(fileURLToPath(import.meta.url)), '../dist'));
const CSP = process.env.CSP === '1';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
};
const PROXIED = /^\/(v1|mcp|health|office)(\/|\?|$)/;

/** The public host and scheme: what tailscale serve forwarded, else the Host header. */
function forwarded(req) {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',').pop().trim();
  // Without the header: plain http only on loopback (a direct local request), else the HTTPS front.
  const local = /^(localhost|127\.[0-9.]+|\[::1\])(:\d+)?$/.test(host);
  const proto = String(req.headers['x-forwarded-proto'] ?? (local ? 'http' : 'https')).split(',').pop().trim();
  return { host, proto };
}

function upstreamHeaders(req) {
  const { host, proto } = forwarded(req);
  const h = { ...req.headers, host, 'x-forwarded-host': host, 'x-forwarded-proto': proto };
  const ip = req.socket.remoteAddress ?? '';
  h['x-forwarded-for'] = req.headers['x-forwarded-for'] ? `${req.headers['x-forwarded-for']}` : ip;
  return h;
}

function proxy(req, res) {
  const up = request({ host: UP.hostname, port: UP.port, method: req.method, path: req.url, headers: upstreamHeaders(req) }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'UPSTREAM_DOWN' } }));
  });
  req.pipe(up);
}

function serveFile(req, res) {
  const url = new URL(req.url ?? '/', 'http://x');
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) return void res.writeHead(403).end();
  const isFile = existsSync(file) && statSync(file).isFile();
  if (!isFile) file = join(DIST, 'index.html'); // single-page app: every route renders index.html
  const ext = extname(file);
  const hashed = url.pathname.startsWith('/_expo/static/');
  const headers = { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache', 'x-content-type-options': 'nosniff' };
  if (ext === '.html' && CSP) {
    // The Meetless server's webCsp (apps/server/src/web/static.ts), for the public host.
    const { host } = forwarded(req);
    Object.assign(headers, {
      'content-security-policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; " +
        `font-src 'self'; connect-src 'self' wss://${host} ws://${host}; frame-src 'self'; worker-src 'self' blob:; ` +
        // The app's own pages it frames (office-frame.html) may be framed by itself; index.html by nobody.
        `object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors ${file.endsWith('/index.html') ? "'none'" : "'self'"}`,
      'referrer-policy': 'same-origin',
      'cache-control': 'no-store',
    });
  }
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => (PROXIED.test(req.url ?? '') ? proxy(req, res) : serveFile(req, res)));

server.on('upgrade', (req, socket, head) => {
  if (!PROXIED.test(req.url ?? '')) return socket.destroy();
  const up = connect(Number(UP.port), UP.hostname, () => {
    const h = upstreamHeaders(req);
    const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(h).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : [`${k}: ${v}`]))];
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head?.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.listen(PORT, '127.0.0.1', () => console.log(`meetless web on http://127.0.0.1:${PORT} serving ${DIST}${CSP ? ' (CSP)' : ''} -> ${UP.origin}`));
