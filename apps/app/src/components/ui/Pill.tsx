import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, space, tones, type Tone } from '@/theme';
import { Text } from './Text';

/** A small tinted label: status, counts, kinds. Status is coloured text on a tint, never a dot. */
export function Pill({ label, tone = 'neutral', style }: { label: string; tone?: Tone; style?: StyleProp<ViewStyle> }) {
  const t = tones[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }, style]}>
      <Text size="xs" weight="medium" tight numberOfLines={1} style={{ color: t.fg }}>
        {label}
      </Text>
    </View>
  );
}

/** Status as coloured text only (no tint), for dense rows. */
export function Status({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  return (
    <Text size="xs" weight="medium" tight numberOfLines={1} style={{ color: tones[tone].fg }}>
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', borderRadius: radius.sm, paddingHorizontal: space[2], paddingVertical: 2 },
});
