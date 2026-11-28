import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { shareableView, type Artifact, type ArtifactVersion, type Id } from '@meetless/core';
import { Button, Card, Text } from '@/components/ui';
import { useHeaderActions } from '@/shell/chrome';
import { useApp, useGo, useProjectId } from '@/state';
import { colors, space, useLayout } from '@/theme';
import { shareArtifact } from '../../privacy/model';
import { KindTag, MutedTag, NeedChip, panesFor, Row, SectionLabel, useContainerWidth } from '../../inputs/ui/common';
import { agentPrompt, artifactHeader, artifactRows, copyAgentPrompt, selectedArtifact, selectedVersion, usesSource, versionRows } from '../model';
import { ArtifactsPhone } from './ArtifactsPhone';
import { LinkNeedsSheet, NewArtifactSheet, NewVersionSheet } from './Sheets';
import { SourcePanel } from './SourcePanel';
import { ArtifactViewer } from './Viewer';

type SheetKind = 'new' | 'version' | 'link' | null;

/** 产物: list, viewer (OnlyOffice or LibreOffice pages), versions, linked needs and sharing. */
export function ArtifactsScreen({ artifactId, versionId, page }: { artifactId?: string; versionId?: string; page?: number }) {
  const { live, t } = useApp();
  const projectId = useProjectId();
  const go = useGo();
  const { height, phone } = useLayout();
  const [w, onLayout] = useContainerWidth();
  const panes = panesFor(w);
  const [sheet, setSheet] = useState<SheetKind>(null);
  useHeaderActions(phone && !artifactId ? [{ icon: 'plus', label: t('af.new'), testID: 'af-new', onPress: () => setSheet('new') }] : []);

  const a = selectedArtifact(live, projectId, artifactId ?? null);
  const v = a ? selectedVersion(a, versionId ?? null) : null;
  const open = (id: Id) => go({ view: 'artifacts', projectId, focusId: id });
  const openVersion = (vid: Id) => a && go({ view: 'artifacts', projectId, focusId: a.id, versionId: vid }, { replace: true });
  const frameH = Math.max(360, height - 220);

  const list = <ArtifactList projectId={projectId} selectedId={panes > 1 ? (a?.id ?? null) : null} onSelect={open} onNew={() => setSheet('new')} />;
  const main = a ? (
    <>
      <ArtifactHead artifact={a} />
      <ArtifactViewer artifact={a} version={v} page={page} height={frameH} />
    </>
  ) : (
    <Text color="textSecondary">{t('af.empty')}</Text>
  );
  const side = a ? <ArtifactSide artifact={a} version={v} onVersion={openVersion} onAdd={() => setSheet('version')} onLink={() => setSheet('link')} /> : null;

  let body = null;
  if (w > 0 && phone && !artifactId) body = <ArtifactsPhone projectId={projectId} onNew={() => setSheet('new')} />;
  else if (w > 0 && panes === 1 && !artifactId) body = <ScrollView contentContainerStyle={st.pad}>{list}</ScrollView>;
  else if (w > 0 && panes === 1)
    body = (
      <ScrollView contentContainerStyle={st.pad}>
        <Button label={t('web.back')} variant="link" size="sm" onPress={() => go({ view: 'artifacts', projectId })} style={{ alignSelf: 'flex-start' }} />
        {main}
        {side}
      </ScrollView>
    );
  else if (w > 0)
    body = (
      <View style={st.row}>
        <ScrollView style={st.left} contentContainerStyle={st.pad}>
          {list}
        </ScrollView>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={st.pad}>
          {main}
          {panes === 2 ? side : null}
        </ScrollView>
        {panes === 3 && side ? (
          <ScrollView style={st.right} contentContainerStyle={st.pad}>
            {side}
          </ScrollView>
        ) : null}
      </View>
    );

  return (
    <View style={st.root} onLayout={onLayout} testID="page-artifacts">
      {body}
      <NewArtifactSheet open={sheet === 'new'} projectId={projectId} onClose={() => setSheet(null)} onCreated={open} />
      {a ? <NewVersionSheet key={`v-${a.id}`} open={sheet === 'version'} artifact={a} onClose={() => setSheet(null)} /> : null}
      {a && sheet === 'link' ? <LinkNeedsSheet open artifact={a} onClose={() => setSheet(null)} /> : null}
    </View>
  );
}

