/**
 * U3-owned. T3: a fake Notion MCP server on 127.0.0.1:0, so no test ever
 * reaches notion.com. It plays both roles of the real thing: an OAuth
 * authorization server (RFC 9728 / RFC 8414 discovery, dynamic client
 * registration, PKCE-checked authorization code and refresh grants) and an
 * MCP server (an SDK `McpServer` on a stateless `StreamableHTTPServerTransport`)
 * with one tool, `notion-fetch`. Only the most recently issued access token is
 * accepted at `/mcp`; any other bearer gets a 401 with `resource_metadata`.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { NOTION_FETCH_TOOL } from '../../src/capture/notion';

export interface FakeNotion {
  origin: string;
  mcpUrl: string;
  /** How many `notion-fetch` calls reached the tool (i.e. passed the bearer check). */
  toolCalls: () => number;
  /** Revokes the current access token and every refresh token: the user withdrew access in Notion. */
  revoke(): void;
  /** Expires the current access token only; refresh tokens keep working. */
  expireAccess(): void;
  /**
   * Makes the refresh grant fail without touching any token: `server_error` answers 500
   * (a transient outage), `invalid_client` answers 401 (the server forgot the client).
   * `null` restores normal refreshes.
   */
  failRefresh(kind: 'server_error' | 'invalid_client' | null): void;
  /** Dynamic client registrations received, as posted. */
  registrations: () => Record<string, unknown>[];
  /** Every PKCE `code_verifier` the token endpoint received. */
  verifiers: () => string[];
  /** Every token issued (access and refresh), so leak sweeps know what to look for. */
  issued: () => string[];
  close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));
}

export async function startFakeNotion(opts: { page?: string } = {}): Promise<FakeNotion> {
  const page = opts.page ?? '# Page\nHello';
  let origin = '';
  let calls = 0;
  let accessN = 0;
  let currentAccess: string | null = null;
  const refreshTokens = new Set<string>();
  const clients = new Map<string, { redirect_uris: string[] }>();
  const codes = new Map<string, { clientId: string; redirectUri: string; challenge: string }>();
  const registrations: Record<string, unknown>[] = [];
  const verifiers: string[] = [];
  const issued: string[] = [];
  let codeN = 0;
  let refreshFailure: 'server_error' | 'invalid_client' | null = null;

  const issue = () => {
    accessN += 1;
    currentAccess = `fake-access-${accessN}`;
    const refresh = `fake-refresh-${accessN}`;
    refreshTokens.add(refresh);
    issued.push(currentAccess, refresh);
    return { access_token: currentAccess, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh };
  };

  const handleMcp = async (req: IncomingMessage, res: ServerResponse) => {
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (!bearer || bearer !== currentAccess) {
      json(res, 401, { error: 'invalid_token' }, { 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` });
      return;
    }
    // Stateless: a fresh server and transport per request. `zod` is not a dependency of
    // packages/client, so the tool is wired through the low-level handlers of `McpServer.server`.
    const mcp = new McpServer({ name: 'fake-notion', version: '0.0.0' });
    mcp.server.registerCapabilities({ tools: {} });
    mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: NOTION_FETCH_TOOL, inputSchema: { type: 'object' as const, properties: { id: { type: 'string' } }, required: ['id'] } }],
    }));
    mcp.server.setRequestHandler(CallToolRequestSchema, async (r) => {
      if (r.params.name !== NOTION_FETCH_TOOL) return { content: [{ type: 'text' as const, text: 'unknown tool' }], isError: true };
      calls += 1;
      const id = (r.params.arguments as { id?: unknown } | undefined)?.id;
      if (typeof id !== 'string' || id.length === 0) return { content: [{ type: 'text' as const, text: 'id is required' }], isError: true };
      return { content: [{ type: 'text' as const, text: page }] };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  };

  const server = createServer((req, res) => {
    void (async () => {
      const u = new URL(req.url ?? '/', origin);
      const path = u.pathname;
      if (path.startsWith('/.well-known/oauth-protected-resource')) {
        json(res, 200, { resource: `${origin}/mcp`, authorization_servers: [origin] });
        return;
      }
      if (path === '/.well-known/oauth-authorization-server') {
        json(res, 200, {
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        });
        return;
      }
      if (path === '/register' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as Record<string, unknown> & { redirect_uris: string[] };
        registrations.push(body);
        const clientId = `fake-client-${registrations.length}`;
        clients.set(clientId, { redirect_uris: body.redirect_uris });
        json(res, 201, { ...body, client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000) });
        return;
      }
      if (path === '/authorize' && req.method === 'GET') {
        const clientId = u.searchParams.get('client_id') ?? '';
        const redirectUri = u.searchParams.get('redirect_uri') ?? '';
        const challenge = u.searchParams.get('code_challenge') ?? '';
        const client = clients.get(clientId);
        if (!client || !client.redirect_uris.includes(redirectUri) || !challenge || u.searchParams.get('code_challenge_method') !== 'S256') {
          json(res, 400, { error: 'invalid_request' });
          return;
        }
        codeN += 1;
        const code = `c${codeN}`;
        codes.set(code, { clientId, redirectUri, challenge });
        const to = new URL(redirectUri);
        to.searchParams.set('code', code);
        const state = u.searchParams.get('state');
        if (state !== null) to.searchParams.set('state', state);
        res.writeHead(302, { location: to.href }).end();
        return;
      }
      if (path === '/token' && req.method === 'POST') {
        const form = new URLSearchParams(await readBody(req));
        const grant = form.get('grant_type');
        if (grant === 'authorization_code') {
          const code = codes.get(form.get('code') ?? '');
          const verifier = form.get('code_verifier') ?? '';
          verifiers.push(verifier);
          const challenge = createHash('sha256').update(verifier).digest('base64url');
          if (!code || code.clientId !== form.get('client_id') || code.redirectUri !== form.get('redirect_uri') || code.challenge !== challenge) {
            json(res, 400, { error: 'invalid_grant' });
            return;
          }
          codes.delete(form.get('code') ?? '');
          json(res, 200, issue());
          return;
        }
        if (grant === 'refresh_token') {
          if (refreshFailure === 'server_error') {
            json(res, 500, { error: 'server_error' });
            return;
          }
          if (refreshFailure === 'invalid_client') {
            json(res, 401, { error: 'invalid_client' });
            return;
          }
          const refresh = form.get('refresh_token') ?? '';
          if (!refreshTokens.has(refresh)) {
            json(res, 400, { error: 'invalid_grant' });
            return;
          }
          refreshTokens.delete(refresh);
          json(res, 200, issue());
          return;
        }
        json(res, 400, { error: 'unsupported_grant_type' });
        return;
      }
      if (path === '/mcp') {
        await handleMcp(req, res);
        return;
      }
      res.writeHead(404).end();
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    mcpUrl: `${origin}/mcp`,
    toolCalls: () => calls,
    revoke() {
      currentAccess = null;
      refreshTokens.clear();
    },
    expireAccess() {
      currentAccess = null;
    },
    failRefresh(kind) {
      refreshFailure = kind;
    },
    registrations: () => registrations.slice(),
    verifiers: () => verifiers.slice(),
    issued: () => issued.slice(),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
