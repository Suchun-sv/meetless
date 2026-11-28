import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { Id, NeedStatus } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { Button, Text } from '@/components/ui';
import { useApp, useGo } from '@/state';
import { colors, radius, space, useLayout } from '@/theme';
import { barPct } from '../model/cards';
import { projectTag, ST_TONE, type Tone } from '../model/rows';

/*
 * Small pieces shared by the Home and project cards. Tones are the desktop's (`ui/tone.ts`),
 * drawn as coloured text from the theme; violet only for rule and AI output.
 */

/** The text colour for a desktop tone. */
export function toneColor(tone: Tone): string {
  switch (tone) {
    case 'info':
      return colors.info;
    case 'success':
      return colors.success;
    case 'warning':
      return colors.warning;
    case 'danger':
      return colors.danger;
    case 'ai':
      return colors.ai;
    case 'strong':
      return colors.text;
    case 'muted':
      return colors.textTertiary;
    default:
      return colors.textSecondary;
  }
}

/** A need status as coloured text. */
export function NeedStatusText({ s }: { s: NeedStatus }) {
  const { t } = useApp();
  return (
    <Text size="xs" weight="medium" tight numberOfLines={1} style={{ color: toneColor(ST_TONE[s]) }}>
      {t(`st.${s}` as MessageKey)}
    </Text>
  );
}

/** A progress bar, never a dot: the fill keeps a minimum width so a near 0 value still shows. */
export function Bar({ a, b, grow }: { a: number; b: number; grow?: boolean }) {
  return (
    <View style={[styles.bar, grow && { flex: 1 }]}>
      <View style={[styles.barFill, { width: `${barPct(a, b)}%` }]} />
    </View>
  );
}

/** A project's short tag. */
export function Tag({ projectId }: { projectId: Id }) {
  const { live } = useApp();
  return (
    <View style={styles.tag}>
      <Text size="xs" color="textSecondary" tight numberOfLines={1}>
        {projectTag(live.projects[projectId]?.name ?? '')}
      </Text>
    </View>
  );
}

/** A need's code and title; opens the need. */
export function NeedChip({ projectId, needId }: { projectId: Id; needId: Id }) {
  const { live } = useApp();
  const go = useGo();
  const n = live.needs[needId];
  if (!n) return null;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => go({ view: 'board', projectId, needId })}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.chip, (pressed || hovered) && styles.hover]}
    >
      <Text size="xs" mono color="textTertiary" tight>
        {n.code}
      </Text>
      <Text size="xs" tight numberOfLines={1} style={{ flexShrink: 1 }}>
        {n.title}
      </Text>
    </Pressable>
  );
}

/** A tappable row (Home lists, risks). `tinted` gives the risk-row background. */
export function Row({ onPress, children, tinted, style, testID }: { onPress?: () => void; children: ReactNode; tinted?: boolean; style?: StyleProp<ViewStyle>; testID?: string }) {
  const { phone } = useLayout();
  const base = [styles.row, tinted && styles.tinted, phone && styles.rowPhone, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [...base, (pressed || hovered) && styles.hover]}>
      {children}
    </Pressable>
  );
}

/** A card's empty state: what is missing, and the one action that fills it. */
export function CardEmpty({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.empty} testID="card-empty">
      <Text size="sm" color="textTertiary">
        {text}
      </Text>
      {action && onAction ? <Button size="sm" label={action} onPress={onAction} /> : null}
    </View>
  );
}

/** Faint one-line text for an empty list. */
export function Faint({ children }: { children: string }) {
  return (
    <Text size="sm" color="textTertiary">
      {children}
    </Text>
  );
}

export const styles = StyleSheet.create({
  bar: { height: 6, borderRadius: radius.sm, backgroundColor: colors.surface, overflow: 'hidden', minWidth: 60 },
  barFill: { height: '100%', minWidth: space[3], backgroundColor: colors.text, borderRadius: radius.sm },
  tag: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: space[1], backgroundColor: colors.bg, flexShrink: 0 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space[1], alignSelf: 'flex-start', maxWidth: '100%', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: space[2], paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderRadius: radius.md, padding: space[2] },
  rowPhone: { minHeight: 44 },
  tinted: { backgroundColor: colors.sidebar, paddingHorizontal: space[3] },
  hover: { backgroundColor: colors.hover },
  empty: { gap: space[2], alignItems: 'flex-start' },
  stack: { gap: space[1] },
  line: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
});
