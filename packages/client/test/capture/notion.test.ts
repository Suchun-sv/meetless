/**
 * U3-owned. T3: Notion pages through the Notion MCP with the user's own OAuth.
 * Every test runs against `startFakeNotion` on 127.0.0.1:0; nothing here
 * reaches notion.com. Covers the loopback OAuth flow, the 0600 token file,
 * reading a page, the run branch, revocation, disconnect, URL rules, the R10
 * host rule for MEETLESS_NOTION_MCP_URL, the bridge methods, and a leak sweep
 * proving tokens, client info and the PKCE verifier stay in the token file.
 */
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_METHODS, type CommandInput } from '../../src/bridge';
import { CaptureService } from '../../src/capture';
import { NOTION_AUTH_TIMEOUT_MS, NOTION_FETCH_TOOL, NOTION_MCP_URL, NotionClient, notionServerUrl } from '../../src/capture/notion';
import { captureWorkId } from '../../src/capture/plan';
import { GitRepos } from '../../src/git';
import { ClientNode } from '../../src/node';
import { startFakeNotion, type FakeNotion } from './fake-notion';
import { apply, id, s } from './fixture';

const PAGE = 'https://www.notion.so/Lab-notes-0123456789abcdef0123456789abcdef';
const LAB_PAGE = '# 实验记录\n- N2 按月汇总已完成\n- 其他事项';

const dirs: string[] = [];
const fakes: FakeNotion[] = [];
const clients: NotionClient[] = [];
const services: CaptureService[] = [];
const servers: Server[] = [];
const ENV_KEY = 'MEETLESS_NOTION_MCP_URL';
const envBefore = process.env[ENV_KEY];

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
  for (const sv of services.splice(0)) await sv.close();
  for (const f of fakes.splice(0)) await f.close();
  for (const srv of servers.splice(0)) {
    srv.closeAllConnections();
    srv.close();
  }
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  if (envBefore === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = envBefore;
});

function dir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

async function fake(page = LAB_PAGE): Promise<FakeNotion> {
  const f = await startFakeNotion({ page });
  fakes.push(f);
  return f;
}

function client(dataDir: string, f: FakeNotion, extra: { log?: (m: string) => void; host?: 'electron' | 'dev-bridge'; authTimeoutMs?: number } = {}): NotionClient {
  const nc = new NotionClient({ dataDir, serverUrl: f.mcpUrl, host: extra.host ?? 'dev-bridge', log: extra.log, authTimeoutMs: extra.authTimeoutMs });
  clients.push(nc);
  return nc;
}

let seq = 0;
function acceptingSubmit() {
  return vi.fn(async (_cmd: CommandInput) => ({ kind: 'accepted' as const, seq: ++seq }));
}

function service(dataDir: string, nc: NotionClient, log?: (m: string) => void) {
  const submit = acceptingSubmit();
  const sv = new CaptureService({ dataDir, submit, repos: new GitRepos(dataDir), host: 'dev-bridge', log, notion: nc });
  services.push(sv);
  return { sv, submit };
}

/** The fixture state plus a shared Notion artifact `a-notion` linked to `url`. */
function withNotion(url: string | null = PAGE) {
  return apply(s, 'u-alex', {
    id: 'add-notion',
    type: 'artifact.created',
    payload: { artifactId: 'a-notion', projectId: 'p1', kind: 'notion', title: 'Lab notes', where: 'Notion', url, needIds: [] },
  });
}

/** Runs connect, follows the fake's authorize redirect and the loopback callback, as the browser would. */
async function authorize(nc: NotionClient) {
  const { authorizeUrl } = await nc.connect();
  const r = await fetch(authorizeUrl, { redirect: 'manual' });
  const location = r.headers.get('location')!;
  const cb = await fetch(location);
  return { authorizeUrl, location, status: cb.status, page: await cb.text() };
}

/** Every file under `root` whose bytes contain `needle`, as paths relative to `root`. */
function filesContaining(root: string, needle: string): string[] {
  const want = Buffer.from(needle);
  const out: string[] = [];
  const walk = (abs: string, rel: string) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const childAbs = join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (readFileSync(childAbs).includes(want)) out.push(childRel);
    }
  };
  walk(root, '');
  return out.sort();
}

