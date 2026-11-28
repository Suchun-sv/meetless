import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { Artifact, ArtifactVersion } from '@meetless/core';
import { Button, Text } from '@/components/ui';
import { useApp } from '@/state';
import { colors, radius, space, useLayout } from '@/theme';
import { Row } from '../../inputs/ui/common';
import { saveBytes } from '../../inputs/ui/files';
import { dataUri, fallbackView, officeStep, originalFileName, pageCards, viewerMode, type OfficeEvent, type OfficeState, type PageCard } from '../model';
import { OfficeFrame } from './OfficeFrame';
import { SourcePanel } from './SourcePanel';

const CONFIG: OfficeState = { phase: 'config' };

/** The centre viewer: OnlyOffice for files, LibreOffice pages when it is unavailable, else the source or the note. */
export function ArtifactViewer({ artifact, version, page, height }: { artifact: Artifact; version: ArtifactVersion | null; page?: number; height: number }) {
  const { t } = useApp();
  const mode = viewerMode(artifact, version);
  if (mode === 'source') return <SourceNote artifact={artifact} />;
  if (mode === 'none' || !version)
    return (
      <Text color="textSecondary" testID="af-viewer">
        {t('af.noVersions')}
      </Text>
    );
  if (mode === 'office') return <OfficeViewer key={version.id} artifact={artifact} version={version} page={page} height={height} />;
  return (
    <View testID="af-viewer" style={{ gap: space[1] }}>
      <Text mono>{version.label}</Text>
      <Text size="sm">{version.note}</Text>
    </View>
  );
}

/** Code, Notion, and Overleaf without a file read from their capture source (desktop controls). */
function SourceNote({ artifact }: { artifact: Artifact }) {
  const { t } = useApp();
  return (
    <View testID="af-viewer" style={{ gap: space[2] }}>
      <Text weight="semibold">{t('af.source')}</Text>
      <SourcePanel artifact={artifact} />
    </View>
  );
}

function OfficeViewer({ artifact, version, page, height }: { artifact: Artifact; version: ArtifactVersion; page?: number; height: number }) {
  const { api, t, tr, locale, bridge, notify, errorText, snapshot } = useApp();
  const { phone } = useLayout();
  const [state, dispatch] = useReducer(officeStep, CONFIG);
  const onEvent = useCallback((e: OfficeEvent) => dispatch(e), []);
  const apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    let cancelled = false;
    void apiRef.current('office.config', { projectId: artifact.projectId, artifactId: artifact.id, versionId: version.id }).then((result) => {
      if (!cancelled) dispatch({ type: 'config', result });
    });
    return () => {
      cancelled = true;
    };
  }, [artifact.projectId, artifact.id, version.id]);

  const download = async () => {
    if (!version.blobHash) return;
    const r = await bridge.readBlob(version.blobHash);
    if (!r.ok) return notify('error', errorText(r.code));
    await saveBytes(r.bytes, originalFileName(artifact, version), version.mediaType ?? 'application/octet-stream');
  };

  if (state.phase === 'config') {
    return (
      <Text size="sm" color="textSecondary" testID="af-office-loading">
        {t('af.loadingViewer')}
      </Text>
    );
  }
  if (state.phase === 'fallback') {
    const f = fallbackView(state, artifact, version);
    const original = f.hasFile ? <Button testID="af-original" label={t('af.original')} size="sm" onPress={() => void download()} /> : null;
    return (
      <View testID="af-fallback" style={{ gap: space[3] }}>
        <Text size="sm" color="warning">
          {t('af.fallbackReason', { reason: tr.tDynamic(f.reasonKey) })}
        </Text>
        {f.isPdf ? (
          f.hasFile ? (
            <Row wrap>
              <Text size="sm">{t('af.pdfFallback')}</Text>
              {original}
            </Row>
          ) : null
        ) : (
          <>
            {f.hasFile ? (
              <Row wrap>
                {f.pages === 'pages' ? <Text size="sm">{t('af.fallbackPages')}</Text> : null}
                <View style={{ flex: 1 }} />
                {original}
              </Row>
            ) : null}
            {f.pages === 'pending' ? (
              <Text size="sm" color="textSecondary">
                {t('af.previewPending')}
              </Text>
            ) : null}
            {f.pages === 'failed' ? (
              <Text size="sm" color="textSecondary">
                {t('af.previewFailed')}
              </Text>
            ) : null}
            {f.pages === 'pages' && f.derived ? (
              <>
                {pageCards(artifact.kind, f.derived, page).map((c) => (
                  <PageImage key={c.index} c={c} />
                ))}
                <Text size="xs" color="textTertiary">
                  {t('af.previewBy', { engine: f.derived.converter ?? 'LibreOffice' })}
                </Text>
              </>
            ) : null}
          </>
        )}
      </View>
    );
  }
  return (
    <View style={{ gap: space[2] }} testID="af-viewer">
      <Row>
        <Text size="sm" weight="medium">
          {t('af.viewer')}
        </Text>
        <Text size="xs" color="textTertiary">
          {t('af.readonly')}
        </Text>
        <View style={{ flex: 1 }} />
        {state.phase === 'ready' && page != null ? (
          <Text size="xs" color="textTertiary">
            {t('af.pageHint', { n: page + 1 })}
          </Text>
        ) : null}
      </Row>
      {state.phase === 'loading' ? (
        <Text size="sm" color="textSecondary">
          {t('af.loadingViewer')}
        </Text>
      ) : null}
      <View style={[st.frame, { height }]}>
        <OfficeFrame documentServerUrl={state.documentServerUrl} config={state.config} locale={locale} mobile={phone} baseUrl={snapshot.session?.serverUrl ?? null} onEvent={onEvent} />
      </View>
    </View>
  );
}

/** One LibreOffice page image, read through the bridge as a data URI, sized to its own aspect. */
function PageImage({ c }: { c: PageCard }) {
  const { bridge, t } = useApp();
  const [uri, setUri] = useState<string | null>(null);
  const [ratio, setRatio] = useState(c.slide ? 16 / 9 : 1 / Math.SQRT2);
  useEffect(() => {
    let alive = true;
    void bridge.readBlob(c.hash).then((r) => {
      if (alive && r.ok) setUri(dataUri(r.bytes, 'image/png'));
    });
    return () => {
      alive = false;
    };
  }, [bridge, c.hash]);
  return (
    <View style={[st.page, c.on && st.pageOn]} testID="af-page">
      {uri ? (
        <Image
          source={{ uri }}
          resizeMode="contain"
          onLoad={(e) => {
            const s = e.nativeEvent.source as { width?: number; height?: number } | undefined;
            if (s?.width && s.height) setRatio(s.width / s.height);
          }}
          style={{ width: '100%', aspectRatio: ratio, backgroundColor: colors.bg }}
        />
      ) : (
        <View style={{ width: '100%', aspectRatio: ratio, backgroundColor: colors.surface }} />
      )}
      {c.text ? (
        <Text size="xs" color="textSecondary" numberOfLines={4}>
          {c.text}
        </Text>
      ) : null}
      <Text size="xs" color="textTertiary">
        {t('af.page', { n: c.index + 1 })}
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  frame: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.bg },
  page: { gap: space[1], padding: space[2], borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg },
  pageOn: { borderColor: colors.warning, backgroundColor: colors.warningBg },
});
