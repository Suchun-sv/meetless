import { describe, expect, it } from 'vitest';
import type { AgentCall, AgentTokenInfo, ApiResponse } from '@meetless/api';
import { SEP } from '@meetless/core';
import { createTranslator } from '@meetless/i18n';
import type { Route } from '../../src/renderer/app/routes';
import { AgentGuide, AgentsPage, AgentsView, CallList, SetupSnippets, TokenList, type AgentsViewProps } from '../../src/renderer/setup/AgentsPage';
import { CODEX_ENV, routeErrorText, withToken } from '../../src/renderer/setup/model';
import { render, sample } from '../support/app';
import { guards } from '../support/guards';
import { alexApi, LOCALES, textOf } from '../shell/u1';

/** A fixture matching contract §12.1's exact `claudeCommand` and `codexToml` forms. */
const SETUP: ApiResponse<'agentSetup.get'> = {
  serverUrl: 'http://h',
  mcpUrl: 'http://h/mcp',
  claudeCommand:
    'claude mcp add --transport http meetless http://h/mcp --header "Authorization: Bearer <TOKEN>" --header "X-Meetless-Client: claude-code"',
  codexToml: '[mcp_servers.meetless]\nurl = "http://h/mcp"\nbearer_token_env_var = "MEETLESS_TOKEN"\nhttp_headers = { "X-Meetless-Client" = "codex" }\n',
  guidePath: '/v1/agent/guide',
};

const TOKENS: AgentTokenInfo[] = [
  { id: 'tok-1', label: 'MacBook Claude Code', createdAt: '2026-11-20T09:00:00.000Z', lastUsedAt: null, revokedAt: null },
  { id: 'tok-2', label: 'Server Codex', createdAt: '2026-11-21T09:00:00.000Z', lastUsedAt: '2026-11-22T09:00:00.000Z', revokedAt: null },
  { id: 'tok-3', label: 'Old laptop', createdAt: '2026-11-10T09:00:00.000Z', lastUsedAt: null, revokedAt: '2026-11-15T09:00:00.000Z' },
];

const CALLS: AgentCall[] = [
  { id: 'c1', at: '2026-11-24T09:00:00.000Z', tokenId: 'tok-1', client: 'claude-code', tool: 'get_need_context', projectId: 'sample-atlas', needCode: 'N3', ok: true, code: null },
  { id: 'c2', at: '2026-11-24T09:05:00.000Z', tokenId: 'tok-2', client: 'codex', tool: 'record_work', projectId: 'sample-atlas', needCode: null, ok: false, code: 'NOT_FOUND' },
  { id: 'c3', at: '2026-11-24T09:10:00.000Z', tokenId: 'tok-1', client: 'some-other-agent', tool: 'search', projectId: null, needCode: null, ok: true, code: null },
  { id: 'c4', at: '2026-11-24T09:15:00.000Z', tokenId: 'tok-1', client: null, tool: 'list_needs', projectId: null, needCode: null, ok: true, code: null },
];

describe('SetupSnippets', () => {
  it.each(LOCALES)('(%s) snippets from the server, with the placeholder note until a token is made', (l) => {
    const t = createTranslator(l).t;
    const html = render(alexApi(l), <SetupSnippets setup={SETUP} token={null} />);
    expect(textOf(html)).toContain('claude mcp add --transport http meetless http://h/mcp');
    expect(textOf(html)).toContain('bearer_token_env_var');
    expect(textOf(html)).toContain('export MEETLESS_TOKEN=<TOKEN>');
    expect(textOf(html)).toContain(t('ag.tokenPlaceholder'));
  });

  it('withToken fills the claude command and the Codex env line once a token exists', () => {
    expect(withToken(SETUP.claudeCommand, 'ml_abc')).toContain('Bearer ml_abc');
    expect(withToken(SETUP.claudeCommand, 'ml_abc')).not.toContain('<TOKEN>');
    expect(withToken(CODEX_ENV, 'ml_abc')).toBe('export MEETLESS_TOKEN=ml_abc');
  });

  it('a real token fills both snippets, and the placeholder note is gone', () => {
    const t = createTranslator('en').t;
    const html = render(alexApi('en'), <SetupSnippets setup={SETUP} token="ml_xyz" />);
    expect(textOf(html)).toContain('Bearer ml_xyz');
    expect(textOf(html)).toContain('export MEETLESS_TOKEN=ml_xyz');
    expect(textOf(html)).not.toContain('<TOKEN>');
    expect(textOf(html)).not.toContain(t('ag.tokenPlaceholder'));
  });

  it('codexToml never carries a token placeholder, and is shown as given', () => {
    const html = render(alexApi('en'), <SetupSnippets setup={SETUP} token="ml_xyz" />);
    expect(textOf(html)).toContain('bearer_token_env_var = "MEETLESS_TOKEN"');
  });
});

