import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import type { CaptureStatus, CommitInfo } from '@meetless/client/bridge';
import { noDots, type Artifact, type Id } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { hasCapability } from '@/bridge';
import { Button, Text, TextField } from '@/components/ui';
import { useApp } from '@/state';
import { space } from '@/theme';
import { Row } from '../../inputs/ui/common';
import { sourceRow } from '../model';
import { capErrorText, commitsFetchKey, createCaptureRunner, createNotionConnector, createNotionReader, createOverleafSyncer, type NotionRead } from '../model/capture';

/** Skip reasons the panel already says in its own row (no repo bound, no token, Notion not authorised). */
const SAID_BY_PANEL: Record<string, string> = { no_repo: 'repo', no_token: 'overleaf', notion_not_connected: 'notion' };

/** The capture button for a project or one artifact. Only in the desktop app (local capture). */
export function CaptureButton({ projectId, artifactIds, testID }: { projectId: Id; artifactIds?: Id[]; testID: string }) {
  const { bridge, t, errorText, notify } = useApp();
  const [running, setRunning] = useState(false);
  const runner = useMemo(() => createCaptureRunner({ bridge, t, errorText, notify }, projectId, setRunning), [bridge, t, errorText, notify, projectId]);
  if (!hasCapability('localGit')) return null;
  return <Button testID={testID} label={running ? t('cap.running') : t('cap.btn')} size="sm" disabled={running} onPress={() => void runner.run(artifactIds ? { artifactIds } : undefined)} />;
}

function CommitLog({ commits }: { commits: CommitInfo[] }) {
  const { t } = useApp();
  if (commits.length === 0) return null;
  return (
    <View style={{ gap: 2 }}>
      <Text size="xs" color="textSecondary">
        {t('af.commits')}
      </Text>
      {commits.map((c) => (
        <Text key={c.commit} size="xs" numberOfLines={1} testID="af-commit">
          <Text size="xs" mono color="textTertiary">
            {c.commit.slice(0, 7)}
          </Text>
          {`  ${noDots(c.subject)}`}
        </Text>
      ))}
    </View>
  );
}

/**
 * One artifact's capture source (renderer SourcePanel): bind a local repo and see its commits, an
 * Overleaf token and sync, Notion authorisation and a live read, or the upload note. Each control
 * shows only when the host has its capability; on the web and iOS it says to use the desktop app.
 */
