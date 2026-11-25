import type { Id, IsoDate, WorkEffect } from '@meetless/core';
import type { ApiName, ApiRequest, ApiResponse, ArtifactRead } from './types';

export const MCP_TOOLS = [
  'get_need_context',
  'list_needs',
  'search',
  'read_artifact',
  'record_work',
  'propose_need',
  'set_verdict',
] as const;

export type McpToolName = (typeof MCP_TOOLS)[number];

export const MCP_WRITE_TOOLS: ReadonlySet<McpToolName> = new Set<McpToolName>([
  'record_work',
  'propose_need',
  'set_verdict',
]);

export const MCP_TOOL_ROUTE: { [K in McpToolName]: ApiName } = {
  get_need_context: 'context.get',
  list_needs: 'needs.list',
  search: 'search',
  read_artifact: 'artifacts.read',
  record_work: 'work.record',
  propose_need: 'needs.propose',
  set_verdict: 'needs.verdict',
} as const;

export type NeedRef = { link: string } | { projectId: Id; code: string };

export interface McpToolSpec {
  get_need_context: { in: NeedRef & { locale?: 'zh-CN' | 'en' }; out: ApiResponse<'context.get'> };
  list_needs: { in: { projectId: Id } & ApiRequest<'needs.list'>; out: ApiResponse<'needs.list'> };
  search: { in: ApiRequest<'search'>; out: ApiResponse<'search'> };
  read_artifact: { in: ApiRequest<'artifacts.read'>; out: ArtifactRead };
  record_work: { in: NeedRef & { text: string; why?: string; effect?: WorkEffect; date?: IsoDate }; out: ApiResponse<'work.record'> };
  propose_need: { in: { projectId: Id } & Omit<ApiRequest<'needs.propose'>, 'projectId'>; out: ApiResponse<'needs.propose'> };
  set_verdict: {
    in: NeedRef & { status: 'testing' | 'held' | 'refuted' | 'parked'; verdict: string };
    out: ApiResponse<'needs.verdict'>;
  };
}

/**
 * The server's Streamable HTTP MCP endpoint (stateless, POST). Not an `API_ROUTES` entry:
 * it is served by the official MCP TypeScript SDK's server transport, with a bearer agent
 * token (same agent-token rules as `API_ROUTES`), inside the server process.
 */
export const MCP_PATH = '/mcp' as const;
