import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { MCP_TOOLS, MCP_WRITE_TOOLS, type AgentCall, type AgentTokenInfo, type ApiResponse } from '@meetless/api';
import { SEP, type Id } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { CODEX_ENV, clientLabel, routeErrorText, tokenSectionErrorAfterCreate, withToken } from '@renderer/setup/model';
import { Button, Card, Screen, Text, TextField } from '@/components/ui';
import { useApp } from '@/state';
import { colors, radius, space, useLayout } from '@/theme';
import { Row, SectionLabel } from '../../inputs/ui/common';

type AgentSetup = ApiResponse<'agentSetup.get'>;

/** Agent 接入: install commands, the setup guide, access tokens, the MCP tools and recent calls (renderer setup/AgentsPage). */
export function AgentsScreen() {
  const { t, api, errorText } = useApp();
  const { phone } = useLayout();
  const [setup, setSetup] = useState<AgentSetup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [guide, setGuide] = useState<string | null>(null);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<AgentTokenInfo[] | null>(null);
  const [tokensError, setTokensError] = useState<string | null>(null);
  const [calls, setCalls] = useState<AgentCall[] | null>(null);
  const [callsError, setCallsError] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<{ tokenId: Id; code: string } | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const failText = (code: string) => routeErrorText(t, errorText, code);

  useEffect(() => {
    let alive = true;
    void api('agentSetup.get', {}).then((r) => alive && (r.ok ? setSetup(r.data) : setSetupError(failText(r.code))));
    void api('agent.guide', {}).then((r) => alive && (r.ok ? setGuide(r.data.markdown) : setGuideError(failText(r.code))));
    void api('tokens.list', {}).then((r) => alive && (r.ok ? setTokens(r.data.tokens) : setTokensError(failText(r.code))));
    void api('agentCalls.list', { limit: 20 }).then((r) => alive && (r.ok ? setCalls(r.data.calls) : setCallsError(failText(r.code))));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    if (busy || !label.trim()) return;
    setBusy(true);
    const r = await api('tokens.create', { label: label.trim() });
    setBusy(false);
    if (r.ok) {
      setToken(r.data.token);
      setTokens((cur) => [r.data.info, ...(cur ?? [])]);
      setLabel('');
      setTokensError(tokenSectionErrorAfterCreate({ ok: true }));
    } else setTokensError(tokenSectionErrorAfterCreate({ ok: false, error: failText(r.code) }));
  };
  const revoke = async (tokenId: Id) => {
    setRevokeError(null);
    const r = await api('tokens.revoke', { tokenId });
    if (r.ok) setTokens((cur) => (cur ?? []).map((x) => (x.id === tokenId ? { ...x, revokedAt: new Date().toISOString() } : x)));
    else setRevokeError({ tokenId, code: r.code });
  };

  return (
    <Screen title={t('nav.agents')}>
      <View style={{ gap: space[3] }} testID="page-agents">
        <Text color="textSecondary">{t('ag.sub')}</Text>

        <SectionLabel>{t('ag.install')}</SectionLabel>
        {setupError ? (
          <Err text={setupError} />
        ) : setup ? (
          <>
            <View style={[{ gap: space[3] }, !phone && { flexDirection: 'row' }]}>
              <Card style={{ flex: 1 }} testID="agent-claude-code">
                <Text weight="semibold">Claude Code</Text>
                <Snippet label={t('ag.cmd')} text={withToken(setup.claudeCommand, token)} />
              </Card>
              <Card style={{ flex: 1 }} testID="agent-codex">
                <Text weight="semibold">Codex</Text>
                <Snippet label={t('ag.codexEnv')} text={withToken(CODEX_ENV, token)} />
                <Snippet label={t('ag.codexFile')} text={setup.codexToml} />
              </Card>
            </View>
            {token === null ? (
              <Text size="sm" color="textSecondary">
                {t('ag.tokenPlaceholder')}
              </Text>
            ) : null}
            <Text weight="medium">{t('ag.skill')}</Text>
            <Text size="sm" color="textSecondary">
              {t('ag.skillSub')}
            </Text>
            <Text size="sm" color="textSecondary">
              {t('ag.skillPath')}
            </Text>
          </>
        ) : null}

        <SectionLabel>{t('ag.tokens')}</SectionLabel>
        <Row>
          <View style={{ flex: 1 }}>
            <TextField testID="token-label" value={label} onChangeText={setLabel} placeholder={t('ag.tokenLabel')} accessibilityLabel={t('ag.tokenLabel')} />
          </View>
          <Button testID="token-create" label={t('ag.newToken')} variant="primary" busy={busy} disabled={!label.trim()} onPress={() => void create()} />
        </Row>
        {token ? (
          <Card testID="token-once" style={{ backgroundColor: colors.warningBg, borderColor: colors.warningBg }}>
            <Text mono selectable>
              {token}
            </Text>
            <Row wrap>
              <Text size="sm" color="textSecondary" style={{ flex: 1 }}>
                {t('ag.tokenOnce')}
              </Text>
              <CopyBtn text={token} />
            </Row>
          </Card>
        ) : null}
        {tokensError ? (
          <Err text={tokensError} />
        ) : tokens ? (
          tokens.length === 0 ? (
            <Text size="sm" color="textSecondary">
              {t('ag.noTokens')}
            </Text>
          ) : (
            tokens.map((tok) => <TokenRow key={tok.id} tok={tok} onRevoke={() => void revoke(tok.id)} error={revokeError?.tokenId === tok.id ? failText(revokeError.code) : null} />)
          )
        ) : null}

        <SectionLabel>{t('ag.guide')}</SectionLabel>
        {guideError ? <Err text={guideError} /> : guide !== null ? <Snippet text={guide} /> : null}

        <SectionLabel>{t('ag.tools')}</SectionLabel>
        <Card dense>
          {MCP_TOOLS.map((tool) => (
            <Row key={tool} wrap>
              <Text size="sm" mono>
                {tool}
              </Text>
              <Text size="sm" color="textSecondary" style={{ flex: 1 }}>
                {t(`t.${tool}` as MessageKey)}
              </Text>
              {MCP_WRITE_TOOLS.has(tool) ? (
                <Text size="xs" color="textSecondary">
                  {t('ag.write')}
                </Text>
              ) : null}
            </Row>
          ))}
        </Card>

        <SectionLabel>{t('ag.log')}</SectionLabel>
        {callsError ? <Err text={callsError} /> : calls ? calls.length === 0 ? <Text size="sm" color="textSecondary">{t('ag.noCalls')}</Text> : calls.map((c) => <CallRow key={c.id} c={c} />) : null}
      </View>
    </Screen>
  );
}

function Err({ text }: { text: string }) {
  return (
    <Text size="sm" color="danger" testID="agents-error">
      {text}
    </Text>
  );
}

function CopyBtn({ text }: { text: string }) {
  const { t } = useApp();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const copy = () => {
    void Clipboard.setStringAsync(text).catch(() => undefined);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  };
  return <Button testID="snippet-copy" label={t(copied ? 'ag.copied' : 'ag.copy')} size="sm" onPress={copy} />;
}

function Snippet({ label, text }: { label?: string; text: string }) {
  return (
    <View style={{ gap: space[1] }}>
      <Row>
        <Text size="xs" color="textSecondary" style={{ flex: 1 }}>
          {label ?? ''}
        </Text>
        <CopyBtn text={text} />
      </Row>
      <View style={st.snip}>
        <Text size="xs" mono selectable>
          {text}
        </Text>
      </View>
    </View>
  );
}

function TokenRow({ tok, onRevoke, error }: { tok: AgentTokenInfo; onRevoke: () => void; error: string | null }) {
  const { t, fmtDateTime } = useApp();
  return (
    <Card dense testID="token">
      <Row wrap>
        <Text weight="medium" style={{ flex: 1 }}>
          {tok.label}
        </Text>
        {tok.revokedAt ? (
          <Text size="xs" color="textTertiary">
            {t('ag.revoked')}
          </Text>
        ) : (
          <Button testID="token-revoke" label={t('ag.revoke')} size="sm" onPress={onRevoke} />
        )}
      </Row>
      <Row wrap>
        <Text size="xs" color="textSecondary">
          {t('ag.created', { t: fmtDateTime(tok.createdAt) })}
        </Text>
        <Text size="xs" color="textSecondary">
          {tok.lastUsedAt ? t('ag.lastUsed', { t: fmtDateTime(tok.lastUsedAt) }) : t('ag.neverUsed')}
        </Text>
      </Row>
      {error ? (
        <Text size="xs" color="danger">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}

function CallRow({ c }: { c: AgentCall }) {
  const { live, t, fmtDateTime } = useApp();
  const project = c.projectId ? (live.projects[c.projectId]?.name ?? c.projectId) : null;
  const where = [project, c.needCode].filter((p): p is string => p !== null).join(SEP);
  return (
    <Card dense testID="call">
      <Row wrap>
        <Text size="xs" color="textSecondary">
          {clientLabel(c)}
        </Text>
        <Text size="sm" mono>
          {c.tool}
        </Text>
        <View style={{ flex: 1 }} />
        {c.ok ? (
          <Text size="xs" color="success">
            {t('ag.ok')}
          </Text>
        ) : (
          <Text size="xs" color="danger">
            {t('ag.failed', { code: c.code ?? '' })}
          </Text>
        )}
      </Row>
      <Text size="xs" color="textTertiary">
        {[where, fmtDateTime(c.at)].filter(Boolean).join(SEP)}
      </Text>
    </Card>
  );
}

const st = StyleSheet.create({
  snip: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space[3] },
});
