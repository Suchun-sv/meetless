import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { Id } from '@meetless/core';
import { Sheet, Text } from '@/components/ui';
import { useApp } from '@/state';
import { colors, radius, space, tones } from '@/theme';
import { useOpenTarget } from '../chat/ui/nav';
import { statusTone } from '../chat/ui/NeedChip';
import { Icon } from '../chat/ui/icons';
import { needTrail, type TrailStep } from './model/needTrail';

/** The 07 sheet's height: its top at y=56 of a 926-tall phone. */
export const NEED_TRAIL_HEIGHT = 1 - 56 / 926;

function Step({ s }: { s: TrailStep }) {
  const open = useOpenTarget();
  const [full, setFull] = useState(false);
  return (
    <View style={styles.step} testID="trail-step">
      {!s.last && <View style={styles.rail} />}
      <View style={styles.gut}>
        <Icon name={s.icon} size={16} />
      </View>
      <Pressable style={styles.main} disabled={!s.folds} onPress={() => setFull((v) => !v)}>
        <View style={styles.meta}>
          {s.meta.map((m, i) => (
            <Text key={i} size="xs" color="textTertiary">
              {m}
            </Text>
          ))}
        </View>
        <Text size="md" weight={s.last ? 'semibold' : 'medium'} style={styles.what}>
          {s.what}
        </Text>
        {s.quote && (
          <Pressable accessibilityRole="link" disabled={!s.source} onPress={() => s.source && open(s.source)} style={styles.quote}>
            <Text size="sm" selectable>
              {s.quote}
            </Text>
          </Pressable>
        )}
        {s.why && (
          <Text size="sm" color="textSecondary" numberOfLines={s.folds && !full ? 2 : undefined} style={styles.why}>
            {s.why}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

/**
 * 07 单条需求的来龙去脉, the sheet body: 「N7 外部需求 来龙去脉」, the title, the current state (status,
 * version, owner), then the steps oldest first ending in 「现在」. A2 pushes this inside the need
 * detail sheet with 「‹ 详情」; `NeedTrailSheet` wraps it in a sheet of its own.
 */
export function NeedTrail({ projectId, needId }: { projectId: Id; needId: Id }) {
  const { t, live, today, fmtDay } = useApp();
  const v = needTrail(t, live, projectId, needId, today, fmtDay);
  if (!v) {
    return (
      <View style={styles.body}>
        <Text color="textSecondary">{t('dr.missing')}</Text>
      </View>
    );
  }
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body} testID="need-trail">
      <View style={styles.kind}>
        <Text size="sm" mono color="textSecondary">
          {v.code}
        </Text>
        <Text size="sm" color="textTertiary">
          {`${v.kind}　${t('lnv.trailTitle')}`}
        </Text>
      </View>
      <Text weight="semibold" style={styles.title}>
        {v.title}
      </Text>
      <View style={styles.now}>
        <Text size="md" weight="semibold" style={{ color: tones[statusTone(v.status)].fg }}>
          {v.statusLabel}
        </Text>
        <Text size="md" color="textSecondary">
          {t('lnv.version', { v: v.version })}
        </Text>
        {v.owner && (
          <Text size="md" color="textSecondary">
            {t('lnv.owner', { who: v.owner })}
          </Text>
        )}
      </View>
      <View style={styles.steps}>
        {v.steps.map((s) => (
          <Step key={s.key} s={s} />
        ))}
      </View>
    </ScrollView>
  );
}

/** 07 in a sheet of its own: 「‹ 详情」 at the top left, ✕ at the top right. */
export function NeedTrailSheet({ projectId, needId, open, onClose, onBack }: { projectId: Id; needId: Id; open: boolean; onClose: () => void; onBack?: () => void }) {
  const { t } = useApp();
  return (
    <Sheet open={open} onClose={onClose} height={NEED_TRAIL_HEIGHT} onBack={onBack} backLabel={t('lnv.back')} fixedBody>
      <NeedTrail projectId={projectId} needId={needId} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  body: { paddingBottom: space[8] },
  kind: { flexDirection: 'row', alignItems: 'baseline', gap: space[2], marginTop: 2 },
  title: { fontSize: 23, lineHeight: 30, letterSpacing: -0.23, marginTop: 2, marginBottom: 6 },
  now: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14 },
  steps: { marginTop: 22 },
  step: { flexDirection: 'row', gap: 14, paddingBottom: 18, position: 'relative' },
  rail: { position: 'absolute', left: 10.5, top: 24, bottom: 2, width: 1, backgroundColor: colors.border },
  gut: { width: 22, alignItems: 'center', paddingTop: 3 },
  main: { flex: 1, minWidth: 0 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space[2] + 2 },
  what: { marginTop: 1 },
  quote: { marginTop: 6, backgroundColor: colors.surface, borderRadius: radius.xl, paddingHorizontal: space[3], paddingVertical: 9 },
  why: { marginTop: 2 },
});
