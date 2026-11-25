import { MCP_PATH, type ApiResponse } from '@meetless/api';
import type { ServerConfig } from '../server';

/**
 * Setup text for the Agents page (contract §12.1): the `claude mcp add` command and
 * the Codex TOML block for the server's `/mcp` endpoint. The base URL is `cfg.agentUrl`
 * (`MEETLESS_AGENT_URL`) when set, else this request's own `protocol://host` (Fastify's
 * `request.protocol` and `request.host`, which follow X-Forwarded-Proto / -Host only behind
 * the configured `trustProxy` hops); a protocol other than `https` is `http`.
 *
 * `<TOKEN>` stays a literal placeholder in `claudeCommand`; the UI substitutes the
 * real token. The Codex TOML carries no token at all — Codex reads it from the
 * `MEETLESS_TOKEN` environment variable (`bearer_token_env_var`), so the Agents page
 * shows `export MEETLESS_TOKEN=<TOKEN>` next to it. Both forms send the
 * `X-Meetless-Client` header, so `agentCalls.list` can tell `claude-code` from `codex`.
 */
export function agentSetup(cfg: ServerConfig, host: string, protocol = 'http'): ApiResponse<'agentSetup.get'> {
  const raw = cfg.agentUrl ?? `${protocol === 'https' ? 'https' : 'http'}://${host}`;
  const serverUrl = raw.replace(/\/+$/, '');
  const mcpUrl = `${serverUrl}${MCP_PATH}`;
  const claudeCommand = `claude mcp add --transport http meetless ${mcpUrl} --header "Authorization: Bearer <TOKEN>" --header "X-Meetless-Client: claude-code"`;
  const codexToml = [
    '[mcp_servers.meetless]',
    `url = "${mcpUrl}"`,
    'bearer_token_env_var = "MEETLESS_TOKEN"',
    'http_headers = { "X-Meetless-Client" = "codex" }',
    '',
  ].join('\n');
  return { serverUrl, mcpUrl, claudeCommand, codexToml, guidePath: '/v1/agent/guide' };
}
