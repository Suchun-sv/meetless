import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { MCP_PATH, type McpToolName } from '@meetless/api';
import { isProgress, needLink, openProposals, workFor } from '@meetless/core';
import { cmd, http, IDS, TODAY, TOKENS, withServer, type TestServer } from './helpers';
import { PRIVATE_WORD, seedTeam, type Team } from './seed';

type CallResult = Awaited<ReturnType<Client['callTool']>>;
type AgentCallRow = { tool: string; client: string | null; ok: boolean; code: string | null };

/** Mints an agent token for `userToken`'s user; returns the plaintext and the token row's own id. */
async function agentToken(base: string, userToken: string, label: string): Promise<{ token: string; id: string }> {
  const r = await http(base, userToken, 'POST', '/v1/tokens', { label });
  expect(r.status, `tokens.create for ${label}`).toBe(200);
  return { token: r.json.token as string, id: r.json.info.id as string };
}

/**
 * The end-to-end check the brief asks for: the official MCP SDK `Client` over
 * `StreamableHTTPClientTransport`, talking HTTP to a real server (real Postgres, `withServer`,
 * `seedTeam`), asserting real state changes and real privacy — not just a tool-shaped unit
 * test. Task 9's `mcp.test.ts` already exercises the route and lifecycle mechanics in detail;
 * this file is the end-to-end story: Lin's agent reads N1 through the link, reports on it,
 * proposes and verdicts, and can never see Alex's private items even through the carried-id
 * regression (R37), all through the seven tools alone.
 */
