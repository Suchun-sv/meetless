import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/theme';
import { Text } from './Text';

export interface SegmentedProps<V extends string> {
  value: V;
  options: readonly { value: V; label: string; testID?: string }[];
  onChange: (v: V) => void;
  size?: 'sm' | 'md';
  accessibilityLabel?: string;
}

/** A row of mutually exclusive choices (tabs, filters, language). */
export function Segmented<V extends string>({ value, options, onChange, size = 'md', accessibilityLabel }: SegmentedProps<V>) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={styles.row}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={o.testID}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.item, size === 'sm' ? styles.sm : styles.md, on && styles.on]}
          >
            <Text size={size === 'sm' ? 'xs' : 'sm'} weight={on ? 'medium' : 'regular'} color={on ? 'text' : 'textSecondary'} tight numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: colors.surface, borderRadius: radius.md, padding: 2, gap: 2 },
  item: { borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  md: { paddingHorizontal: space[3], minHeight: 30 },
  sm: { paddingHorizontal: space[2], minHeight: 24 },
  on: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
});
