import { Pressable, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { colors, radius, space } from '@/theme';

export interface CardProps extends ViewProps {
  onPress?: () => void;
  /** Tighter padding for dense lists. */
  dense?: boolean;
  /** Selected look (sidebar-style). */
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** A bordered surface. Pressable when `onPress` is given. */
export function Card({ onPress, dense, selected, style, children, ...rest }: CardProps) {
  const base = [styles.card, dense && styles.dense, selected && styles.selected, style];
  if (!onPress) {
    return (
      <View {...rest} style={base}>
        {children}
      </View>
    );
  }
  return (
    <Pressable {...rest} accessibilityRole="button" onPress={onPress} style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [...base, (pressed || hovered) && styles.hover]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: space[4], gap: space[2] },
  dense: { padding: space[3], gap: space[1] },
  selected: { backgroundColor: colors.selected, borderColor: colors.borderStrong },
  hover: { backgroundColor: colors.hover },
});
