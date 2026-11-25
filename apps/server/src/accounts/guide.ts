import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { noDots } from '@meetless/core';
import type { Handler } from '../api/frame';
import { DEFAULT_REPO_ROOT } from '../sample';
import type { ServerConfig } from '../server';
import { agentSetup } from './setup';

/** Where the skill file lives in the repo, relative to its root. */
export const SKILL_RELATIVE_PATH = 'skills/meetless/SKILL.md';

/**
 * The path `agent.guide` reads the skill markdown from at startup: `MEETLESS_SKILL_PATH` if
 * set, else `<repoRoot>/skills/meetless/SKILL.md`. `repoRoot` defaults to this package's own
 * repo root (`DEFAULT_REPO_ROOT`) — deliberately independent of `ServerConfig.repoRoot`, which
 * is only about the sample prototype data (`sample.ts`), so a test or deployment that points
 * that one at a different tree never affects where the skill file is read from.
 */
export function skillPathFromEnv(env: Record<string, string | undefined>, repoRoot: string = DEFAULT_REPO_ROOT): string {
  return env.MEETLESS_SKILL_PATH || join(repoRoot, SKILL_RELATIVE_PATH);
}

/** Strips one leading `---\n...\n---` YAML front matter block, plus the blank line(s) after it. */
export function stripFrontMatter(markdown: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  const body = m ? markdown.slice(m[0].length) : markdown;
  return body.replace(/^\s*\n+/, '');
}

/**
 * Reads the skill file once at startup. A missing file is a clear startup error naming the
 * path (and the override env var); so is a file whose body is empty once its front matter and
 * surrounding whitespace are stripped (zero bytes, whitespace-only, or front matter with
 * nothing after it) — fix round 1 (review): that case used to resolve fine and silently give
 * `agent.guide` an empty "The skill" section and the MCP server empty `instructions`. Either
 * way, never a silently empty guide.
 */
export function loadSkillMarkdown(path: string): string {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`Meetless skill file not found at ${path} (set MEETLESS_SKILL_PATH to point at ${SKILL_RELATIVE_PATH})`, { cause: e });
  }
  if (stripFrontMatter(raw).trim().length === 0) {
    throw new Error(`Meetless skill file at ${path} has no body once its front matter is stripped (set MEETLESS_SKILL_PATH to point at a real ${SKILL_RELATIVE_PATH})`);
  }
  return raw;
}

/**
 * Token-agnostic setup text for `GET /v1/agent/guide` (contract §12.1, §12.10): the Claude Code
 * command and the Codex TOML from `agentSetup`, where to mint the token (`<TOKEN>` stays a
 * literal placeholder the UI substitutes), then the skill body (front matter stripped) to save
 * as `skills/meetless/SKILL.md` — the same file for both agents (§12.10 overrides the plan's
 * "AGENTS.md for Codex": there is no separate Codex copy, both read `skills/meetless/`). No dot
 * symbols anywhere in the output.
 */
export function agentGuide(cfg: ServerConfig, host: string, skillMarkdown: string): string {
  const { claudeCommand, codexToml } = agentSetup(cfg, host);
  const body = stripFrontMatter(skillMarkdown).trim();
  const md = [
    '# Connect an agent to Meetless',
    '',
    '## Claude Code',
    '',
    '```',
    claudeCommand,
    '```',
    '',
    '## Codex',
    '',
    '```toml',
    codexToml.trim(),
    '```',
    '',
    '```',
    'export MEETLESS_TOKEN=<TOKEN>',
    '```',
    '',
    'Create an agent token on the Agents page and put it where `<TOKEN>` is.',
    '',
    '## The skill',
    '',
    'Save this as `skills/meetless/SKILL.md`. Claude Code and Codex both pick up their own copy',
    'from `~/.claude/skills/meetless/` or `~/.codex/skills/meetless/`.',
    '',
    body,
    '',
  ].join('\n');
  return noDots(md);
}

/** `GET /v1/agent/guide`: the markdown above, from the skill read once at startup (`deps.skillMarkdown`). */
export const agentGuideGet: Handler<'agent.guide'> = async ({ http, deps }) => ({
  markdown: agentGuide(deps.cfg, http.host, deps.skillMarkdown),
});
