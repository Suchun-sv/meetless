import { createServer, type Server } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClientNode, createFileLog } from '../src/index';

/** Sign-in never fails silently: every outcome is a coded result with the URL, and is logged without the token. */
let dir: string;
let hang: Server;
let hangUrl: string;
let html: Server;
let htmlUrl: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'meetless-signin-'));
  hang = createServer(() => undefined); // accepts and never answers
  html = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<html>not meetless</html>'));
  await Promise.all([new Promise<void>((r) => hang.listen(0, '127.0.0.1', r)), new Promise<void>((r) => html.listen(0, '127.0.0.1', r))]);
  hangUrl = `http://127.0.0.1:${(hang.address() as { port: number }).port}`;
  htmlUrl = `http://127.0.0.1:${(html.address() as { port: number }).port}`;
});
afterAll(() => {
  hang.closeAllConnections();
  hang.close();
  html.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ClientNode.signIn', () => {
  it('returns a reason and the tried URL for every failure; logs without the token', async () => {
    const lines: string[] = [];
    const node = await ClientNode.open({ dataDir: join(dir, 'c1'), signInTimeoutMs: 300, log: (m) => lines.push(m) });
    const cases: [string, string, string][] = [
      ['127.0.0.1:4875', 'dev-lin', 'URL_NO_SCHEME'],
      ['http://exa mple', 'dev-lin', 'URL_INVALID'],
      ['ftp://127.0.0.1', 'dev-lin', 'URL_INVALID'],
      ['http://127.0.0.1:1', 'dev-lin', 'NETWORK'],
      [hangUrl, 'dev-lin', 'TIMEOUT'],
      [htmlUrl, 'dev-lin', 'BAD_RESPONSE'],
      ['http://127.0.0.1:1', '  ', 'TOKEN_MISSING'],
    ];
    for (const [url, token, code] of cases) {
      const r = await node.signIn(url, token);
      expect(r.ok, url).toBe(false);
      if (!r.ok) {
        expect(r.code, url).toBe(code);
        expect((r.details as { url: string }).url).toBe(url.trim());
      }
    }
    expect(lines).toHaveLength(cases.length);
    expect(lines[0]).toBe('signIn url="127.0.0.1:4875" result=URL_NO_SCHEME');
    expect(lines.join('\n')).not.toContain('dev-lin');
    expect(readdirSync(join(dir, 'c1'))).not.toContain('session.json'); // nothing half-written
    await node.close();
  });
});

describe('createFileLog', () => {
  it('rotates and redacts tokens', () => {
    const d = join(dir, 'logs');
    const log = createFileLog(d, { maxBytes: 200, keep: 2 });
    for (let i = 0; i < 20; i++) log.info(`line ${i} authorization: Bearer secret-${i} token=dev-lin`);
    log.error('boom', new Error('bad'));
    const files = readdirSync(d).sort();
    expect(files).toEqual(['main.1.log', 'main.2.log', 'main.log']);
    const all = files.map((f) => readFileSync(join(d, f), 'utf8')).join('');
    expect(all).not.toContain('secret-');
    expect(all).not.toContain('dev-lin');
    expect(readFileSync(join(d, 'main.log'), 'utf8')).toContain('ERROR boom: Error: bad');
  });
});
