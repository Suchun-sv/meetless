import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClientNode } from '../src/index';
import { callApi } from '../src/api-call';

/**
 * Error bodies on any non-2xx (contract 12.5, 12.8): `{ error: { code, details } }` gives that code
 * and its details on every path that calls the server (`callApi`, `api()`, `signIn`, `redeemInvite`);
 * `HTTP_<status>` only when the body carries no code. Each test runs its own `node:http` stub.
 */
type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function stub(handlers: Record<string, Handler>): Promise<string> {
  const server = createServer((req, res) => {
    const h = handlers[`${req.method} ${new URL(req.url ?? '/', 'http://x').pathname}`];
    req.resume();
    if (h) h(req, res);
    else res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

const json = (status: number, body: unknown): Handler => (_req, res) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
const text = (status: number, body: string): Handler => (_req, res) => res.writeHead(status, { 'content-type': 'text/plain' }).end(body);
const limited = json(429, { error: { code: 'RATE_LIMITED', details: { retryAfter: 42 } } });
const meOk: Handler = json(200, { user: { id: 'u-lin', displayName: 'Lin An' } });

function dataDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'meetless-429-'));
  dirs.push(d);
  return d;
}

describe('callApi error bodies', () => {
  it('returns the body’s code and details on a 429, and HTTP_<status> only when the body has no code', async () => {
    const url = await stub({ 'GET /v1/tokens': limited, 'GET /v1/agent-calls': text(502, '<html>bad gateway</html>'), 'GET /v1/me': json(500, { error: {} }) });
    expect(await callApi(url, 't', 'tokens.list', {})).toEqual({ ok: false, code: 'RATE_LIMITED', details: { retryAfter: 42 } });
    expect(await callApi(url, 't', 'agentCalls.list', {})).toEqual({ ok: false, code: 'HTTP_502' });
    expect(await callApi(url, 't', 'me', {})).toEqual({ ok: false, code: 'HTTP_500' });
  });
});

describe('ClientNode error bodies', () => {
  it('api() carries RATE_LIMITED with details.retryAfter', async () => {
    const url = await stub({ 'GET /v1/me': meOk, 'GET /v1/tokens': limited });
    const node = await ClientNode.open({ dataDir: dataDir() });
    await node.signIn(url, 'dev-lin');
    expect(await node.api('tokens.list', {})).toEqual({ ok: false, code: 'RATE_LIMITED', details: { retryAfter: 42 } });
    await node.close();
  });

  it('signIn maps a 429 body to RATE_LIMITED with details.retryAfter, and keeps the URL', async () => {
    const url = await stub({ 'GET /v1/me': limited });
    const lines: string[] = [];
    const node = await ClientNode.open({ dataDir: dataDir(), log: (m) => lines.push(m) });
    expect(await node.signIn(url, 'dev-lin')).toEqual({ ok: false, code: 'RATE_LIMITED', details: { url, retryAfter: 42 } });
    expect(lines).toEqual([`signIn url="${url}" result=RATE_LIMITED`]);
    await node.close();
  });

  it('signIn reads the code of any non-2xx body, and falls back to UNAUTHENTICATED or HTTP_<status>', async () => {
    const revoked = await stub({ 'GET /v1/me': json(401, { error: { code: 'TOKEN_REVOKED' } }) });
    const plain401 = await stub({ 'GET /v1/me': text(401, 'no') });
    const plain503 = await stub({ 'GET /v1/me': text(503, 'down') });
    const node = await ClientNode.open({ dataDir: dataDir() });
    expect(await node.signIn(revoked, 'dev-lin')).toEqual({ ok: false, code: 'TOKEN_REVOKED', details: { url: revoked } });
    expect(await node.signIn(plain401, 'dev-lin')).toEqual({ ok: false, code: 'UNAUTHENTICATED', details: { url: plain401 } });
    expect(await node.signIn(plain503, 'dev-lin')).toEqual({ ok: false, code: 'HTTP_503', details: { url: plain503, status: 503 } });
    await node.close();
  });

  it('redeemInvite maps a 429 body to RATE_LIMITED with details.retryAfter', async () => {
    const url = await stub({ 'POST /v1/invites/redeem': limited });
    const node = await ClientNode.open({ dataDir: dataDir() });
    const r = await node.redeemInvite(url, 'abc', 'Name');
    expect(r).toEqual({ ok: false, code: 'RATE_LIMITED', details: { url, retryAfter: 42, cause: { retryAfter: 42 } } });
    await node.close();
  });
});