const oauthFile = (dataDir: string) => join(dataDir, 'capture', 'notion-oauth.json');

describe('notion: constants', () => {
  it('names the Notion MCP endpoint, its fetch tool and the authorization timeout', () => {
    expect(NOTION_MCP_URL).toBe('https://mcp.notion.com/mcp');
    expect(NOTION_FETCH_TOOL).toBe('notion-fetch');
    expect(NOTION_AUTH_TIMEOUT_MS).toBe(300_000);
  });
});

describe('NotionClient', () => {
  it('before authorising, status is disconnected and reading fails with notion_not_connected without calling the tool', async () => {
    const f = await fake();
    const nc = client(dir('meetless-notion-'), f);
    expect(nc.status()).toBe('disconnected');
    await expect(nc.fetchPage(PAGE)).rejects.toMatchObject({ code: 'notion_not_connected' });
    expect(f.toolCalls()).toBe(0);
  });

  it('connect returns an authorize URL; completing the redirect stores tokens and status becomes connected', async () => {
    const f = await fake();
    const dataDir = dir('meetless-notion-');
    const nc = client(dataDir, f);

    const prevUmask = process.umask(0o022);
    let done: Awaited<ReturnType<typeof authorize>>;
    try {
      done = await authorize(nc);
    } finally {
      process.umask(prevUmask);
    }

    expect(done.authorizeUrl.startsWith(`${f.origin}/authorize?`)).toBe(true);
    const loopback = new URL(done.location);
    expect(loopback.hostname).toBe('127.0.0.1');
    expect(loopback.pathname).toBe('/oauth/callback');
    expect(loopback.searchParams.get('code')).toBe('c1');
    expect(done.status).toBe(200);
    expect(done.page).toContain('Meetless: Notion connected. You can close this tab.');
    expect(done.page).toContain('Meetless 已连接 Notion，可以关闭此页。');

    expect(f.registrations()).toEqual([
      expect.objectContaining({
        client_name: 'Meetless',
        redirect_uris: [`http://127.0.0.1:${loopback.port}/oauth/callback`],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
      }),
    ]);

    expect(nc.status()).toBe('connected');
    expect(statSync(oauthFile(dataDir)).mode & 0o777).toBe(0o600);
    const stored = JSON.parse(readFileSync(oauthFile(dataDir), 'utf8')) as { tokens?: { access_token?: string }; client?: { client_id?: string }; verifier?: string };
    expect(stored.tokens?.access_token).toBe('fake-access-1');
    expect(stored.client?.client_id).toBe('fake-client-1');
    expect(stored.verifier).toBeUndefined(); // spent once the code is exchanged

    // The loopback server closed after the callback.
    await expect(fetch(done.location)).rejects.toThrow();
  });

  it('a callback with the wrong state is refused and stores nothing; the real one still completes', async () => {
    const f = await fake();
    const dataDir = dir('meetless-notion-');
    const nc = client(dataDir, f);
    const { authorizeUrl } = await nc.connect();
    const location = new URL((await fetch(authorizeUrl, { redirect: 'manual' })).headers.get('location')!);

    const forged = new URL(location);
    forged.searchParams.set('state', 'forged');
    const bad = await fetch(forged);
    expect(bad.status).toBe(400);
    await bad.text();
    expect(nc.status()).toBe('disconnected');

    const good = await fetch(location);
    expect(good.status).toBe(200);
    await good.text();
    expect(nc.status()).toBe('connected');
  });

  it('the loopback server closes after the authorization timeout', async () => {
    const f = await fake();
    const nc = client(dir('meetless-notion-'), f, { authTimeoutMs: 50 });
    const { authorizeUrl } = await nc.connect();
    const location = (await fetch(authorizeUrl, { redirect: 'manual' })).headers.get('location')!;
    await new Promise((r) => setTimeout(r, 150));
    await expect(fetch(location)).rejects.toThrow();
    expect(nc.status()).toBe('disconnected');
  });

  it('fetchPage returns paragraphs, and run captures those that match a need', async () => {
    const f = await fake(LAB_PAGE);
    const dataDir = dir('meetless-notion-');
    const nc = client(dataDir, f);
    await authorize(nc);

    expect(await nc.fetchPage(PAGE)).toEqual(['实验记录', 'N2 按月汇总已完成', '其他事项']);
    expect(f.toolCalls()).toBe(1);

    const { sv, submit } = service(dataDir, nc);
    const res = await sv.run({ state: withNotion(), me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-notion'] });
    expect(res.skipped).toEqual([]);
    expect(res.read).toBe(3);
    expect(res.recorded).toBe(1);
    expect(f.toolCalls()).toBe(2);

    const text = 'N2 按月汇总已完成';
    const key = `n:${createHash('sha256').update(text).digest('hex').slice(0, 16)}`;
    const cmd = submit.mock.calls[0]![0] as CommandInput<'work.recorded'>;
    expect(cmd.payload).toMatchObject({
      workId: captureWorkId('p1', 'a-notion', key, id('N2')),
      needId: id('N2'),
      src: 'doc',
      date: '2026-11-24',
      capture: true,
      autoLinked: true,
      private: false,
    });
    expect(cmd.payload.text).toContain('Lab notes');
    expect(cmd.payload.text).toContain('Notion');
    expect(cmd.payload.text).toContain(text);
  });

  it('a paragraph repeated on the page is read once', async () => {
    const f = await fake('N2 按月汇总已完成\nN2 按月汇总已完成');
    const dataDir = dir('meetless-notion-');
    const nc = client(dataDir, f);
    await authorize(nc);
    const { sv, submit } = service(dataDir, nc);
    const res = await sv.run({ state: withNotion(), me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-notion'] });
    expect(res.read).toBe(1);
    expect(res.recorded).toBe(1);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('an expired access token is refreshed without asking the user again', async () => {
    const f = await fake();
    const dataDir = dir('meetless-notion-');
    const nc = client(dataDir, f);
    await authorize(nc);
    f.expireAccess();
    expect(await nc.fetchPage(PAGE)).toEqual(['实验记录', 'N2 按月汇总已完成', '其他事项']);
    expect(nc.status()).toBe('connected');
    const stored = JSON.parse(readFileSync(oauthFile(dataDir), 'utf8')) as { tokens?: { access_token?: string } };
    expect(stored.tokens?.access_token).toBe('fake-access-2');
    expect(statSync(oauthFile(dataDir)).mode & 0o777).toBe(0o600);
  });

  it('a refresh that fails for a transient reason is notion_failed and keeps the refresh token', async () => {
    const f = await fake();
    const dataDir = dir('meetless-notion-');
    const nc = client(dataDir, f);
    await authorize(nc);
    f.expireAccess();
    f.failRefresh('server_error');

    await expect(nc.fetchPage(PAGE)).rejects.toMatchObject({ code: 'notion_failed' });
    expect(nc.status()).toBe('connected');
    const stored = JSON.parse(readFileSync(oauthFile(dataDir), 'utf8')) as { tokens?: { refresh_token?: string }; client?: { client_id?: string }; verifier?: string };
    expect(stored.tokens?.refresh_token).toBe('fake-refresh-1');
    expect(stored.client?.client_id).toBe('fake-client-1');
    expect(stored.verifier).toBeUndefined(); // the read never started an authorization of its own
    expect(statSync(oauthFile(dataDir)).mode & 0o777).toBe(0o600);
    expect(f.toolCalls()).toBe(0);

    // The run skips the source with notion_failed, not notion_not_connected.
    const { sv, submit } = service(dataDir, nc);
    const res = await sv.run({ state: withNotion(), me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-notion'] });
    expect(res.skipped).toEqual([{ artifactId: 'a-notion', code: 'notion_failed' }]);
    expect(submit).not.toHaveBeenCalled();
    expect(nc.status()).toBe('connected');

    // Once the server recovers, the kept refresh token works without asking the user again.
    f.failRefresh(null);
    expect(await nc.fetchPage(PAGE)).toEqual(['实验记录', 'N2 按月汇总已完成', '其他事项']);
    expect(f.registrations()).toHaveLength(1);
  });

  it('a client the server no longer knows is notion_not_connected, and a read never registers a new client', async () => {
    const f = await fake();
    const dataDir = dir('meetless-notion-');
    const nc = client(dataDir, f);
    await authorize(nc);
    expect(f.registrations()).toHaveLength(1);
    f.expireAccess();
    f.failRefresh('invalid_client');

    await expect(nc.fetchPage(PAGE)).rejects.toMatchObject({ code: 'notion_not_connected' });
    expect(nc.status()).toBe('disconnected');
    expect(existsSync(oauthFile(dataDir))).toBe(false);
    expect(f.registrations()).toHaveLength(1);
    expect(f.toolCalls()).toBe(0);
  });

  it('a revoked token makes status disconnected and the run skips the source; no old content comes back', async () => {
    const f = await fake();
    const dataDir = dir('meetless-notion-');
    const nc = client(dataDir, f);
    await authorize(nc);
    expect(await nc.fetchPage(PAGE)).toHaveLength(3);
    const callsBefore = f.toolCalls();

    f.revoke();
    const { sv, submit } = service(dataDir, nc);
    const res = await sv.run({ state: withNotion(), me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-notion'] });
    expect(res.skipped).toEqual([{ artifactId: 'a-notion', code: 'notion_not_connected' }]);
    expect(res.read).toBe(0);
    expect(res.recorded).toBe(0);
    expect(submit).not.toHaveBeenCalled();
    expect(nc.status()).toBe('disconnected');
    expect(f.toolCalls()).toBe(callsBefore);

    const stored = existsSync(oauthFile(dataDir)) ? (JSON.parse(readFileSync(oauthFile(dataDir), 'utf8')) as { tokens?: unknown }) : {};
    expect(stored.tokens).toBeUndefined();

    // Reading directly also refuses, without calling the tool.
    await expect(nc.fetchPage(PAGE)).rejects.toMatchObject({ code: 'notion_not_connected' });
    expect(f.toolCalls()).toBe(callsBefore);
    await expect(sv.notionPage(withNotion().artifacts['a-notion']!)).rejects.toMatchObject({ code: 'notion_not_connected' });
  });

  it('disconnect deletes the stored tokens', async () => {
    const f = await fake();
    const dataDir = dir('meetless-notion-');
    const nc = client(dataDir, f);
    await authorize(nc);
    expect(filesContaining(dataDir, 'fake-access-1')).toEqual(['capture/notion-oauth.json']);

    await nc.disconnect();
    expect(nc.status()).toBe('disconnected');
    expect(existsSync(oauthFile(dataDir))).toBe(false);
    for (const t of f.issued()) expect(filesContaining(dataDir, t)).toEqual([]);
    await expect(nc.fetchPage(PAGE)).rejects.toMatchObject({ code: 'notion_not_connected' });
    expect(f.toolCalls()).toBe(0);
  });

  it('disconnect during a pending authorization closes the loopback server', async () => {
    const f = await fake();
    const nc = client(dir('meetless-notion-'), f);
    const { authorizeUrl } = await nc.connect();
    const location = (await fetch(authorizeUrl, { redirect: 'manual' })).headers.get('location')!;
    await nc.disconnect();
    await expect(fetch(location)).rejects.toThrow();
    expect(nc.status()).toBe('disconnected');
  });

  it('a page link that is not Notion is bad_url', async () => {
    const f = await fake();
    const nc = client(dir('meetless-notion-'), f);
    await authorize(nc);
    for (const bad of ['https://example.com/page', 'http://www.notion.so/page', 'notion.so/page', '', 'https://notion.so.evil.com/page']) {
      await expect(nc.fetchPage(bad)).rejects.toMatchObject({ code: 'bad_url' });
    }
    expect(f.toolCalls()).toBe(0);

    // The dev-bridge host also accepts a loopback page id; the electron host never does.
    expect(await nc.fetchPage('http://127.0.0.1:9/page-1')).toHaveLength(3);
    const electron = client(dir('meetless-notion-'), f, { host: 'electron' });
    await expect(electron.fetchPage('http://127.0.0.1:9/page-1')).rejects.toMatchObject({ code: 'bad_url' });
  });

  it('a server that cannot be reached is notion_failed and keeps the connection', async () => {
    const f = await fake();
    const nc = client(dir('meetless-notion-'), f);
    await authorize(nc);
    await f.close();
    fakes.splice(fakes.indexOf(f), 1);
    await expect(nc.fetchPage(PAGE)).rejects.toMatchObject({ code: 'notion_failed' });
    expect(nc.status()).toBe('connected');
  });

  it('the electron host ignores MEETLESS_NOTION_MCP_URL', async () => {
    const f = await fake();
    process.env[ENV_KEY] = f.mcpUrl;
    expect(notionServerUrl('electron')).toBe(NOTION_MCP_URL);
    expect(notionServerUrl('dev-bridge')).toBe(f.mcpUrl);
    delete process.env[ENV_KEY];
    expect(notionServerUrl('dev-bridge')).toBe(NOTION_MCP_URL);

    process.env[ENV_KEY] = f.mcpUrl;
    const mk = (host: 'electron' | 'dev-bridge') => {
      const dataDir = dir('meetless-notion-');
      const sv = new CaptureService({ dataDir, submit: acceptingSubmit(), repos: new GitRepos(dataDir), host });
      services.push(sv);
      return sv;
    };
    expect(mk('electron').notionServerUrl).toBe(NOTION_MCP_URL);
    expect(mk('dev-bridge').notionServerUrl).toBe(f.mcpUrl);
    expect(f.registrations()).toEqual([]);
  });
});

describe('CaptureService: notion source', () => {
  it('status reports the Notion connection and the source readiness', async () => {
    const f = await fake();
    const dataDir = dir('meetless-notion-');
    const nc = client(dataDir, f);
    const { sv } = service(dataDir, nc);

    let st = await sv.status(withNotion(), 'u-alex', 'p1');
    expect(st.notion).toBe('disconnected');
    expect(st.sources.find((x) => x.artifactId === 'a-notion')).toMatchObject({ kind: 'notion', ready: false, code: 'notion_not_connected' });

    await authorize(nc);
    st = await sv.status(withNotion(), 'u-alex', 'p1');
    expect(st.notion).toBe('connected');
    expect(st.sources.find((x) => x.artifactId === 'a-notion')).toMatchObject({ kind: 'notion', ready: true, code: null });

    st = await sv.status(withNotion(null), 'u-alex', 'p1');
    expect(st.sources.find((x) => x.artifactId === 'a-notion')).toMatchObject({ kind: 'notion', ready: false, code: 'no_url' });
    st = await sv.status(withNotion('https://example.com/x'), 'u-alex', 'p1');
    expect(st.sources.find((x) => x.artifactId === 'a-notion')).toMatchObject({ kind: 'notion', ready: false, code: 'bad_url' });
    expect(f.toolCalls()).toBe(0); // status never reads the page
  });

  it('a notion artifact with no link is skipped with no_url', async () => {
    const f = await fake();
    const dataDir = dir('meetless-notion-');
    const nc = client(dataDir, f);
    await authorize(nc);
    const { sv } = service(dataDir, nc);
    const res = await sv.run({ state: withNotion(null), me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-notion'] });
    expect(res.skipped).toEqual([{ artifactId: 'a-notion', code: 'no_url' }]);
    expect(f.toolCalls()).toBe(0);
  });

  it('notionPage reads live and stores nothing of the page', async () => {
    const f = await fake();
    const dataDir = dir('meetless-notion-');
    const nc = client(dataDir, f);
    await authorize(nc);
    const { sv } = service(dataDir, nc);
    const page = await sv.notionPage(withNotion().artifacts['a-notion']!);
    expect(page.paragraphs).toEqual(['实验记录', 'N2 按月汇总已完成', '其他事项']);
    expect(Number.isNaN(Date.parse(page.fetchedAt))).toBe(false);
    expect(filesContaining(dataDir, '按月汇总')).toEqual([]);
  });

  it('tokens, client info and the PKCE verifier never reach the log or any file but the token file', async () => {
    const f = await fake();
    const dataDir = dir('meetless-notion-leak-');
    const logLines: string[] = [];
    const log = (m: string) => logLines.push(m);
    const nc = client(dataDir, f, { log });
    const { sv } = service(dataDir, nc, log);
    await authorize(nc);
    await sv.run({ state: withNotion(), me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-notion'] });
    f.expireAccess();
    await sv.notionPage(withNotion().artifacts['a-notion']!);
    f.revoke();
    await sv.run({ state: withNotion(), me: 'u-alex', today: '2026-11-24' }, { projectId: 'p1', artifactIds: ['a-notion'] });
    await authorize(nc);

    expect(logLines.length).toBeGreaterThan(0);
    const logged = logLines.join('\n');
    const secrets = [...f.issued(), ...f.verifiers(), 'fake-client-1', 'fake-client-2'];
    expect(f.verifiers().length).toBe(2);
    for (const secret of secrets) expect(logged).not.toContain(secret);
    expect(logged).not.toContain(PAGE);

    for (const t of f.issued()) {
      const hits = filesContaining(dataDir, t);
      expect(hits.every((h) => h === 'capture/notion-oauth.json')).toBe(true);
    }
    for (const v of f.verifiers()) expect(filesContaining(dataDir, v)).toEqual([]);
    expect(filesContaining(dataDir, 'fake-access-3')).toEqual(['capture/notion-oauth.json']);
    expect(statSync(oauthFile(dataDir)).mode & 0o777).toBe(0o600);
  });
});

describe('ClientNode: notion bridge methods', () => {
  it('the bridge lists the notion methods', () => {
    expect(BRIDGE_METHODS).toEqual(expect.arrayContaining(['notionConnect', 'notionDisconnect', 'notionPage']));
  });

  it('a signed-out node answers not_signed_in for every notion method', async () => {
    const node = await ClientNode.open({ dataDir: dir('meetless-notion-node-'), host: 'dev-bridge' });
    expect(await node.notionConnect()).toEqual({ ok: false, code: 'not_signed_in' });
    expect(await node.notionDisconnect()).toEqual({ ok: false, code: 'not_signed_in' });
    expect(await node.notionPage('a-notion')).toEqual({ ok: false, code: 'not_signed_in' });
    await node.close();
  });

  it('connects, reports, refuses an unknown artifact and disconnects, with no secret in any result', async () => {
    const f = await fake();
    process.env[ENV_KEY] = f.mcpUrl;
    const dataDir = dir('meetless-notion-node-');
    const logLines: string[] = [];

    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/v1/me') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ user: { id: 'u-alex', displayName: 'Alex' } }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const { port } = server.address() as { port: number };

    const node = await ClientNode.open({ dataDir, host: 'dev-bridge', log: (m) => logLines.push(m) });
    try {
      expect((await node.signIn(`http://127.0.0.1:${port}`, 'test-token')).ok).toBe(true);

      const results: unknown[] = [];
      const connected = await node.notionConnect();
      results.push(connected);
      expect(connected.ok).toBe(true);
      if (!connected.ok) return;
      expect(connected.authorizeUrl.startsWith(`${f.origin}/authorize?`)).toBe(true);
      const location = (await fetch(connected.authorizeUrl, { redirect: 'manual' })).headers.get('location')!;
      await (await fetch(location)).text();

      const status = await node.captureStatus('p1');
      results.push(status);
      expect(status.ok && status.status.notion).toBe('connected');

      const page = await node.notionPage('a-missing');
      results.push(page);
      expect(page).toEqual({ ok: false, code: 'not_found' });

      const gone = await node.notionDisconnect();
      results.push(gone);
      expect(gone).toEqual({ ok: true, disconnected: true });
      const after = await node.captureStatus('p1');
      results.push(after);
      expect(after.ok && after.status.notion).toBe('disconnected');

      const dumped = JSON.stringify(results);
      for (const secret of [...f.issued(), ...f.verifiers()]) expect(dumped).not.toContain(secret);
      // The client id appears only inside the authorize URL the user has to open.
      expect(JSON.stringify(results.slice(1))).not.toContain('fake-client-');
      const logged = logLines.join('\n');
      for (const secret of [...f.issued(), ...f.verifiers(), 'fake-client-1']) expect(logged).not.toContain(secret);
    } finally {
      await node.notionDisconnect();
      await node.close();
    }
  });
});
