import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from '@meetless/core';
import { CLAUDE_PROVIDER_ID, ClaudeProjectAgentProvider } from '../src/agents/claude';

describe('ClaudeProjectAgentProvider (inert placeholder)', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('the Claude adapter is inert: answering rejects with CLAUDE_NOT_ENABLED and makes no request', async () => {
    const fetchStub = vi.fn(() => {
      throw new Error('ClaudeProjectAgentProvider must never call fetch');
    });
    globalThis.fetch = fetchStub as unknown as typeof fetch;

    const provider = new ClaudeProjectAgentProvider();
    expect(provider.id).toBe(CLAUDE_PROVIDER_ID);
    expect(provider.simulated).toBe(false);

    await expect(
      provider.answer(emptyState(), { userId: 'u-lin', scope: { kind: 'home' }, text: 'what should I do today', today: '2026-11-24' }),
    ).rejects.toMatchObject({ message: 'CLAUDE_NOT_ENABLED', code: 'CLAUDE_NOT_ENABLED' });

    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('startServer does not reference the Claude adapter (never constructs it)', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../src/server.ts'), 'utf8');
    expect(src).not.toMatch(/ClaudeProjectAgentProvider/);
  });
});