describe('AgentGuide', () => {
  it('AgentGuide shows the guide markdown as text, not HTML', () => {
    const markdown = '# Setup\n\n**Bold** stays literal, and <strong>this</strong> is not parsed as a tag.';
    const html = render(alexApi('en'), <AgentGuide markdown={markdown} />);
    expect(html).not.toMatch(/<strong>this<\/strong>/);
    expect(textOf(html)).toContain('**Bold**');
    expect(textOf(html)).toContain('<strong>this</strong>');
    expect(html).toContain('data-testid="agent-guide"');
  });
});

describe('TokenList', () => {
  it('revoke only on live tokens; never-used and last-used texts', () => {
    const t = createTranslator('en').t;
    const html = render(alexApi('en'), <TokenList tokens={TOKENS} onRevoke={() => {}} />);
    expect(html.match(/data-testid="token-revoke"/g)).toHaveLength(2);
    expect(textOf(html)).toContain(t('ag.neverUsed'));
    expect(textOf(html)).toContain(t('ag.revoked'));
    expect(html).toContain('class="st tone-muted"');
  });

  it('ag.noTokens shows once there are no tokens', () => {
    const t = createTranslator('en').t;
    const html = render(alexApi('en'), <TokenList tokens={[]} onRevoke={() => {}} />);
    expect(textOf(html)).toContain(t('ag.noTokens'));
  });

  it('a failed revoke shows inline on that row only, and never discards the already-loaded list', () => {
    const t = createTranslator('en').t;
    const html = render(alexApi('en'), <TokenList tokens={TOKENS} onRevoke={() => {}} revokeError={{ tokenId: 'tok-1', code: 'HTTP_404' }} />);
    expect(html.match(/data-testid="token"/g)).toHaveLength(3);
    expect(html.match(/data-testid="token-revoke-error"/g)).toHaveLength(1);
    const row = html.slice(html.indexOf('data-token="tok-1"'), html.indexOf('data-token="tok-2"'));
    expect(row).toContain('data-testid="token-revoke-error"');
    expect(textOf(row)).toContain(t('pj.unsupported'));
    expect(textOf(row)).not.toContain('HTTP_404');
    const otherRow = html.slice(html.indexOf('data-token="tok-2"'), html.indexOf('data-token="tok-3"'));
    expect(otherRow).not.toContain('data-testid="token-revoke-error"');
  });
});

describe('CallList', () => {
  const live = sample('en').state;

  it('client label, tool, need code, and failures in danger text', () => {
    const t = createTranslator('en').t;
    const html = render(alexApi('en'), <CallList calls={CALLS} live={live} />);
    expect(textOf(html)).toContain('Claude Code');
    expect(textOf(html)).toContain('Codex');
    expect(textOf(html)).toContain('some-other-agent');
    expect(textOf(html)).toContain('MCP');
    expect(textOf(html)).toContain('get_need_context');
    expect(textOf(html)).toContain('N3');
    expect(textOf(html)).toContain(live.projects['sample-atlas']!.name);
    expect(textOf(html)).toContain(t('ag.failed', { code: 'NOT_FOUND' }));
    expect(textOf(html)).toContain(t('ag.ok'));
    expect(html).toContain('class="small tone-danger"');
    expect(html).toContain('class="small tone-success"');
  });

  it('ag.noCalls shows once there are no calls', () => {
    const t = createTranslator('en').t;
    const html = render(alexApi('en'), <CallList calls={[]} live={live} />);
    expect(textOf(html)).toContain(t('ag.noCalls'));
  });

  it('never shows a leading separator when the call has no project (only a need code)', () => {
    const noProject: AgentCall = { id: 'c5', at: '2026-11-24T09:20:00.000Z', tokenId: 'tok-1', client: 'codex', tool: 'search', projectId: null, needCode: 'H1', ok: true, code: null };
    const html = render(alexApi('en'), <CallList calls={[noProject]} live={live} />);
    expect(html).not.toContain(`${SEP}H1`);
    expect(textOf(html)).toContain('H1');
  });

  it('shows nothing for "where" when the call has neither a project nor a need code', () => {
    const bare: AgentCall = { id: 'c6', at: '2026-11-24T09:25:00.000Z', tokenId: 'tok-1', client: 'codex', tool: 'search', projectId: null, needCode: null, ok: true, code: null };
    const html = render(alexApi('en'), <CallList calls={[bare]} live={live} />);
    expect(html).toContain('data-testid="call"');
  });
});

