import type { AgentReply, AgentRequest, ProjectAgentProvider, State } from '@meetless/core';

/** Provider id reserved for a real Claude-backed project agent (design §7). Not active yet. */
export const CLAUDE_PROVIDER_ID = 'anthropic/claude';

/**
 * Placeholder adapter for the project agent `ProjectAgentProvider` slot
 * (`@meetless/core`'s `rulesProvider` is the one actually wired today).
 *
 * INERT: `answer()` always rejects with `CLAUDE_NOT_ENABLED` and performs no
 * I/O — no API key is read, no `fetch`/socket call is attempted. `startServer`
 * never constructs this class. It exists only so the provider id and the
 * `ProjectAgentProvider` shape are fixed ahead of ever enabling a real model.
 */
export class ClaudeProjectAgentProvider implements ProjectAgentProvider {
  readonly id = CLAUDE_PROVIDER_ID;
  readonly simulated = false;

  async answer(_view: State, _req: AgentRequest): Promise<AgentReply> {
    throw Object.assign(new Error('CLAUDE_NOT_ENABLED'), { code: 'CLAUDE_NOT_ENABLED' });
  }
}
