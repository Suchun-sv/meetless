import { useEffect, useRef, useState } from 'react';
import { MCP_TOOLS, MCP_WRITE_TOOLS, type AgentCall, type AgentTokenInfo, type ApiResponse } from '@meetless/api';
import { SEP, type Id, type State } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { useApp } from '../app/AppContext';
import type { PageProps } from '../app/pages';
import { Btn } from '../ui/primitives';
import { CODEX_ENV, clientLabel, routeErrorText, tokenSectionErrorAfterCreate, withToken } from './model';
import './setup.css';

type AgentSetup = ApiResponse<'agentSetup.get'>;

/**
 * A copy button for one snippet: `ag.copy`, then `ag.copied` for 1.4s (Task 9/10's pattern on
 * `invite-copy`). `navigator.clipboard` may not exist in tests, so the call is guarded. The
 * revert timer is cleared on unmount (and before starting a new one on a second click), so it
 * never fires a `setState` after the component is gone.
 */
function CopyBtn({ text }: { text: string }) {
  const { t } = useApp();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = () => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  };
  return (
    <Btn testId="snippet-copy" onClick={copy}>
      {t(copied ? 'ag.copied' : 'ag.copy')}
    </Btn>
  );
}

/** A labelled snippet: a caption row with its copy button, then the `pre.snip` block. */
function Snippet({ labelKey, text }: { labelKey: MessageKey; text: string }) {
  const { t } = useApp();
  return (
    <div>
      <p className="row gap6">
        <span className="small muted grow">{t(labelKey)}</span>
        <CopyBtn text={text} />
      </p>
      <pre className="snip">{text}</pre>
    </div>
  );
}

/**
 * The install commands for Claude Code and Codex (contract §12.1), built from S's own
 * `agentSetup.get` — there is no local fake of `claudeCommand` or `codexToml`. `token` fills
 * every `<TOKEN>` placeholder once one exists (held only by `AgentsPage`'s own state); until
 * then the placeholder stays and `ag.tokenPlaceholder` explains why. MCP is the server's own
 * HTTP route, so there is no stdio command and no local skill install beyond copying the file.
 */
export function SetupSnippets({ setup, token }: { setup: AgentSetup; token: string | null }) {
  const { t } = useApp();
  return (
    <div>
      <div className="ag-grid">
        <div className="ag" data-agent="claude-code">
          <strong>Claude Code</strong>
          <Snippet labelKey="ag.cmd" text={withToken(setup.claudeCommand, token)} />
        </div>
        <div className="ag" data-agent="codex">
          <strong>Codex</strong>
          <Snippet labelKey="ag.codexEnv" text={withToken(CODEX_ENV, token)} />
          <Snippet labelKey="ag.codexFile" text={setup.codexToml} />
        </div>
      </div>
      {token === null && <p className="small muted">{t('ag.tokenPlaceholder')}</p>}
      <h3 className="h3">{t('ag.skill')}</h3>
      <p className="small muted">{t('ag.skillSub')}</p>
      <p className="small muted">{t('ag.skillPath')}</p>
    </div>
  );
}

/**
 * The token-agnostic setup guide (contract §12.1 `agent.guide`), shown as plain text: `pre.snip`
 * holds the markdown verbatim, never parsed or rendered as HTML (no `dangerouslySetInnerHTML`),
 * since nothing here needs to render arbitrary markup. Its heading belongs to the page's section,
 * so an error shows under the same heading.
 */
export function AgentGuide({ markdown }: { markdown: string }) {
  return (
    <div data-testid="agent-guide">
      <pre className="snip">{markdown}</pre>
      <CopyBtn text={markdown} />
    </div>
  );
}

/** A revoke that failed on one token row: shown inline on that row, never on the others (Task 9's `RevokeError` pattern). */
export interface TokenRevokeError {
  tokenId: Id;
  code: string;
}

/**
 * The agent token list: a label, when it was created, when it was last used (or never), and a
 * revoke button on live tokens only. `revokeError` never discards the already-loaded rows (the
 * same reasoning as `InviteList`'s): it shows inline on the one row the failed revoke happened on.
 */
