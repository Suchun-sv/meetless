import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { usePathname } from 'expo-router';
import type { Id } from '@meetless/core';
import { Button, Segmented, Text } from '@/components/ui';
import { useApp } from '@/state';
import { colors, radius, space, useLayout } from '@/theme';
import { CcHandoffSheet } from './CcHandoff';
import { CcInput, CcOpening, CcThread } from './CcPanel';
import type { ChatMode } from './model';
import type { CcSession } from './useCcSession';

/** 「Claude Code / DeepSeek」, and 在别处继续 for the owner in Claude Code mode. */
export function ModeRow({ projectId, mode, onMode, s }: { projectId: Id; mode: ChatMode; onMode: (m: ChatMode) => void; s: CcSession | null }) {
  const { t } = useApp();
  const [handoff, setHandoff] = useState(false);
  return (
    <View style={styles.modeRow}>
      <Segmented<ChatMode>
        size="sm"
        value={mode}
        onChange={onMode}
        options={[
          { value: 'cc', label: t('cc.mode.cc') },
          { value: 'ds', label: t('cc.mode.ds') },
        ]}
      />
      <View style={styles.grow} />
      {mode === 'cc' && s?.status?.owner && s.status.session && <Button variant="link" size="sm" label={t('cc.handoff.title')} onPress={() => setHandoff(true)} testID="cc-handoff-open" />}
      <CcHandoffSheet projectId={projectId} open={handoff} onClose={() => setHandoff(false)} />
    </View>
  );
}

/**
 * The Claude Code chat inside the wide dock: one line for the latest reply until it is opened (or a
 * message is sent), then the thread capped at a third of the height; the input or its stand-in below.
 */
export function CcDock({ projectId, s }: { projectId: Id; s: CcSession }) {
  const { t } = useApp();
  const { height } = useLayout();
  const [expanded, setExpanded] = useState(false);
  const path = usePathname();
  useEffect(() => setExpanded(false), [path]);
  useEffect(() => {
    if (s.running) setExpanded(true);
  }, [s.running]);
  if (s.needsOpening) return <CcOpening onOpen={s.open} />;
  const last = [...s.rows].reverse().find((r) => r.kind === 'assistant' || r.kind === 'user');
  const pending = s.rows.some((r) => r.kind === 'permission' && r.state === 'pending');
  const open = expanded || pending;
  return (
    <View style={styles.wrap}>
      {s.rows.length > 0 && !open && (
        <Pressable accessibilityRole="button" onPress={() => setExpanded(true)} style={styles.bar} testID="cc-bar">
          <Text size="sm" weight="semibold" tight>
            {t('cc.mode.cc')}
          </Text>
          <Text size="sm" color="textSecondary" tight numberOfLines={1} style={styles.grow}>
            {last && 'text' in last ? last.text.split('\n')[0] : ''}
          </Text>
          <Text size="sm" color="textSecondary">
            {'›'}
          </Text>
        </Pressable>
      )}
      {open && (
        <View style={[styles.box, { height: Math.max(180, height * 0.33) }]}>
          <View style={styles.boxHead}>
            <Text size="sm" weight="semibold" style={styles.grow}>
              {t('cc.mode.cc')}
            </Text>
            <Button variant="ghost" size="sm" label={t('ch.close')} onPress={() => setExpanded(false)} />
          </View>
          <CcThread s={s} style={styles.thread} />
        </View>
      )}
      <CcInput projectId={projectId} s={s} />
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  wrap: { gap: space[2] },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: space[3], paddingVertical: space[2] },
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden', paddingHorizontal: space[3] },
  boxHead: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, marginHorizontal: -space[3], paddingHorizontal: space[3], paddingVertical: 2 },
  thread: { flex: 1 },
});
