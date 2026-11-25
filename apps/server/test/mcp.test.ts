import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CLIENT_HEADER, MCP_PATH, MCP_TOOL_ROUTE, MCP_TOOLS, type McpToolName } from '@meetless/api';
import { DOT_RE, needLink } from '@meetless/core';
import { toRoute, TOOL_DESCRIPTION, TOOL_INPUT } from '../src/mcp/tools';
import { http, IDS, TOKENS, until, withServer, type TestServer } from './helpers';
import { PRIVATE_WORD, seedTeam, type Team } from './seed';

type CallResult = Awaited<ReturnType<Client['callTool']>>;
type AgentCallRow = { id: string; tool: string; client: string | null; projectId: string | null; needCode: string | null; ok: boolean; code: string | null; tokenId: string };

/** Mints an agent token for `userToken`'s user; returns the plaintext and the token row's own id. */
async function agentToken(base: string, userToken: string, label: string): Promise<{ token: string; id: string }> {
  const r = await http(base, userToken, 'POST', '/v1/tokens', { label });
  expect(r.status, `tokens.create for ${label}`).toBe(200);
  return { token: r.json.token as string, id: r.json.info.id as string };
}

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
};

/** A raw POST /mcp (no SDK), so a test sees exactly what the server answers. */
async function rawMcp(base: string, token: string | null, body: unknown = INIT) {
  const res = await fetch(`${base}${MCP_PATH}`, {
    method: 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

describe('MCP over Streamable HTTP at /mcp', () => {
  let s: TestServer;
  let team: Team;
  let lin: { token: string; id: string };
  const clients: Client[] = [];
  /** Every tool result any test saw, for the "token appears in no output" check. */
  const outputs: CallResult[] = [];

  /** An SDK client on `/mcp` with the bearer token and (unless null) the client header. */
  async function connect(token: string, client: string | null = 'claude-code'): Promise<Client> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (client !== null) headers['X-Meetless-Client'] = client;
    const c = new Client({ name: 'meetless-test', version: '0.0.0' });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${s.base}${MCP_PATH}`), { requestInit: { headers } }));
    clients.push(c);
    return c;
  }

  async function call(c: Client, name: McpToolName, args: Record<string, unknown>): Promise<CallResult> {
    const r = await c.callTool({ name, arguments: args });
    outputs.push(r);
    return r;
  }

  const textOf = (r: CallResult): string => {
    const content = r.content as { type: string; text?: string }[];
    expect(content[0]?.type).toBe('text');
    return content[0]!.text!;
  };

  async function agentCalls(): Promise<AgentCallRow[]> {
    const r = await http(s.base, TOKENS.lin, 'GET', '/v1/agent-calls?limit=200');
    expect(r.status).toBe(200);
    return r.json.calls as AgentCallRow[];
  }

  let linMcp: Client;

  beforeAll(async () => {
    s = await withServer();
    team = await seedTeam(s.base);
    lin = await agentToken(s.base, TOKENS.lin, 'lin-mcp');
    linMcp = await connect(lin.token);
  });
  afterAll(async () => {
    for (const c of clients) await c.close().catch(() => undefined);
    await s.stop();
  });

  it('lists exactly the seven MCP_TOOLS, each with a description and an input schema', async () => {
    const { tools } = await linMcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOLS].sort());
    expect(tools.some((t) => t.name === 'remember' || t.name === 'recall')).toBe(false);
    for (const t of tools) {
      const name = t.name as McpToolName;
      expect(t.description, name).toBe(TOOL_DESCRIPTION[name]);
      expect(t.description!.length, name).toBeGreaterThan(20);
      expect(DOT_RE.test(t.description!), name).toBe(false);
      expect(t.inputSchema.type).toBe('object');
      expect(Object.keys(t.inputSchema.properties ?? {}).sort(), name).toEqual(Object.keys(TOOL_INPUT[name]).sort());
    }
    // NeedRef tools take the link or projectId + code, all optional; the other required fields are required.
    const ctx = tools.find((t) => t.name === 'get_need_context')!;
    expect(ctx.inputSchema.required ?? []).toEqual([]);
    const work = tools.find((t) => t.name === 'record_work')!;
    expect(work.inputSchema.required).toEqual(['text']);
    const propose = tools.find((t) => t.name === 'propose_need')!;
    expect([...(propose.inputSchema.required ?? [])].sort()).toEqual(['kind', 'projectId', 'title']);
    expect(TOOL_DESCRIPTION.record_work).toMatch(/progress/i);
    expect(TOOL_DESCRIPTION.propose_need).toMatch(/To confirm/);
    expect(TOOL_DESCRIPTION.get_need_context).toMatch(/before/i);
  });

  it('get_need_context with a meetless link returns the need markdown and the server records the call with tool and client', async () => {
    const before = (await agentCalls()).length;
    const r = await call(linMcp, 'get_need_context', { link: needLink(team.projectId, 'N1') });
    expect(r.isError).toBeFalsy();
    const text = textOf(r);
    expect(text.startsWith('# N1 Export customer data to CSV')).toBe(true);
    const data = r.structuredContent as { markdown: string; projectId?: string };
    expect(text).toBe(data.markdown);

    const calls = await agentCalls();
    expect(calls.length).toBe(before + 1);
    expect(calls).toContainEqual(
      expect.objectContaining({ tool: 'get_need_context', client: 'claude-code', projectId: 'p1', needCode: 'N1', ok: true, code: null, tokenId: lin.id }),
    );

    // Without the client header the call is labelled with the token's label.
    const bare = await connect(lin.token, null);
    const r2 = await call(bare, 'get_need_context', { projectId: team.projectId, code: 'N1' });
    expect(r2.isError).toBeFalsy();
    const after = await agentCalls();
    expect(after.length).toBe(before + 2);
    expect(after.filter((c) => c.tool === 'get_need_context' && c.client === 'lin-mcp')).toHaveLength(1);
  });

  it('each tool reaches the route named in MCP_TOOL_ROUTE (agentCalls shows every tool name)', async () => {
    const c = await connect(lin.token, 'codex');
    const before = await agentCalls();
    const p = team.projectId;
    const results: Record<McpToolName, CallResult> = {
      get_need_context: await call(c, 'get_need_context', { projectId: p, code: 'N1', locale: 'zh-CN' }),
      list_needs: await call(c, 'list_needs', { projectId: p, kind: 'ext' }),
      search: await call(c, 'search', { q: 'CSV export', projectId: p }),
      read_artifact: await call(c, 'read_artifact', { projectId: p, artifactId: team.artifacts.deck }),
      record_work: await call(c, 'record_work', { link: needLink(p, 'N1'), text: 'Drafted the CSV column list', effect: 'advance' }),
      propose_need: await call(c, 'propose_need', { projectId: p, kind: 'ext', title: 'Export to Excel as well', why: 'Asked in review' }),
      set_verdict: await call(c, 'set_verdict', { projectId: p, code: 'H1', status: 'testing', verdict: 'Measuring list load time now' }),
    };
    for (const t of MCP_TOOLS) expect(results[t].isError, `${t}: ${textOf(results[t])}`).toBeFalsy();

    const seen = new Set(before.map((r) => r.id));
    const added = (await agentCalls()).filter((r) => !seen.has(r.id));
    expect(added.map((r) => r.tool).sort()).toEqual([...MCP_TOOLS].sort());
    for (const row of added) expect(row).toMatchObject({ client: 'codex', ok: true, tokenId: lin.id, projectId: p });

    // The routes really ran: the ones each tool names in MCP_TOOL_ROUTE.
    expect(MCP_TOOL_ROUTE.record_work).toBe('work.record');
    const workId = (results.record_work.structuredContent as { workId: string }).workId;
    expect(s.svc.current.work[workId]).toMatchObject({ by: IDS.lin, src: 'agent', via: { client: 'codex', tokenId: lin.id }, needId: team.needs.N1 });
    const proposalId = (results.propose_need.structuredContent as { proposalId: string }).proposalId;
    expect(typeof proposalId).toBe('string');
    expect(s.svc.current.needs[team.needs.H1]!.status).toBe('testing');
    expect(textOf(results.get_need_context)).toBe((results.get_need_context.structuredContent as { markdown: string }).markdown);
    // Other tools answer pretty JSON of the same data.
    expect(JSON.parse(textOf(results.list_needs))).toEqual(results.list_needs.structuredContent);
    expect(textOf(results.list_needs)).toContain('\n  ');
    const listed = (results.list_needs.structuredContent as { needs: { code: string }[] }).needs.map((n) => n.code);
    expect(listed).toContain('N1');
    expect(listed).not.toContain('H1');
  });

  it('a bad link, or neither link nor projectId and code, is a tool error INVALID_REF and records no agent call', async () => {
    const before = (await agentCalls()).length;
    const bad: [McpToolName, Record<string, unknown>][] = [
      ['get_need_context', { link: 'https://example.com/p1/N1' }],
      ['get_need_context', { link: 'meetless://p1' }],
      ['get_need_context', {}],
      ['get_need_context', { projectId: team.projectId }],
      ['record_work', { code: 'N1', text: 'no project' }],
      ['set_verdict', { status: 'held', verdict: 'holds' }],
    ];
    for (const [tool, args] of bad) {
      const r = await call(linMcp, tool, args);
      expect(r.isError, `${tool} ${JSON.stringify(args)}`).toBe(true);
      expect(textOf(r)).toBe('Meetless error INVALID_REF');
    }
    expect((await agentCalls()).length).toBe(before);
  });

  it("an API error comes back as a tool error naming the code (another user's private need is NOT_FOUND)", async () => {
    const priv = await call(linMcp, 'get_need_context', { projectId: team.projectId, code: 'Hp1' });
    const missing = await call(linMcp, 'get_need_context', { projectId: team.projectId, code: 'N999' });
    expect(priv.isError).toBe(true);
    expect(textOf(priv)).toBe('Meetless error NOT_FOUND');
    expect(JSON.stringify(priv)).toBe(JSON.stringify(missing));
    expect(JSON.stringify(priv)).not.toContain(PRIVATE_WORD);
    const art = await call(linMcp, 'read_artifact', { projectId: team.projectId, artifactId: team.artifacts.secret });
    expect(art.isError).toBe(true);
    expect(textOf(art)).toBe('Meetless error NOT_FOUND');
    // The failure is still recorded, by the frame, with its code.
    const calls = await agentCalls();
    expect(calls).toContainEqual(expect.objectContaining({ tool: 'get_need_context', needCode: 'Hp1', ok: false, code: 'NOT_FOUND' }));
  });

  it('no token, an unknown token or a revoked token is refused with 401 before any MCP processing; GET /mcp is 405', async () => {
    const none = await rawMcp(s.base, null);
    expect(none.status).toBe(401);
    expect(none.json).toEqual({ error: { code: 'UNAUTHENTICATED' } });

    const unknown = await rawMcp(s.base, 'mlt_not_a_real_token');
    expect(unknown.status).toBe(401);
    expect(unknown.json).toEqual({ error: { code: 'UNAUTHENTICATED' } });

    const gone = await agentToken(s.base, TOKENS.lin, 'soon-revoked');
    const ok = await rawMcp(s.base, gone.token);
    expect(ok.status).toBe(200);
    expect(ok.json.result.serverInfo.name).toBe('meetless');
    expect((await http(s.base, TOKENS.lin, 'DELETE', `/v1/tokens/${gone.id}`)).status).toBe(200);
    const revoked = await rawMcp(s.base, gone.token);
    expect(revoked.status).toBe(401);
    expect(revoked.json).toEqual({ error: { code: 'TOKEN_REVOKED' } });
    await expect(connect(gone.token)).rejects.toThrow();

    // Auth runs before the body is even parsed: a malformed body with no token is 401, not 400.
    const junk = await rawMcp(s.base, null, '{not json');
    expect(junk.status).toBe(401);
    expect((await rawMcp(s.base, lin.token, '{not json')).status).toBe(400);

    // The request body has a size limit.
    const big = { ...INIT, params: { ...INIT.params, pad: 'x'.repeat(2 * 1024 * 1024) } };
    const tooBig = await rawMcp(s.base, lin.token, big);
    expect(tooBig.status).toBe(413);
    expect(tooBig.json).toEqual({ error: { code: 'TOO_LARGE' } });

    for (const method of ['GET', 'DELETE']) {
      const r = await fetch(`${s.base}${MCP_PATH}`, { method, headers: { authorization: `Bearer ${lin.token}`, accept: 'text/event-stream' } });
      expect(r.status, method).toBe(405);
      expect(r.headers.get('allow'), method).toBe('POST');
      await r.text();
    }
  });

  it('each request gets a fresh stateless server and transport, both closed once the response closes', async () => {
    const connects = vi.spyOn(McpServer.prototype, 'connect');
    const serverCloses = vi.spyOn(McpServer.prototype, 'close');
    const transportCloses = vi.spyOn(StreamableHTTPServerTransport.prototype, 'close');
    try {
      const first = await rawMcp(s.base, lin.token);
      expect(first.status).toBe(200);
      expect(first.headers.get('mcp-session-id')).toBeNull();
      // Stateless: a request without initialize or a session id is served on its own.
      const listed = await rawMcp(s.base, lin.token, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      expect(listed.status).toBe(200);
      expect((listed.json.result.tools as { name: string }[]).map((t) => t.name).sort()).toEqual([...MCP_TOOLS].sort());
      expect(connects).toHaveBeenCalledTimes(2);
      expect(new Set(connects.mock.instances).size).toBe(2);
      await until(() => serverCloses.mock.calls.length >= 2 && transportCloses.mock.calls.length >= 2, 5000, 'server and transport closed');
      // No MCP object is even built for a refused request.
      expect((await rawMcp(s.base, 'mlt_nope')).status).toBe(401);
      expect(connects).toHaveBeenCalledTimes(2);
    } finally {
      connects.mockRestore();
      serverCloses.mockRestore();
      transportCloses.mockRestore();
    }
  });

  it('toRoute: link and projectId+code forms; link removed from the request', () => {
    expect(toRoute('get_need_context', { link: 'meetless://p1/N1', locale: 'en' })).toEqual({
      name: 'context.get',
      req: { projectId: 'p1', code: 'N1', locale: 'en' },
    });
    expect(toRoute('get_need_context', { link: 'meetless://p%201/N%2F1' })).toEqual({ name: 'context.get', req: { projectId: 'p 1', code: 'N/1' } });
    expect(toRoute('record_work', { projectId: 'p1', code: 'N1', text: 'did it' })).toEqual({
      name: 'work.record',
      req: { projectId: 'p1', code: 'N1', text: 'did it' },
    });
    const viaLink = toRoute('set_verdict', { link: 'meetless://p1/H1', status: 'held', verdict: 'it holds' });
    expect(viaLink).toEqual({ name: 'needs.verdict', req: { projectId: 'p1', code: 'H1', status: 'held', verdict: 'it holds' } });
    expect('link' in (viaLink as { req: object }).req).toBe(false);
    // A link wins over projectId + code given alongside it.
    expect(toRoute('get_need_context', { link: 'meetless://p1/N1', projectId: 'p9', code: 'X9' })).toEqual({
      name: 'context.get',
      req: { projectId: 'p1', code: 'N1' },
    });
    for (const args of [{ link: 'nope' }, { link: '' }, { link: 'meetless://p1/%E0%A4%A' }, { link: 'meetless:///N1' }, { link: 7 }, {}, { projectId: 'p1' }, { code: 'N1' }, { projectId: '', code: 'N1' }])
      expect(toRoute('get_need_context', args as Record<string, unknown>), JSON.stringify(args)).toEqual({ error: 'INVALID_REF' });
    // Every other tool's input is passed through under its route's name, renamed nowhere.
    expect(toRoute('search', { q: 'csv', projectId: 'p1', limit: 5 })).toEqual({ name: 'search', req: { q: 'csv', projectId: 'p1', limit: 5 } });
    expect(toRoute('list_needs', { projectId: 'p1', round: 'current' })).toEqual({ name: 'needs.list', req: { projectId: 'p1', round: 'current' } });
    expect(toRoute('read_artifact', { projectId: 'p1', artifactId: 'a1' })).toEqual({ name: 'artifacts.read', req: { projectId: 'p1', artifactId: 'a1' } });
    expect(toRoute('propose_need', { projectId: 'p1', kind: 'hyp', title: 't' })).toEqual({ name: 'needs.propose', req: { projectId: 'p1', kind: 'hyp', title: 't' } });
    for (const t of MCP_TOOLS) {
      const r = toRoute(t, { link: 'meetless://p1/N1', projectId: 'p1', code: 'N1', q: 'x', artifactId: 'a', kind: 'ext', title: 't', text: 'x', status: 'held', verdict: 'v' });
      expect('name' in r && r.name, t).toBe(MCP_TOOL_ROUTE[t]);
    }
  });

  it('the token appears in no tool output', async () => {
    const c = await connect(lin.token);
    await call(c, 'search', { q: 'Export' });
    await call(c, 'get_need_context', { link: needLink(team.projectId, 'N1') });
    await call(c, 'get_need_context', { link: 'bad' });
    await call(c, 'list_needs', { projectId: 'no-such-project' });
    expect(outputs.length).toBeGreaterThan(20);
    const secret = lin.token.slice(-16);
    for (const o of outputs) {
      const all = JSON.stringify(o);
      expect(all).not.toContain(lin.token);
      expect(all).not.toContain(secret);
    }
    expect(CLIENT_HEADER).toBe('x-meetless-client');
  });
});

describe('MCP sign-in rate limit (contract §12.8)', () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await withServer({ rateLimits: { signIn: { limit: 2, windowMs: 60_000 }, redeem: { limit: 1000, windowMs: 60_000 } } });
  });
  afterAll(async () => {
    await s.stop();
  });

  it('failed bearer tokens on /mcp count toward the same per-IP limiter as /v1, then 429 RATE_LIMITED with Retry-After; a valid token still passes', async () => {
    expect((await http(s.base, 'mlt_bad_one', 'GET', '/v1/me')).status).toBe(401);
    expect((await rawMcp(s.base, 'mlt_bad_two')).status).toBe(401);
    const limited = await rawMcp(s.base, 'mlt_bad_three');
    expect(limited.status).toBe(429);
    expect(limited.json.error.code).toBe('RATE_LIMITED');
    expect(typeof limited.json.error.details.retryAfter).toBe('number');
    expect(limited.headers.get('retry-after')).toBe(String(limited.json.error.details.retryAfter));
    // /v1 sees the same counter.
    expect((await http(s.base, 'mlt_bad_four', 'GET', '/v1/me')).status).toBe(429);
    // A request with no token is not a guess: plain 401 even past the limit.
    expect((await rawMcp(s.base, null)).status).toBe(401);
    // A valid token is never counted or blocked.
    const r = await http(s.base, TOKENS.lin, 'POST', '/v1/tokens', { label: 'ok' });
    expect(r.status).toBe(200);
    const ok = await rawMcp(s.base, r.json.token as string);
    expect(ok.status).toBe(200);
    expect(ok.json.result.serverInfo.name).toBe('meetless');
  });
});