describe('AgentsPage', () => {
  const route: Route = { view: 'agents' };
  const page = <AgentsPage composer={() => null} />;

  it('the page lists all seven MCP tools with write marks on three', () => {
    const html = render(alexApi('en', { route }), page);
    expect(html).toContain('data-testid="page-agents"');
    expect(html.match(/data-tool=/g)).toHaveLength(7);
    expect(html.match(/class="small tone-neutral"/g)).toHaveLength(3);
  });

  it('while loading (static render, no effects) shows ag.sub, the headings and the token form, but no empty-list copy', () => {
    const t = createTranslator('en').t;
    const html = render(alexApi('en', { route }), page);
    expect(textOf(html)).toContain(t('ag.sub'));
    expect(html).toContain('data-testid="token-label"');
    expect(html).toContain('data-testid="token-create"');
    for (const k of ['ag.install', 'ag.guide', 'ag.tokens', 'ag.tools', 'ag.log'] as const) expect(textOf(html)).toContain(t(k));
    expect(textOf(html)).not.toContain(t('ag.noTokens'));
    expect(textOf(html)).not.toContain(t('ag.noCalls'));
    expect(html).not.toContain('data-testid="agents-error"');
  });

  it.each(LOCALES)('no dot symbol on the agents page and its lists (%s)', (l) => {
    guards('agents page', render(alexApi(l, { route }), page));
    guards('setup snippets with token', render(alexApi(l, { route }), <SetupSnippets setup={SETUP} token="ml_xyz" />));
    guards('token list', render(alexApi(l, { route }), <TokenList tokens={TOKENS} onRevoke={() => {}} />));
    guards('call list', render(alexApi(l, { route }), <CallList calls={CALLS} live={sample(l).state} />));
  });
});

describe('AgentsView', () => {
  const route: Route = { view: 'agents' };
  const base: AgentsViewProps = {
    setup: null,
    setupError: null,
    guide: null,
    guideError: null,
    tokens: null,
    tokensError: null,
    calls: null,
    callsError: null,
    revokeError: null,
    token: null,
    label: '',
    busy: false,
    onLabel: () => {},
    onCreate: () => {},
    onRevoke: () => {},
  };
  /** The markup of one page section, `data-section=<id>`. */
  const section = (html: string, id: string) => {
    const start = html.indexOf(`<section data-section="${id}"`);
    return html.slice(start, html.indexOf('</section>', start));
  };

  it.each(LOCALES)('(%s) on a server without the S routes, each section shows pj.unsupported under its own heading', (l) => {
    const tr = createTranslator(l);
    const errorText = (code: string) => (tr.has(`error.${code}`) ? tr.tDynamic(`error.${code}`) : tr.tDynamic('error.generic', { code }));
    const msg = routeErrorText(tr.t, errorText, 'HTTP_404');
    const html = render(alexApi(l, { route }), <AgentsView {...base} setupError={msg} guideError={msg} tokensError={msg} callsError={msg} />);
    const headings: Record<string, Parameters<typeof tr.t>[0]> = { setup: 'ag.install', guide: 'ag.guide', tokens: 'ag.tokens', calls: 'ag.log' };
    for (const [id, key] of Object.entries(headings)) {
      const sec = section(html, id);
      expect(sec, id).toContain(`<h3 class="h3">${tr.t(key)}</h3>`);
      expect(sec, id).toContain('data-testid="agents-error"');
      expect(textOf(sec), id).toContain(tr.t('pj.unsupported'));
    }
    expect(textOf(html)).not.toContain('HTTP_404');
    // The tools list never depends on a route.
    expect(html.match(/data-tool=/g)).toHaveLength(7);
    guards(`agents unsupported ${l}`, html);
  });

  it('another code keeps errorText(code)', () => {
    const tr = createTranslator('en');
    const errorText = (code: string) => (tr.has(`error.${code}`) ? tr.tDynamic(`error.${code}`) : tr.tDynamic('error.generic', { code }));
    const html = render(alexApi('en', { route }), <AgentsView {...base} callsError={routeErrorText(tr.t, errorText, 'HTTP_500')} />);
    expect(textOf(section(html, 'calls'))).toContain(tr.t('error.generic', { code: 'HTTP_500' }));
  });

  it('loaded empty lists show their empty copy; loaded rows show the lists and snippets', () => {
    const t = createTranslator('en').t;
    const empty = render(alexApi('en', { route }), <AgentsView {...base} tokens={[]} calls={[]} />);
    expect(textOf(section(empty, 'tokens'))).toContain(t('ag.noTokens'));
    expect(textOf(section(empty, 'calls'))).toContain(t('ag.noCalls'));
    const full = render(alexApi('en', { route }), <AgentsView {...base} setup={SETUP} guide="# Guide" tokens={TOKENS} calls={CALLS} token="ml_xyz" />);
    expect(section(full, 'setup')).toContain('Bearer ml_xyz');
    expect(section(full, 'guide')).toContain('data-testid="agent-guide"');
    expect(section(full, 'tokens')).toContain('data-testid="token-list"');
    expect(section(full, 'tokens')).toContain('data-testid="token-once"');
    expect(section(full, 'calls')).toContain('data-testid="call-list"');
  });
});
