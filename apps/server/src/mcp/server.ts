import { readFileSync } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CLIENT_HEADER, MCP_PATH, MCP_TOOLS, requestParts, type ApiErrorBody, type McpToolName } from '@meetless/api';
import { stripFrontMatter } from '../accounts/guide';
import { authenticateRequest, errorResponse, type ApiDeps } from '../api/frame';
import { toRoute, TOOL_DESCRIPTION, TOOL_INPUT } from './tools';

/** This server package's version, reported as the MCP server's version. */
const VERSION = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

/** The largest JSON-RPC request body `/mcp` accepts (TOO_LARGE above it), the same as the API's. */
export const MCP_BODY_LIMIT = 1024 * 1024;

/** What a tool call forwards to the route it runs: the caller's own credentials, client name and address. */
interface Forward {
  authorization: string;
  client: string | null;
  /** The outer request's `request.ip`, so a failed inner authentication is counted against the caller, not 127.0.0.1. */
  ip: string;
}

const toolError = (code: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text: `Meetless error ${code}` }] });

const firstHeader = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * Runs one tool: `toRoute`, then the route itself through the same Fastify app (`app.inject`),
 * with the caller's Authorization and client header. Auth, privacy, agent-call recording and
 * error mapping all happen in the route's frame; nothing is recorded here. 2xx: the data as
 * `structuredContent`, text = the markdown (`get_need_context`) or pretty JSON. Otherwise a
 * tool error naming only the error code.
 */
async function runTool(app: FastifyInstance, tool: McpToolName, args: Record<string, unknown>, fwd: Forward): Promise<CallToolResult> {
  const route = toRoute(tool, args);
  if ('error' in route) return toolError(route.error);
  const parts = requestParts(route.name, route.req, '');
  const headers: Record<string, string> = { authorization: fwd.authorization };
  if (fwd.client !== null) headers[CLIENT_HEADER] = fwd.client;
  if (parts.body !== null) headers['content-type'] = 'application/json';
  const res = await app.inject({ method: parts.method, url: parts.url, headers, remoteAddress: fwd.ip, ...(parts.body !== null ? { payload: parts.body } : {}) });
  let data: unknown = null;
  try {
    data = JSON.parse(res.body);
  } catch {
    data = null;
  }
  const isObject = data !== null && typeof data === 'object' && !Array.isArray(data);
  if (res.statusCode >= 200 && res.statusCode < 300 && isObject) {
    const record = data as Record<string, unknown>;
    const text = tool === 'get_need_context' && typeof record.markdown === 'string' ? record.markdown : JSON.stringify(record, null, 2);
    return { content: [{ type: 'text', text }], structuredContent: record };
  }
  const code = isObject ? (data as Partial<ApiErrorBody>).error?.code : undefined;
  return toolError(typeof code === 'string' && code !== '' ? code : 'INTERNAL');
}

/**
 * A fresh MCP server for one request, with the seven `MCP_TOOLS` (nothing else, so never
 * `remember` or `recall`) and the skill body (front matter stripped) as `instructions`
 * (contract §12.1's "optionally pass the skill body as the MCP server's instructions").
 */
function mcpServerFor(app: FastifyInstance, fwd: Forward, instructions: string): McpServer {
  const server = new McpServer({ name: 'meetless', version: VERSION }, { instructions });
  for (const tool of MCP_TOOLS) {
    server.registerTool(tool, { description: TOOL_DESCRIPTION[tool], inputSchema: TOOL_INPUT[tool] }, (args: Record<string, unknown>) =>
      runTool(app, tool, args, fwd),
    );
  }
  return server;
}

/** JSON-RPC's own error shape, which MCP clients read, for the methods a stateless server does not serve. */
const methodNotAllowed = async (_req: FastifyRequest, reply: FastifyReply) =>
  reply
    .code(405)
    .header('allow', 'POST')
    .send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });

/**
 * `POST MCP_PATH`: MCP over Streamable HTTP, stateless (contract §12.1).
 * - The bearer token is checked in `onRequest`, before the body is read, by the same
 *   `authenticateRequest` and sign-in limiter as every `/v1/*` route (any principal kind, as on
 *   `auth: 'agent'` routes). Failure: 401 UNAUTHENTICATED / TOKEN_REVOKED, or 429 RATE_LIMITED
 *   with Retry-After, in the API error shape. No MCP processing happens without a principal.
 * - Per request: a fresh `McpServer` and a session-less transport with JSON responses; the reply
 *   is hijacked and both are closed when the response closes.
 * - `GET` and `DELETE` answer 405 with `Allow: POST` (no SSE stream, no sessions).
 */
export function registerMcp(app: FastifyInstance, deps: ApiDeps): void {
  // Built once for the server's lifetime, not per request: the skill markdown never changes
  // while the process is running.
  const instructions = stripFrontMatter(deps.skillMarkdown).trim();
  app.route({
    method: 'POST',
    url: MCP_PATH,
    bodyLimit: MCP_BODY_LIMIT,
    onRequest: async (req) => {
      await authenticateRequest(deps.auth, req, deps.rateLimits.signIn);
    },
    handler: async (req, reply) => {
      const fwd: Forward = { authorization: req.headers.authorization ?? '', client: firstHeader(req.headers[CLIENT_HEADER]), ip: req.ip };
      const server = mcpServerFor(app, fwd, instructions);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      reply.hijack();
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        transport.close().catch(() => undefined);
        server.close().catch(() => undefined);
      };
      reply.raw.on('close', close);
      try {
        await server.connect(transport);
        await transport.handleRequest(req.raw, reply.raw, req.body);
      } catch (e) {
        req.log.error(e);
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(500, { 'content-type': 'application/json' });
          reply.raw.end(JSON.stringify({ error: { code: 'INTERNAL' } }));
        } else {
          reply.raw.end();
        }
        close();
      }
    },
    errorHandler: async (err, req, reply) => {
      const out = errorResponse(err);
      if (out.status >= 500) req.log.error(err);
      for (const [k, v] of Object.entries(out.headers ?? {})) reply.header(k, v);
      return reply.code(out.status).send(out.body);
    },
  });
  app.get(MCP_PATH, methodNotAllowed);
  app.delete(MCP_PATH, methodNotAllowed);
}