describe('MCP end-to-end over HTTP (SDK client against a real server)', () => {
  let s: TestServer;
  let team: Team;
  let lin: { token: string; id: string };
  let linMcp: Client;
  const clients: Client[] = [];

  async function connect(token: string, client: string | null = 'claude-code'): Promise<Client> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (client !== null) headers['X-Meetless-Client'] = client;
    const c = new Client({ name: 'meetless-e2e', version: '0.0.0' });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${s.base}${MCP_PATH}`), { requestInit: { headers } }));
    clients.push(c);
    return c;
  }

  const call = (c: Client, name: McpToolName, args: Record<string, unknown>): Promise<CallResult> => c.callTool({ name, arguments: args }) as Promise<CallResult>;
  const isError = (r: CallResult): boolean => r.isError === true;
  const text = (r: CallResult): string => {
    const content = r.content as { type: string; text?: string }[];
    expect(content[0]?.type).toBe('text');
    return content[0]!.text!;
  };

  async function agentCalls(): Promise<AgentCallRow[]> {
    const r = await http(s.base, TOKENS.lin, 'GET', '/v1/agent-calls?limit=200');
    expect(r.status).toBe(200);
    return r.json.calls as AgentCallRow[];
  }

  beforeAll(async () => {
    s = await withServer();
    team = await seedTeam(s.base);
    lin = await agentToken(s.base, TOKENS.lin, 'lin-mcp');
    linMcp = await connect(lin.token, 'claude-code');
  });
  afterAll(async () => {
    for (const c of clients) await c.close().catch(() => undefined);
    await s.stop();
  });

  it('the recipient’s agent pulls context through the link and the server records the fetch with client claude-code', async () => {
    const r = await call(linMcp, 'get_need_context', { link: needLink(team.projectId, 'N1') });
    expect(isError(r), text(r)).toBe(false);
    expect(text(r)).toContain('Export customer data to CSV');
    expect(s.svc.current.handoffs[team.handoffId]!.fetches.map((f) => [f.version, f.client])).toEqual([[1, 'claude-code']]);
    // The skill body is advertised to the SDK client as the server's instructions (contract §12.1).
    expect(linMcp.getInstructions()).toContain('get_need_context');
  });

  it('record_work is progress the sender sees; propose_need lands in To confirm; set_verdict changes the hypothesis', async () => {
    const work = await call(linMcp, 'record_work', { link: needLink(team.projectId, 'N1'), text: 'Drafted the CSV column list', effect: 'advance' });
    expect(isError(work), text(work)).toBe(false);
    const latest = workFor(s.svc.view(IDS.alex), team.needs.N1)
      .filter(isProgress)
      .at(-1)!;
    expect(latest.via!.client).toBe('claude-code');

    const before = openProposals(s.svc.current, team.projectId).length;
    const propose = await call(linMcp, 'propose_need', { projectId: team.projectId, kind: 'ext', title: 'Export to Excel as well', why: 'Asked in review' });
    expect(isError(propose), text(propose)).toBe(false);
    expect(openProposals(s.svc.current, team.projectId)).toHaveLength(before + 1);

    const verdict = await call(linMcp, 'set_verdict', { link: needLink(team.projectId, 'H1'), status: 'held', verdict: 'Measured: load time halved' });
    expect(isError(verdict), text(verdict)).toBe(false);
    expect(s.svc.current.needs[team.needs.H1]!.status).toBe('held');
  });

  it('list_needs, search and read_artifact never return the sender’s private need, its words or its private artifact', async () => {
    const listed = await call(linMcp, 'list_needs', { projectId: team.projectId });
    const found = await call(linMcp, 'search', { q: PRIVATE_WORD, projectId: team.projectId });
    const art = await call(linMcp, 'read_artifact', { projectId: team.projectId, artifactId: team.artifacts.secret });

    const listedCodes = (listed.structuredContent as { needs: { code: string }[] }).needs.map((n) => n.code);
    expect(listedCodes).not.toContain('Hp1');
    expect((found.structuredContent as { hits: unknown[] }).hits).toEqual([]);
    expect(isError(art)).toBe(true);
    expect(text(art)).toBe('Meetless error NOT_FOUND');

    const allOutputs = [listed, found, art].map((r) => JSON.stringify(r)).join('\n');
    expect(allOutputs).not.toMatch(new RegExp(PRIVATE_WORD));
    expect(allOutputs).not.toContain(team.needs.Hp1);
  });

  it("ids of private items carried on shared work resolve to nothing through MCP (R37 regression, Task 6's construction, read through the tools)", async () => {
    const privInputId = `input-${randomUUID()}`;
    const importRes = await http(
      s.base,
      TOKENS.alex,
      'POST',
      '/v1/commands',
      cmd('input.imported', {
        inputId: privInputId,
        projectId: team.projectId,
        kind: 'txt',
        title: 'Private notes',
        from: null,
        date: TODAY,
        blobHash: null,
        body: [{ id: `${privInputId}-p1`, text: `notes about ${PRIVATE_WORD} dosing protocol` }],
        extracts: [],
        detector: 'manual/1',
        private: true,
      }),
    );
    expect(importRes.status).toBe(201);

    const carrierNeedId = `need-${randomUUID()}`;
    const carrierWorkId = `work-${randomUUID()}`;
    const needRes = await http(
      s.base,
      TOKENS.alex,
      'POST',
      '/v1/commands',
      cmd('need.created', {
        needId: carrierNeedId,
        projectId: team.projectId,
        kind: 'hyp',
        title: 'Warm cache start',
        roundId: team.roundId,
        expect: 'Faster cold start',
        source: { src: 'meeting', date: TODAY, quote: 'warm cache start idea', ref: 'kickoff notes' },
        private: true,
      }),
    );
    expect(needRes.status).toBe(201);
    const workRes = await http(
      s.base,
      TOKENS.alex,
      'POST',
      '/v1/commands',
      cmd('work.recorded', {
        workId: carrierWorkId,
        projectId: team.projectId,
        needId: carrierNeedId,
        alsoNeedId: team.needs.Hp1,
        src: 'doc',
        text: 'cross-checked against an earlier private note',
        date: TODAY,
        private: true,
      }),
    );
    expect(workRes.status).toBe(201);
    const share = await http(s.base, TOKENS.alex, 'POST', '/v1/commands', cmd('need.shared', { needId: carrierNeedId }));
    expect(share.status).toBe(201);
    // Sharing the primary need never touches `alsoNeedId` (Hp1, still private): the carried id this test guards against.
    expect(s.svc.current.work[carrierWorkId]!.alsoNeedId).toBe(team.needs.Hp1);
    const carrierCode = s.svc.current.needs[carrierNeedId]!.code;
    expect(carrierCode).not.toBe('Hp1');

    const ctx = await call(linMcp, 'get_need_context', { projectId: team.projectId, code: carrierCode });
    expect(isError(ctx), text(ctx)).toBe(false);
    expect(text(ctx)).toContain('cross-checked');
    expect(text(ctx)).not.toContain(PRIVATE_WORD);
    expect(text(ctx)).not.toContain('dosing');
    expect(text(ctx)).not.toContain(team.needs.Hp1);

    const byCrossChecked = await call(linMcp, 'search', { q: 'cross-checked', projectId: team.projectId });
    expect(JSON.stringify(byCrossChecked)).not.toContain(team.needs.Hp1);
    const hits = (byCrossChecked.structuredContent as { hits: { kind: string; id: string; needCode: string | null }[] }).hits;
    const workHit = hits.find((h) => h.kind === 'work' && h.id === carrierWorkId);
    expect(workHit).toBeDefined();
    expect(workHit!.needCode).toBe(carrierCode);

    const byWord = await call(linMcp, 'search', { q: PRIVATE_WORD, projectId: team.projectId });
    expect((byWord.structuredContent as { hits: unknown[] }).hits).toEqual([]);
    const byRawNeedId = await call(linMcp, 'search', { q: team.needs.Hp1, projectId: team.projectId });
    expect(JSON.stringify(byRawNeedId)).not.toContain(team.needs.Hp1);
    const byRawInputId = await call(linMcp, 'search', { q: privInputId, projectId: team.projectId });
    expect(JSON.stringify(byRawInputId)).not.toContain(privInputId);

    const hidden = await call(linMcp, 'get_need_context', { projectId: team.projectId, code: 'Hp1' });
    expect(isError(hidden)).toBe(true);
    expect(text(hidden)).toBe('Meetless error NOT_FOUND');

    const listed = await call(linMcp, 'list_needs', { projectId: team.projectId });
    const listedCodes = (listed.structuredContent as { needs: { code: string }[] }).needs.map((n) => n.code);
    expect(listedCodes).not.toContain('Hp1');
    expect(listedCodes).toContain(carrierCode);

    const artifactProbe = await call(linMcp, 'read_artifact', { projectId: team.projectId, artifactId: privInputId });
    expect(isError(artifactProbe)).toBe(true);
    expect(text(artifactProbe)).toBe('Meetless error NOT_FOUND');

    for (const blob of [JSON.stringify(hidden), JSON.stringify(byWord), JSON.stringify(byCrossChecked), JSON.stringify(listed), JSON.stringify(artifactProbe), JSON.stringify(ctx)]) {
      expect(blob).not.toContain(PRIVATE_WORD);
      expect(blob).not.toContain('dosing');
      expect(blob).not.toContain(team.needs.Hp1);
    }
  });

  it('after the token is revoked the next tool call fails with TOKEN_REVOKED', async () => {
    const soon = await agentToken(s.base, TOKENS.lin, 'soon-revoked-e2e');
    const c = await connect(soon.token, 'claude-code');
    const ok = await call(c, 'list_needs', { projectId: team.projectId });
    expect(isError(ok), text(ok)).toBe(false);

    expect((await http(s.base, TOKENS.lin, 'DELETE', `/v1/tokens/${soon.id}`)).status).toBe(200);

    // Stateless transport: the next call is its own HTTP request, which now carries a revoked
    // bearer token. The 401 happens before any JSON-RPC response exists, so the SDK client
    // throws rather than returning an isError tool result (Task 9's note on this).
    let caught: unknown;
    try {
      await call(c, 'list_needs', { projectId: team.projectId });
    } catch (e) {
      caught = e;
    }
    expect(caught, 'the next call must throw once the token is revoked').toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('TOKEN_REVOKED');
    expect((caught as { code?: number }).code).toBe(401);
  });

  it('every call shows in Lin’s agentCalls with its tool name and client', async () => {
    const calls = await agentCalls();
    expect(calls.map((c) => c.tool)).toEqual(
      expect.arrayContaining(['get_need_context', 'record_work', 'propose_need', 'set_verdict', 'list_needs', 'search', 'read_artifact']),
    );
    expect(calls.filter((c) => c.client === 'claude-code').length).toBeGreaterThan(0);
    expect(calls.every((c) => typeof c.tool === 'string')).toBe(true);
  });
});
