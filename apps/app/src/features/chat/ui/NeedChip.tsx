import { Pressable, StyleSheet } from 'react-native';
import { clip, noDots, type Id, type NeedStatus } from '@meetless/core';
import { ST_TONE } from '@renderer/ui/tone';
import { Status, Text } from '@/components/ui';
import { useApp } from '@/state';
import { colors, radius, space, type Tone } from '@/theme';
import { useOpenTarget } from './nav';

/** A need's code and title as a chip; tap opens the need. A need gone from `live` shows the missing text. */
export function NeedChip({ projectId, needId }: { projectId: Id; needId: Id }) {
  const { live, t } = useApp();
  const open = useOpenTarget();
  const n = live.needs[needId];
  if (!n || n.projectId !== projectId) {
    return (
      <Text size="xs" color="textTertiary">
        {t('common.missingText')}
      </Text>
    );
  }
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => open({ kind: 'need', projectId, needId })}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.chip, (pressed || hovered) && styles.hover]}
    >
      <Text size="xs" mono color="textTertiary" tight>
        {n.code}
      </Text>
      <Text size="xs" tight numberOfLines={1} style={styles.title}>
        {clip(noDots(n.title), 60)}
      </Text>
    </Pressable>
  );
}

/** The app's tone for a need status (the desktop's `strong`/`muted` read as neutral here). */
export function statusTone(s: NeedStatus): Tone {
  const v = ST_TONE[s];
  return v === 'strong' || v === 'muted' ? 'neutral' : v;
}

/** A need status as coloured text. */
export function NeedStatusText({ status }: { status: NeedStatus }) {
  const { t } = useApp();
  return <Status label={t(`st.${status}`)} tone={statusTone(status)} />;
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    alignSelf: 'flex-start',
    maxWidth: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: space[2],
    paddingVertical: 2,
  },
  hover: { backgroundColor: colors.hover },
  title: { flexShrink: 1 },
});
