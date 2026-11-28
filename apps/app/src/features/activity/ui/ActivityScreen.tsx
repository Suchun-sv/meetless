import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Id } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { Button, Divider, Pill, Screen, Text } from '@/components/ui';
import { useApp, useGo, useProjectId } from '@/state';
import { colors, space } from '@/theme';
import { ChipRow, MutedTag, NeedChip, RulesMark, Row, SourceTag, themeTone, useContainerWidth } from '../../inputs/ui/common';
import { CaptureButton } from '../../artifacts/ui/SourcePanel';
import { activityView, STREAM_KINDS, streamNeedOptions, type ActivityCard, type StreamKind } from '../model';

/** 动态: agent reports, work people logged, and captures, filtered by kind and by need. */
export function ActivityScreen() {
  const { live, me, t, fmtDay } = useApp();
  const projectId = useProjectId();
  const [kind, setKind] = useState<StreamKind | 'all'>('all');
  const [needId, setNeedId] = useState<Id | null>(null);
  const [w, onLayout] = useContainerWidth();
  const wide = w >= 640;
  const view = activityView(live, me, projectId, { kind, needId }, t, fmtDay);
  const needs = streamNeedOptions(live, projectId);

  return (
    <Screen title={t('stream.title')}>
      <View onLayout={onLayout} style={{ gap: space[3] }} testID="page-stream">
        <Text size="sm" color="textSecondary">
          {t('stream.sub')}
        </Text>
        <CaptureButton projectId={projectId} testID="stream-capture" />
        <ChipRow scroll value={kind} onChange={setKind} options={STREAM_KINDS.map((k) => ({ value: k, label: t(`stream.k.${k}` as MessageKey), testID: `stream-k-${k}` }))} />
        {needs.length > 0 ? (
          <ChipRow scroll value={needId ?? ''} onChange={(v) => setNeedId(v || null)} options={[{ value: '', label: t('stream.allNeeds') }, ...needs.map((n) => ({ value: n.id, label: n.code }))]} />
        ) : null}
        {wide && view.lines.length > 0 ? (
          <View style={st.head}>
            <Text size="xs" color="textTertiary" style={st.sig}>
              {t('stream.signal')}
            </Text>
            <Text size="xs" color="textTertiary" style={{ flex: 1 }}>
              {t('stream.reading')}
            </Text>
          </View>
        ) : null}
        {view.emptyKey ? (
          <Text color="textSecondary">{t(view.emptyKey)}</Text>
        ) : (
          view.lines.map((l) =>
            l.type === 'sys' ? (
              <Text key={l.key} size="sm" color="textSecondary" testID="stream-sys">
                {l.text}
              </Text>
            ) : (
              <View key={l.key}>
                <ActivityRow projectId={projectId} c={l.card} wide={wide} />
                <Divider />
              </View>
            ),
          )
        )}
      </View>
    </Screen>
  );
}

function ActivityRow({ projectId, c, wide }: { projectId: Id; c: ActivityCard; wide: boolean }) {
  const { t } = useApp();
  const go = useGo();
  const signal = (
    <View style={[{ gap: space[1] }, wide && st.sig]}>
      <Row>
        <SourceTag src={c.src} />
        <Text size="xs" color="textTertiary">
          {c.meta}
        </Text>
      </Row>
      <Text size="sm" mono={c.mono}>
        {c.text}
      </Text>
    </View>
  );
  const reading = (
    <View style={{ gap: space[1], flex: wide ? 1 : undefined }}>
      {c.needIds.length > 0 || c.effect || c.result ? (
        <Row wrap>
          {c.needIds.map((id) => (
            <NeedChip key={id} projectId={projectId} needId={id} />
          ))}
          {c.effect ? <Pill label={t(c.effect.key)} tone={themeTone(c.effect.tone)} /> : null}
          {c.result ? <Pill label={t(c.result.key)} tone={themeTone(c.result.tone)} /> : null}
        </Row>
      ) : null}
      {c.why ? (
        <Text size="sm" color="textSecondary">
          {c.why}
        </Text>
      ) : null}
      <Row wrap>
        {c.via ? (
          <Text size="xs" color="success">
            {t('stream.via', { client: c.via })}
          </Text>
        ) : null}
        {c.progress ? (
          <Text size="xs" color="success">
            {t('stream.progress')}
          </Text>
        ) : null}
        {c.capture ? <MutedTag label={t('cap.label')} /> : null}
        {c.rules ? <RulesMark /> : null}
        {c.mine ? <MutedTag label={t('pv.mine')} /> : null}
        {c.unlinked ? <MutedTag label={t('stream.unlinked')} /> : null}
        {c.askable ? <Button testID="stream-review" label={t('stream.review')} size="sm" onPress={() => go({ view: 'confirm', projectId })} /> : null}
      </Row>
    </View>
  );
  return (
    <View style={[st.row, wide && { flexDirection: 'row' }]} testID="stream-row">
      {signal}
      {reading}
    </View>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', gap: space[4], borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: space[1] },
  sig: { width: 280 },
  row: { gap: space[2], paddingVertical: space[3], columnGap: space[4] },
});
