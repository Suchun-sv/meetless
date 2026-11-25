import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MCP_TOOLS } from '@meetless/api';
import { DOT_RE } from '@meetless/core';
import { agentGuide, loadSkillMarkdown, SKILL_RELATIVE_PATH, skillPathFromEnv, stripFrontMatter } from '../src/accounts/guide';
import { agentSetup } from '../src/accounts/setup';
import { DEFAULT_REPO_ROOT } from '../src/sample';
import { startServer } from '../src/server';
import { http, serverConfig, tempDir, TOKENS, withServer, type TestServer } from './helpers';

const SKILL_PATH = join(DEFAULT_REPO_ROOT, SKILL_RELATIVE_PATH);
const raw = readFileSync(SKILL_PATH, 'utf8');

describe('skills/meetless/SKILL.md', () => {
  it('names itself meetless with a description, names every MCP tool, and contains no dot symbol', () => {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
    expect(fm, 'front matter block').not.toBeNull();
    const front = fm![1]!;
    expect(/^\s*name:\s*meetless\s*$/m.test(front)).toBe(true);

    const desc = /^\s*description:\s*(.+)$/m.exec(front);
    expect(desc, 'a description line').not.toBeNull();
    expect(desc![1]!.length).toBeGreaterThan(20);
    expect(/meetless:\/\//.test(desc![1]!)).toBe(true);
    expect(/handoff/i.test(desc![1]!)).toBe(true);

    for (const tool of MCP_TOOLS) expect(raw, tool).toContain(tool);

    expect(DOT_RE.test(raw)).toBe(false);
    expect(raw).toMatch(/Claude Code/);
    expect(raw).toMatch(/Codex/);
    expect(raw).not.toMatch(/cursor|copilot|windsurf|cline/i);

    // Button names in both languages (brief: To confirm / 待确认, Return / 交回).
    expect(raw).toContain('待确认');
    expect(raw).toMatch(/To confirm/i);
    expect(raw).toContain('交回');
    expect(raw).toMatch(/Return/);

    // Markdown lists use "-" or numbers, never a dot glyph.
    for (const line of raw.split('\n')) {
      const bullet = /^\s*([-*•·▪●])\s/.exec(line);
      if (bullet) expect(bullet[1], line).toBe('-');
    }
  });

  it('stripFrontMatter removes the front matter block but keeps the body, with every tool name still in it', () => {
    const body = stripFrontMatter(raw);
    expect(body).not.toContain('name: meetless');
    expect(body).not.toContain('description:');
    expect(body.startsWith('#')).toBe(true);
    for (const tool of MCP_TOOLS) expect(body, tool).toContain(tool);
  });
});

describe('skillPathFromEnv / loadSkillMarkdown', () => {
  it('honours MEETLESS_SKILL_PATH, else <repoRoot>/skills/meetless/SKILL.md', () => {
    expect(skillPathFromEnv({ MEETLESS_SKILL_PATH: '/custom/path.md' })).toBe('/custom/path.md');
    expect(skillPathFromEnv({})).toBe(SKILL_PATH);
    expect(skillPathFromEnv({ MEETLESS_SKILL_PATH: '' })).toBe(SKILL_PATH);
    expect(skillPathFromEnv({}, '/some/other/repo')).toBe('/some/other/repo/skills/meetless/SKILL.md');
  });

  it('loadSkillMarkdown reads the real file; a missing file throws a clear error naming the path', () => {
    expect(loadSkillMarkdown(SKILL_PATH)).toBe(raw);
    expect(() => loadSkillMarkdown('/no/such/meetless-skill.md')).toThrow(/no\/such\/meetless-skill\.md/);
    expect(() => loadSkillMarkdown('/no/such/meetless-skill.md')).toThrow(/MEETLESS_SKILL_PATH/);
  });

  // Fix round 1 (review): a file that exists but has nothing real in it must fail the same way
  // a missing one does, not resolve into a silently empty guide and empty MCP instructions.
  it('loadSkillMarkdown rejects a file whose body is empty once front matter and whitespace are stripped', () => {
    const dir = tempDir('guide-empty-body');
    try {
      const cases: Record<string, string> = {
        'empty.md': '',
        'whitespace-only.md': '   \n\t\n  \n',
        'front-matter-only.md': '---\nname: meetless\ndescription: nothing after this\n---\n',
        'front-matter-only-trailing-whitespace.md': '---\nname: meetless\n---\n\n   \n',
      };
      for (const [name, content] of Object.entries(cases)) {
        const p = join(dir.path, name);
        writeFileSync(p, content, 'utf8');
        expect(() => loadSkillMarkdown(p), name).toThrow(p);
        expect(() => loadSkillMarkdown(p), name).toThrow(/MEETLESS_SKILL_PATH/);
        expect(() => loadSkillMarkdown(p), name).toThrow(/no body/);
      }
      // A file with real content after its front matter still loads fine (sanity check that the new rule isn't over-eager).
      const real = join(dir.path, 'real.md');
      writeFileSync(real, '---\nname: meetless\n---\n\nSomething real.\n', 'utf8');
      expect(loadSkillMarkdown(real)).toContain('Something real.');
    } finally {
      dir.rm();
    }
  });
});

describe('agentGuide', () => {
  it('builds token-agnostic setup text: claude command, codex TOML with <TOKEN>, export line, and the skill body with front matter stripped, no dots', () => {
    const cfg = serverConfig({ dataDir: '/tmp/unused-agent-guide-test', databaseUrl: null, agentUrl: 'https://meetless.example.org' });
    const md = agentGuide(cfg, 'ignored-when-agentUrl-is-set', raw);
    const setup = agentSetup(cfg, 'ignored-when-agentUrl-is-set');

    expect(md).toContain(setup.claudeCommand);
    expect(md).toContain('bearer_token_env_var = "MEETLESS_TOKEN"');
    expect(md).toContain('export MEETLESS_TOKEN=<TOKEN>');
    expect(md).toContain('skills/meetless/SKILL.md');
    expect(md).not.toContain('name: meetless');
    expect(md).not.toContain('description:');
    for (const tool of MCP_TOOLS) expect(md, tool).toContain(tool);
    expect(DOT_RE.test(md)).toBe(false);
  });
});

describe('agent.guide (GET /v1/agent/guide, real server)', () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await withServer();
  });
  afterAll(async () => {
    await s.stop();
  });

  it('returns the claude command, the codex TOML with <TOKEN> and the skill body, with no dots; an agent token is NOT_AUTHORISED', async () => {
    const r = await http(s.base, TOKENS.lin, 'GET', '/v1/agent/guide');
    expect(r.status).toBe(200);
    const md = r.json.markdown as string;
    const setup = agentSetup(s.cfg, new URL(s.base).host);

    expect(md).toContain(setup.claudeCommand);
    expect(md).toContain(setup.codexToml.trim());
    expect(md).toContain('export MEETLESS_TOKEN=<TOKEN>');
    for (const tool of MCP_TOOLS) expect(md, tool).toContain(tool);
    expect(md).not.toContain('name: meetless');
    expect(DOT_RE.test(md)).toBe(false);

    // Without a token: refused like every other auth: 'user' route.
    const noToken = await http(s.base, null, 'GET', '/v1/agent/guide');
    expect(noToken.status).toBe(401);
    expect(noToken.json.error.code).toBe('UNAUTHENTICATED');

    // An agent token is not a user: NOT_AUTHORISED (same as any other auth: 'user' route).
    const minted = await http(s.base, TOKENS.lin, 'POST', '/v1/tokens', { label: 'agent-guide-check' });
    expect(minted.status).toBe(200);
    const asAgent = await http(s.base, minted.json.token as string, 'GET', '/v1/agent/guide');
    expect(asAgent.status).toBe(403);
    expect(asAgent.json.error.code).toBe('NOT_AUTHORISED');
  });
});

describe('a missing or empty skill file is a startup error, not a silent empty guide', () => {
  it('startServer rejects with a clear message naming the configured path (missing file)', async () => {
    const dir = tempDir('guide-missing');
    try {
      await expect(
        startServer(serverConfig({ dataDir: dir.path, databaseUrl: null, env: { MEETLESS_SKILL_PATH: '/no/such/meetless-skill.md' } })),
      ).rejects.toThrow(/no\/such\/meetless-skill\.md/);
    } finally {
      dir.rm();
    }
  });

  it('startServer rejects the same way for a file that exists but has no body after its front matter', async () => {
    const dir = tempDir('guide-empty-startup');
    try {
      const emptyBody = join(dir.path, 'empty-skill.md');
      writeFileSync(emptyBody, '---\nname: meetless\n---\n', 'utf8');
      await expect(startServer(serverConfig({ dataDir: dir.path, databaseUrl: null, env: { MEETLESS_SKILL_PATH: emptyBody } }))).rejects.toThrow(
        /no body/,
      );
    } finally {
      dir.rm();
    }
  });
});
