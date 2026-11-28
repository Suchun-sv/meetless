/**
 * Small local pieces for the needs and confirm screens (candidates for components/ui): a
 * pressable chip, a labelled row, a section with a heading, and the renderer-tone mapping.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from '@/components/ui';
import { colors, radius, space, type Tone as ThemeTone } from '@/theme';
import type { Tone } from '../model/board';

/** The renderer's tones onto the theme's: `strong` and `muted` have no tint of their own. */
export function themeTone(t: Tone | null | undefined): ThemeTone {
  if (!t || t === 'strong' || t === 'muted') return 'neutral';
  return t;
}

export function Chip({ label, on, onPress, disabled, testID }: { label: string; on?: boolean; onPress?: () => void; disabled?: boolean; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.chip, on && styles.chipOn, (pressed || hovered) && !on && !disabled && styles.chipHover, disabled && styles.off]}
    >
      <Text size="xs" weight={on ? 'medium' : 'regular'} color={on ? 'textInverse' : 'text'} tight numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Row({ children, wrap, gap = 2, style }: { children: ReactNode; wrap?: boolean; gap?: 1 | 2 | 3; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, { gap: space[gap] }, wrap && styles.wrap, style]}>{children}</View>;
}

/** A label on the left and its value on the right; stacks on narrow containers. */
export function KV({ label, children, stack }: { label: string; children: ReactNode; stack?: boolean }) {
  return (
    <View style={[styles.kv, stack && styles.kvStack]}>
      <Text size="sm" color="textSecondary" style={stack ? undefined : styles.kvLabel}>
        {label}
      </Text>
      <View style={styles.kvValue}>{children}</View>
    </View>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text size="xs" weight="semibold" color="textSecondary" tight>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** The 规则生成 mark on rule output: violet text, with an optional fix control. */
export function RulesMark({ label, fixLabel, onFix }: { label: string; fixLabel?: string; onFix?: () => void }) {
  return (
    <Row gap={1}>
      <Text size="xs" color="ai" tight>
        {label}
      </Text>
      {onFix && fixLabel ? (
        <Pressable accessibilityRole="button" onPress={onFix} hitSlop={6}>
          <Text size="xs" color="ai" weight="medium" tight style={{ textDecorationLine: 'underline' }}>
            {fixLabel}
          </Text>
        </Pressable>
      ) : null}
    </Row>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.full, paddingHorizontal: space[3], minHeight: 28, justifyContent: 'center', backgroundColor: colors.bg },
  chipOn: { backgroundColor: colors.text, borderColor: colors.text },
  chipHover: { backgroundColor: colors.hover },
  off: { opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
  kv: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', paddingVertical: 2 },
  kvStack: { flexDirection: 'column', gap: space[1] },
  kvLabel: { width: 84 },
  kvValue: { flex: 1, minWidth: 0, gap: space[1] },
  section: { gap: space[2], paddingTop: space[4], borderTopWidth: 1, borderTopColor: colors.border },
});