export function TokenList({ tokens, onRevoke, revokeError }: { tokens: AgentTokenInfo[]; onRevoke: (tokenId: Id) => void; revokeError?: TokenRevokeError | null }) {
  const { t, fmtDateTime, errorText } = useApp();
  if (tokens.length === 0) return <p className="small muted">{t('ag.noTokens')}</p>;
  const revokeText = (code: string) => routeErrorText(t, errorText, code);
  return (
    <div className="tools" data-testid="token-list">
      {tokens.map((tok) => (
        <div className="tool" key={tok.id} data-testid="token" data-token={tok.id}>
          <span className="grow">{tok.label}</span>
          <span className="small muted">{t('ag.created', { t: fmtDateTime(tok.createdAt) })}</span>
          <span className="small muted">{tok.lastUsedAt ? t('ag.lastUsed', { t: fmtDateTime(tok.lastUsedAt) }) : t('ag.neverUsed')}</span>
          {tok.revokedAt ? (
            <span className="st tone-muted">{t('ag.revoked')}</span>
          ) : (
            <Btn testId="token-revoke" onClick={() => onRevoke(tok.id)}>
              {t('ag.revoke')}
            </Btn>
          )}
          {revokeError && revokeError.tokenId === tok.id && (
            <span className="small tone-danger" data-testid="token-revoke-error">
              {revokeText(revokeError.code)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The recent agent calls (contract §12.1, `agentCalls.list`): the calling client, the MCP tool,
 * the project and need it touched, when, and whether it succeeded. A failure shows the server's
 * own `code` as text (`ag.failed`), not `errorText`, since this is one call's own result, not a
 * failed route.
 */
export function CallList({ calls, live }: { calls: AgentCall[]; live: State }) {
  const { t, fmtDateTime } = useApp();
  if (calls.length === 0) return <p className="small muted">{t('ag.noCalls')}</p>;
  return (
    <div className="tools" data-testid="call-list">
      {calls.map((c) => {
        const project = c.projectId ? live.projects[c.projectId]?.name ?? c.projectId : null;
        // Only the parts that exist, so a call with no project never shows a leading separator.
        const where = [project, c.needCode].filter((p): p is string => p !== null).join(SEP);
        return (
          <div className="tool" key={c.id} data-testid="call" data-call={c.id}>
            <span className="small muted">{clientLabel(c)}</span>
            <span className="mono">{c.tool}</span>
            <span className="small muted grow">{where}</span>
            <span className="small muted">{fmtDateTime(c.at)}</span>
            {c.ok ? <span className="small tone-success">{t('ag.ok')}</span> : <span className="small tone-danger">{t('ag.failed', { code: c.code ?? '' })}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** A section's api error, in danger text under the section's own heading. */
function SectionError({ text }: { text: string }) {
  return (
    <p className="small tone-danger" data-testid="agents-error">
      {text}
    </p>
  );
}

/** Everything `AgentsView` shows: each api section's data (`null` while loading) or its error text. */
export interface AgentsViewProps {
  setup: AgentSetup | null;
  setupError: string | null;
  guide: string | null;
  guideError: string | null;
  tokens: AgentTokenInfo[] | null;
  tokensError: string | null;
  calls: AgentCall[] | null;
  callsError: string | null;
  revokeError: TokenRevokeError | null;
  token: string | null;
  label: string;
  busy: boolean;
  onLabel: (v: string) => void;
  onCreate: () => void;
  onRevoke: (tokenId: Id) => void;
}

/**
 * The agents page body, presentational so a static test can render every state (effects never
 * run under `renderToStaticMarkup`). Each api section has its own heading, and its error shows
 * under that heading, so the user can tell which part failed. A list still loading (`null`) shows
 * nothing, not its empty copy. The MCP tools list is always shown.
 */
export function AgentsView(p: AgentsViewProps) {
  const { t, live } = useApp();
  return (
    <div className="page" data-testid="page-agents">
      <h1>{t('nav.agents')}</h1>
      <p className="muted">{t('ag.sub')}</p>

      <section data-section="setup">
        <h3 className="h3">{t('ag.install')}</h3>
        {p.setupError ? <SectionError text={p.setupError} /> : p.setup && <SetupSnippets setup={p.setup} token={p.token} />}
      </section>

      <section data-section="guide">
        <h3 className="h3">{t('ag.guide')}</h3>
        {p.guideError ? <SectionError text={p.guideError} /> : p.guide !== null && <AgentGuide markdown={p.guide} />}
      </section>

      <section data-section="tokens">
        <h3 className="h3">{t('ag.tokens')}</h3>
        <div className="tools">
          <div className="tool">
            <input
              className="inp"
              value={p.label}
              onChange={(e) => p.onLabel(e.target.value)}
              placeholder={t('ag.tokenLabel')}
              aria-label={t('ag.tokenLabel')}
              data-testid="token-label"
            />
            <Btn kind="primary" testId="token-create" disabled={p.busy || !p.label.trim()} onClick={p.onCreate}>
              {t('ag.newToken')}
            </Btn>
          </div>
        </div>
        {p.token && (
          <p className="row gap6" data-testid="token-once">
            <span className="mono">{p.token}</span>
            <span className="small muted grow">{t('ag.tokenOnce')}</span>
          </p>
        )}
        {p.tokensError ? <SectionError text={p.tokensError} /> : p.tokens && <TokenList tokens={p.tokens} onRevoke={p.onRevoke} revokeError={p.revokeError} />}
      </section>

      <section data-section="tools">
        <h3 className="h3">{t('ag.tools')}</h3>
        <div className="tools">
          {MCP_TOOLS.map((tool) => (
            <div className="tool" key={tool} data-testid="tool" data-tool={tool}>
              <span className="mono">{tool}</span>
              <span className="small muted grow">{t(`t.${tool}` as MessageKey)}</span>
              {MCP_WRITE_TOOLS.has(tool) && <span className="small tone-neutral">{t('ag.write')}</span>}
            </div>
          ))}
        </div>
      </section>

      <section data-section="calls">
        <h3 className="h3">{t('ag.log')}</h3>
        {p.callsError ? <SectionError text={p.callsError} /> : p.calls && <CallList calls={p.calls} live={live} />}
      </section>
    </div>
  );
}

/**
 * The agents page (contract §8, design §8.9; ports `needs/agent.jsx`'s `Agents`): the install
 * snippets and setup guide from S's own routes, an access-token form, the token list, the full
 * MCP tools list (always shown, even while every api section above is still erroring), and the
 * recent calls log. Each api section shows its error under its own heading when its route fails
 * (`agentSetup.get`, `agent.guide`, `tokens.list`, `agentCalls.list` are all S routes): `HTTP_404`
 * reads `pj.unsupported` (ruling R22), any other code `errorText(code)`. A section error never
 * blanks the rest of the page. The created token is held only in this component's state (never
 * written to storage or logged), shown once in `token-once`, and used to fill the snippets above
 * until the page unmounts or reloads.
 */
export function AgentsPage(_props: PageProps) {
  const { t, api, errorText } = useApp();
  const [setup, setSetup] = useState<AgentSetup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [guide, setGuide] = useState<string | null>(null);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<AgentTokenInfo[] | null>(null);
  const [tokensError, setTokensError] = useState<string | null>(null);
  const [calls, setCalls] = useState<AgentCall[] | null>(null);
  const [callsError, setCallsError] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<TokenRevokeError | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const failText = (code: string) => routeErrorText(t, errorText, code);

  useEffect(() => {
    let alive = true;
    void api('agentSetup.get', {}).then((r) => {
      if (!alive) return;
      if (r.ok) setSetup(r.data);
      else setSetupError(failText(r.code));
    });
    void api('agent.guide', {}).then((r) => {
      if (!alive) return;
      if (r.ok) setGuide(r.data.markdown);
      else setGuideError(failText(r.code));
    });
    void api('tokens.list', {}).then((r) => {
      if (!alive) return;
      if (r.ok) setTokens(r.data.tokens);
      else setTokensError(failText(r.code));
    });
    void api('agentCalls.list', { limit: 20 }).then((r) => {
      if (!alive) return;
      if (r.ok) setCalls(r.data.calls);
      else setCallsError(failText(r.code));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createToken = async () => {
    if (busy || !label.trim()) return;
    setBusy(true);
    const r = await api('tokens.create', { label: label.trim() });
    setBusy(false);
    if (r.ok) {
      setToken(r.data.token);
      setTokens((cur) => [r.data.info, ...(cur ?? [])]);
      setLabel('');
      setTokensError(tokenSectionErrorAfterCreate({ ok: true }));
    } else {
      setTokensError(tokenSectionErrorAfterCreate({ ok: false, error: failText(r.code) }));
    }
  };

  const revoke = async (tokenId: Id) => {
    setRevokeError(null);
    const r = await api('tokens.revoke', { tokenId });
    if (r.ok) setTokens((cur) => (cur ?? []).map((x) => (x.id === tokenId ? { ...x, revokedAt: new Date().toISOString() } : x)));
    else setRevokeError({ tokenId, code: r.code });
  };

  return (
    <AgentsView
      setup={setup}
      setupError={setupError}
      guide={guide}
      guideError={guideError}
      tokens={tokens}
      tokensError={tokensError}
      calls={calls}
      callsError={callsError}
      revokeError={revokeError}
      token={token}
      label={label}
      busy={busy}
      onLabel={setLabel}
      onCreate={() => void createToken()}
      onRevoke={(id) => void revoke(id)}
    />
  );
}
