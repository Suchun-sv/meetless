import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOT_RE } from '@meetless/core';
import { hashSecret, newToken } from '../src/accounts/secrets';
import type { AgentCallRow } from '../src/store/types';
import { http, IDS, TOKENS, withServer, type TestServer } from './helpers';
import { seedTeam } from './seed';

describe('agent tokens, the call log, agent setup and the project list', () => {
  let s: TestServer;

  beforeAll(async () => {
    s = await withServer();
    await seedTeam(s.base);
  });
  afterAll(async () => {
    await s.stop();
  });

  it('tokens.create returns the token once; list shows label and dates but never the token or its hash', async () => {
    const created = await http(s.base, TOKENS.alex, 'POST', '/v1/tokens', { label: 'My Agent' });
    expect(created.status).toBe(200);
    expect(created.json.token).toMatch(/^mla_/);
    expect(created.json.info).toMatchObject({ label: 'My Agent', lastUsedAt: null, revokedAt: null });
    expect(typeof created.json.info.id).toBe('string');
    expect(typeof created.json.info.createdAt).toBe('string');

    const list = await http(s.base, TOKENS.alex, 'GET', '/v1/tokens');
    expect(list.status).toBe(200);
    expect(list.json.tokens.find((t: any) => t.id === created.json.info.id)).toMatchObject({ label: 'My Agent', revokedAt: null });
    expect(JSON.stringify(list.json)).not.toContain(created.json.token);
    expect(JSON.stringify(list.json)).not.toContain('sha256:');
  });

  it('an agent token reaches projects.list and its lastUsedAt moves; after revoke it answers TOKEN_REVOKED', async () => {
    const created = await http(s.base, TOKENS.alex, 'POST', '/v1/tokens', { label: 'proj-agent' });
    const tok = created.json.token as string;
    const tokenId = created.json.info.id as string;

    const r1 = await http(s.base, tok, 'GET', '/v1/projects');
    expect(r1.status).toBe(200);
    expect(r1.json.projects.map((p: any) => p.id)).toEqual(['p1']);

    const list = await http(s.base, TOKENS.alex, 'GET', '/v1/tokens');
    const info = list.json.tokens.find((t: any) => t.id === tokenId);
    expect(info.lastUsedAt).not.toBeNull();

    const revoke = await http(s.base, TOKENS.alex, 'DELETE', `/v1/tokens/${tokenId}`);
    expect(revoke.status).toBe(200);
    expect(revoke.json).toEqual({ revoked: true });

    const r2 = await http(s.base, tok, 'GET', '/v1/projects');
    expect(r2.status).toBe(401);
    expect(r2.json.error.code).toBe('TOKEN_REVOKED');
  });

  it("a user cannot see or revoke another user's token (revoke answers NOT_FOUND)", async () => {
    const created = await http(s.base, TOKENS.alex, 'POST', '/v1/tokens', { label: 'alex-only' });
    const tokenId = created.json.info.id as string;

    const linList = await http(s.base, TOKENS.lin, 'GET', '/v1/tokens');
    expect(linList.status).toBe(200);
    expect(linList.json.tokens.some((t: any) => t.id === tokenId)).toBe(false);

    const linRevoke = await http(s.base, TOKENS.lin, 'DELETE', `/v1/tokens/${tokenId}`);
    expect(linRevoke.status).toBe(404);
    expect(linRevoke.json.error.code).toBe('NOT_FOUND');

    // The token still works: a non-owner's failed revoke did not touch it.
    const stillWorks = await http(s.base, created.json.token, 'GET', '/v1/projects');
    expect(stillWorks.status).toBe(200);
  });

  it("tokens.revoke refuses the caller's own personal token id (NOT_FOUND); the personal token still works", async () => {
    const personalToken = newToken('personal');
    const personalId = `tok-personal-${randomUUID()}`;
    await s.accounts.createToken({
      id: personalId,
      kind: 'personal',
      userId: IDS.alex,
      label: 'app',
      tokenHash: hashSecret(personalToken),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    });

    const revoke = await http(s.base, TOKENS.alex, 'DELETE', `/v1/tokens/${personalId}`);
    expect(revoke.status).toBe(404);
    expect(revoke.json.error.code).toBe('NOT_FOUND');

    const stillWorks = await http(s.base, personalToken, 'GET', '/v1/me');
    expect(stillWorks.status).toBe(200);
    expect(stillWorks.json.user.id).toBe(IDS.alex);
  });

  it('the label is cleaned of dot symbols and trimmed; an empty label is BAD_REQUEST', async () => {
    const cleaned = await http(s.base, TOKENS.alex, 'POST', '/v1/tokens', { label: '  Claude · Code  ' });
    expect(cleaned.status).toBe(200);
    expect(cleaned.json.info.label).toBe('Claude Code');
    expect(DOT_RE.test(cleaned.json.info.label)).toBe(false);

    const empty = await http(s.base, TOKENS.alex, 'POST', '/v1/tokens', { label: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.json.error.code).toBe('BAD_REQUEST');

    const dotsOnly = await http(s.base, TOKENS.alex, 'POST', '/v1/tokens', { label: ' · ' });
    expect(dotsOnly.status).toBe(400);
    expect(dotsOnly.json.error.code).toBe('BAD_REQUEST');

    const ok40 = await http(s.base, TOKENS.alex, 'POST', '/v1/tokens', { label: 'x'.repeat(40) });
    expect(ok40.status).toBe(200);

    const tooLong = await http(s.base, TOKENS.alex, 'POST', '/v1/tokens', { label: 'x'.repeat(41) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.json.error.code).toBe('BAD_REQUEST');
  });

  it('agentCalls.list returns only my calls, newest first, 50 by default and at most 200', async () => {
    const BEN_N = 210;
    const base = Date.parse('2026-11-01T00:00:00.000Z');
    for (let i = 0; i < BEN_N; i++) {
      const row: AgentCallRow = {
        id: `call-ben-${i}`,
        at: new Date(base + i * 1000).toISOString(),
        userId: IDS.ben,
        tokenId: 'tok-ben-fake',
        client: 'codex',
        tool: 'search',
        projectId: null,
        needCode: null,
        ok: true,
        code: null,
      };
      await s.accounts.recordCall(row);
    }
    for (let i = 0; i < 4; i++) {
      const row: AgentCallRow = {
        id: `call-zhou-${i}`,
        at: new Date(base + i * 1000).toISOString(),
        userId: IDS.zhou,
        tokenId: 'tok-zhou-fake',
        client: 'claude-code',
        tool: 'list_needs',
        projectId: null,
        needCode: null,
        ok: true,
        code: null,
      };
      await s.accounts.recordCall(row);
    }

    const def = await http(s.base, TOKENS.ben, 'GET', '/v1/agent-calls');
    expect(def.status).toBe(200);
    expect(def.json.calls).toHaveLength(50);
    // Newest first: the newest-inserted row (i = BEN_N - 1) comes first.
    expect(def.json.calls[0].id).toBe(`call-ben-${BEN_N - 1}`);
    for (let i = 1; i < def.json.calls.length; i++) {
      expect(Date.parse(def.json.calls[i - 1].at)).toBeGreaterThanOrEqual(Date.parse(def.json.calls[i].at));
    }
    expect(def.json.calls.every((c: any) => c.id.startsWith('call-ben-'))).toBe(true);

    const capped = await http(s.base, TOKENS.ben, 'GET', '/v1/agent-calls?limit=1000');
    expect(capped.status).toBe(200);
    expect(capped.json.calls).toHaveLength(200);

    const small = await http(s.base, TOKENS.ben, 'GET', '/v1/agent-calls?limit=3');
    expect(small.status).toBe(200);
    expect(small.json.calls).toHaveLength(3);

    const zhouOnly = await http(s.base, TOKENS.zhou, 'GET', '/v1/agent-calls');
    expect(zhouOnly.status).toBe(200);
    expect(zhouOnly.json.calls).toHaveLength(4);
    expect(zhouOnly.json.calls.every((c: any) => c.id.startsWith('call-zhou-'))).toBe(true);

    // A non-integer limit is a wrong-typed field (final review I1); an out-of-range one is clamped.
    const bad = await http(s.base, TOKENS.ben, 'GET', '/v1/agent-calls?limit=abc');
    expect(bad.status).toBe(400);
    expect(bad.json).toEqual({ error: { code: 'BAD_REQUEST', details: { field: 'limit' } } });
    const zero = await http(s.base, TOKENS.ben, 'GET', '/v1/agent-calls?limit=0');
    expect(zero.status).toBe(200);
    expect(zero.json.calls).toHaveLength(1);
  });

  it('agentSetup gives the claude mcp add command and a codex TOML with <TOKEN>, the request host as URL and a client label per agent', async () => {
    const r = await http(s.base, TOKENS.alex, 'GET', '/v1/agent-setup');
    expect(r.status).toBe(200);
    expect(r.json.serverUrl).toBe(s.base);
    expect(r.json.mcpUrl).toBe(`${s.base}/mcp`);
    expect(r.json.claudeCommand).toBe(
      `claude mcp add --transport http meetless ${r.json.mcpUrl} --header "Authorization: Bearer <TOKEN>" --header "X-Meetless-Client: claude-code"`,
    );
    expect(r.json.codexToml).toBe(
      ['[mcp_servers.meetless]', `url = "${r.json.mcpUrl}"`, 'bearer_token_env_var = "MEETLESS_TOKEN"', 'http_headers = { "X-Meetless-Client" = "codex" }', ''].join(
        '\n',
      ),
    );
    expect(r.json.codexToml).not.toContain('<TOKEN>');
    expect(r.json.guidePath).toBe('/v1/agent/guide');
  });

  it('agentSetup uses MEETLESS_AGENT_URL (trailing slash stripped) instead of the request host', async () => {
    const s2 = await withServer({ agentUrl: 'https://meetless.example.org/' });
    try {
      const r = await http(s2.base, TOKENS.alex, 'GET', '/v1/agent-setup');
      expect(r.status).toBe(200);
      expect(r.json.serverUrl).toBe('https://meetless.example.org');
      expect(r.json.mcpUrl).toBe('https://meetless.example.org/mcp');
    } finally {
      await s2.stop();
    }
  });

  it('agentSetup without MEETLESS_AGENT_URL uses the request protocol: https behind a trusted proxy saying so, and never a bare header (M1)', async () => {
    const setup = async (base: string, headers: Record<string, string>) => {
      const res = await fetch(`${base}/v1/agent-setup`, { headers: { authorization: `Bearer ${TOKENS.alex}`, ...headers } });
      expect(res.status).toBe(200);
      return (await res.json()) as { serverUrl: string; mcpUrl: string; claudeCommand: string; codexToml: string };
    };
    const proxied = await withServer({ trustProxy: 1 });
    try {
      const host = new URL(proxied.base).host;
      const https = await setup(proxied.base, { 'x-forwarded-proto': 'https' });
      expect(https.serverUrl).toBe(`https://${host}`);
      expect(https.mcpUrl).toBe(`https://${host}/mcp`);
      expect(https.claudeCommand).toContain(` https://${host}/mcp `);
      expect(https.codexToml).toContain(`url = "https://${host}/mcp"`);
      expect((await setup(proxied.base, {})).serverUrl).toBe(`http://${host}`);
      // Only http and https are ever written out.
      expect((await setup(proxied.base, { 'x-forwarded-proto': 'javascript' })).serverUrl).toBe(`http://${host}`);
    } finally {
      await proxied.stop();
    }
    // With no trusted proxy, X-Forwarded-Proto is the client's own claim and is ignored.
    expect((await setup(s.base, { 'x-forwarded-proto': 'https' })).serverUrl).toBe(s.base);
  });

  it('Eve’s agent token lists no project', async () => {
    const created = await http(s.base, TOKENS.eve, 'POST', '/v1/tokens', { label: 'eve-agent' });
    expect(created.status).toBe(200);
    const r = await http(s.base, created.json.token, 'GET', '/v1/projects');
    expect(r.status).toBe(200);
    expect(r.json.projects).toEqual([]);
  });
});