export function SourcePanel({ artifact }: { artifact: Artifact }) {
  const { bridge, t, fmtDateTime } = useApp();
  const caps = { git: hasCapability('localGit'), ol: hasCapability('overleafGit'), notion: hasCapability('notionMcp') };
  const any = caps.git || caps.ol || caps.notion;
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((x) => x + 1), []);
  const [token, setToken] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!any) return undefined;
    let cancelled = false;
    void bridge.captureStatus(artifact.projectId).then((r) => {
      if (!cancelled && r.ok) setStatus(r.status);
    });
    return () => {
      cancelled = true;
    };
  }, [any, bridge, artifact.projectId, tick]);

  const source = status?.sources.find((s) => s.artifactId === artifact.id);
  const repoId = source?.repo?.id ?? null;
  const key = commitsFetchKey(source);
  useEffect(() => {
    if (!repoId || !(caps.git || caps.ol)) {
      setCommits([]);
      return undefined;
    }
    let cancelled = false;
    void bridge.repoLog(repoId, 'HEAD', 20).then((r) => {
      if (!cancelled) setCommits(r.ok ? r.commits : []);
    });
    return () => {
      cancelled = true;
    };
    // `key` carries the repo plus its sync and capture times.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, key]);

  const syncer = useMemo(() => createOverleafSyncer(bridge, artifact.id, refresh, setSyncing), [bridge, artifact.id, refresh]);
  const connector = useMemo(() => createNotionConnector(bridge, artifact.projectId, (u) => void Linking.openURL(u), refresh, setWaiting), [bridge, artifact.projectId, refresh]);
  useEffect(() => () => connector.destroy(), [connector]);

  const row = sourceRow(artifact, status);
  const supported = row.kind === 'upload' || (row.kind === 'repo' && caps.git) || (row.kind === 'overleaf' && caps.ol) || (row.kind === 'notion' && caps.notion);

  if (!supported) {
    return (
      <View testID="af-source" style={{ gap: space[1] }}>
        <Text size="sm" color="textSecondary">
          {row.kind === 'upload' ? t('af.uploadSource') : t('web.desktopOnly')}
        </Text>
      </View>
    );
  }

  return (
    <View testID="af-source" style={{ gap: space[2] }}>
      {row.kind === 'repo' ? (
        <>
          <Text size="xs" color="textSecondary">
            {t('af.repo')}
          </Text>
          <Row wrap>
            <Text size="sm" style={{ flex: 1 }}>
              {row.repoName ? noDots(row.repoName) : t('af.noRepo')}
            </Text>
            {row.repoName ? (
              <Button testID="af-unbind" label={t('af.unbind')} size="sm" onPress={() => void bridge.captureBindRepo(artifact.id, null).then(refresh)} />
            ) : hasCapability('pickDirectory') ? (
              <Button
                testID="af-pick-repo"
                label={t('af.pickRepo')}
                size="sm"
                onPress={() =>
                  void bridge.pickRepo().then(async (r) => {
                    if (r.ok) {
                      await bridge.captureBindRepo(artifact.id, r.repo.id);
                      refresh();
                    }
                  })
                }
              />
            ) : null}
          </Row>
          <CommitLog commits={commits} />
        </>
      ) : null}

      {row.kind === 'overleaf' ? (
        <>
          <Text size="xs" color="textSecondary">
            {t('af.olToken')}
          </Text>
          <Text size="xs" mono>
            {artifact.url ? noDots(artifact.url) : t('af.noRepo')}
          </Text>
          {status?.overleafToken ? (
            <Row wrap>
              <Text size="sm" style={{ flex: 1 }}>
                {t('af.olTokenSaved')}
              </Text>
              <Button testID="af-ol-clear" label={t('af.olTokenClear')} size="sm" onPress={() => void bridge.overleafSetToken(null).then(refresh)} />
            </Row>
          ) : (
            <Row>
              <View style={{ flex: 1 }}>
                <TextField testID="af-ol-token" value={token} onChangeText={setToken} placeholder={t('af.olTokenPh')} autoCapitalize="none" />
              </View>
              <Button
                testID="af-ol-save"
                label={t('common.save')}
                size="sm"
                disabled={!token.trim()}
                onPress={() => {
                  void bridge.overleafSetToken(token).then(refresh);
                  setToken('');
                }}
              />
            </Row>
          )}
          <Row wrap>
            <Button testID="af-ol-sync" label={syncing ? t('af.olSyncing') : t('af.olSync')} size="sm" disabled={syncing} onPress={() => void syncer.sync()} />
            {row.syncedAt ? (
              <Text size="xs" color="textTertiary">
                {t('af.olSynced', { t: fmtDateTime(row.syncedAt) })}
              </Text>
            ) : null}
          </Row>
          <CommitLog commits={commits} />
        </>
      ) : null}

      {row.kind === 'notion' ? (
        status?.notion === 'connected' ? (
          <>
            <Row wrap>
              <Text size="sm" style={{ flex: 1 }}>
                {t('af.notionConnected')}
              </Text>
              <Button testID="af-notion-disconnect" label={t('af.notionDisconnect')} size="sm" onPress={() => void bridge.notionDisconnect().then(refresh)} />
            </Row>
            <NotionView artifactId={artifact.id} onFailed={refresh} />
          </>
        ) : (
          <>
            <Text size="sm" color="warning">
              {t('af.notionNeedAuth')}
            </Text>
            <Button testID="af-notion-connect" label={t('af.notionConnect')} size="sm" onPress={() => connector.connect()} style={{ alignSelf: 'flex-start' }} />
            {waiting ? (
              <Text size="xs" color="textTertiary">
                {t('af.notionWaiting')}
              </Text>
            ) : null}
          </>
        )
      ) : null}

      {row.kind === 'upload' ? <Text size="sm">{t('af.uploadSource')}</Text> : null}

      {row.code && SAID_BY_PANEL[row.code] !== row.kind ? (
        <Text size="sm" color="warning">
          {t(`cap.err.${row.code}` as MessageKey)}
        </Text>
      ) : null}
      {row.lastRunAt ? (
        <Text size="xs" color="textTertiary">
          {t('cap.lastRun', { t: fmtDateTime(row.lastRunAt) })}
        </Text>
      ) : null}
      {caps.git ? (
        <>
          <Text size="xs" color="textTertiary">
            {t('cap.tip')}
          </Text>
          <CaptureButton projectId={artifact.projectId} artifactIds={[artifact.id]} testID="cap-run" />
        </>
      ) : null}
    </View>
  );
}

function NotionView({ artifactId, onFailed }: { artifactId: Id; onFailed: () => void }) {
  const { bridge, t, errorText } = useApp();
  const [read, setRead] = useState<NotionRead>({ phase: 'idle' });
  const reader = useMemo(() => createNotionReader(bridge, artifactId, setRead, onFailed), [bridge, artifactId, onFailed]);
  useEffect(() => () => reader.destroy(), [reader]);
  return (
    <View style={{ gap: space[2] }}>
      <Button testID="af-notion-read" label={read.phase === 'reading' ? t('af.notionReading') : t('af.notionRead')} size="sm" disabled={read.phase === 'reading'} onPress={() => void reader.read()} style={{ alignSelf: 'flex-start' }} />
      {read.phase === 'error' ? (
        <Text size="sm" color="warning">
          {capErrorText(t, errorText, read.code)}
        </Text>
      ) : null}
      {read.phase === 'ready'
        ? read.paragraphs.map((p, i) => (
            <Text key={i} size="sm">
              {noDots(p)}
            </Text>
          ))
        : null}
    </View>
  );
}