function ArtifactList({ projectId, selectedId, onSelect, onNew }: { projectId: Id; selectedId: Id | null; onSelect: (id: Id) => void; onNew: () => void }) {
  const { live, me, t, fmtDay } = useApp();
  const rows = artifactRows(live, me, projectId, selectedId, fmtDay);
  return (
    <View style={{ gap: space[3] }}>
      <Row>
        <Button testID="af-new" label={t('af.new')} variant="primary" size="sm" onPress={onNew} />
      </Row>
      {rows.length === 0 ? (
        <Text size="sm" color="textSecondary">
          {t('af.empty')}
        </Text>
      ) : (
        rows.map((r) => (
          <Card key={r.id} dense selected={r.selected} onPress={() => onSelect(r.id)} testID="af-item">
            <Row>
              <KindTag kind={r.kind} />
              <Text size="sm" weight="medium" numberOfLines={2} style={{ flex: 1 }}>
                {r.title}
              </Text>
            </Row>
            <Row wrap>
              <Text size="xs" color="textSecondary">
                {r.fact}
              </Text>
              {r.mine ? <MutedTag label={t('pv.mine')} /> : null}
            </Row>
          </Card>
        ))
      )}
    </View>
  );
}

function ArtifactHead({ artifact }: { artifact: Artifact }) {
  const { live, me, t, submit, notify } = useApp();
  const h = artifactHeader(live, me, artifact);
  const copy = () => {
    const pub = shareableView(live).artifacts[artifact.id];
    if (pub) void copyAgentPrompt((text) => Clipboard.setStringAsync(text).then(() => undefined), agentPrompt(t, artifact.projectId, pub), notify, t);
  };
  return (
    <View style={{ gap: space[2] }}>
      <Row wrap>
        <KindTag kind={artifact.kind} />
        <Text size="lg" weight="semibold" tight style={{ flexShrink: 1 }}>
          {h.title}
        </Text>
        {h.mine ? <MutedTag label={t('pv.mine')} /> : null}
      </Row>
      <Row wrap>
        {h.canCopy ? <Button testID="af-copy" label={t('af.copyAgent')} size="sm" onPress={copy} /> : null}
        {h.openUrl ? <Button testID="af-open" label={t('af.open', { w: h.where })} size="sm" onPress={() => void Linking.openURL(h.openUrl!)} /> : null}
        {h.share === 'ok' ? <Button testID="af-share" label={t('pv.publish')} size="sm" onPress={() => void shareArtifact(submit, live, me, artifact)} /> : null}
        {h.share === 'links_private' ? (
          <Text size="xs" color="warning">
            {t('af.shareBlocked')}
          </Text>
        ) : null}
      </Row>
    </View>
  );
}

function ArtifactSide({ artifact, version, onVersion, onAdd, onLink }: { artifact: Artifact; version: ArtifactVersion | null; onVersion: (id: Id) => void; onAdd: () => void; onLink: () => void }) {
  const { live, t, fmtDay } = useApp();
  const versions = versionRows(t, fmtDay, live, artifact, version?.id ?? null);
  return (
    <View style={{ gap: space[2] }}>
      {version?.note ? (
        <>
          <SectionLabel>{t('af.changes')}</SectionLabel>
          <Text size="sm">{version.note}</Text>
        </>
      ) : null}
      {!usesSource(artifact, version) ? (
        <>
          <SectionLabel>{t('af.source')}</SectionLabel>
          <SourcePanel artifact={artifact} />
        </>
      ) : null}
      <SectionLabel right={<Button testID="af-link" label={t('af.link')} size="sm" variant="ghost" onPress={onLink} />}>{t('af.needs')}</SectionLabel>
      {artifact.needIds.length === 0 ? (
        <Text size="sm" color="textSecondary">
          {t('af.needsNone')}
        </Text>
      ) : (
        artifact.needIds.map((id) => <NeedChip key={id} projectId={artifact.projectId} needId={id} />)
      )}
      <SectionLabel right={<Button testID="af-add-version" label={t('af.addVersion')} size="sm" variant="ghost" onPress={onAdd} />}>{t('af.versions')}</SectionLabel>
      {versions.length === 0 ? (
        <Text size="sm" color="textSecondary">
          {t('af.noVersions')}
        </Text>
      ) : (
        versions.map((r) => (
          <Card key={r.id} dense selected={r.selected} onPress={() => onVersion(r.id)} testID="af-version">
            <Row>
              <Text size="sm" mono weight="medium">
                {r.label}
              </Text>
              <Text size="xs" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
                {r.line.startsWith(r.label) ? r.line.slice(r.label.length).trim() : r.line}
              </Text>
            </Row>
          </Card>
        ))
      )}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  row: { flex: 1, flexDirection: 'row' },
  left: { width: 300, flexGrow: 0, borderRightWidth: 1, borderRightColor: colors.border },
  right: { width: 320, flexGrow: 0, borderLeftWidth: 1, borderLeftColor: colors.border },
  pad: { padding: space[4], gap: space[3] },
});
