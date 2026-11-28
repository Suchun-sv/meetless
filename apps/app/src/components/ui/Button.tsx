import { ActivityIndicator, Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { colors, layout, radius, space } from '@/theme';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  busy?: boolean;
  /** Stretch to the container width. */
  block?: boolean;
  style?: StyleProp<ViewStyle>;
}

const FG: Record<ButtonVariant, 'textInverse' | 'text' | 'danger' | 'textSecondary'> = {
  primary: 'textInverse',
  secondary: 'text',
  ghost: 'text',
  danger: 'danger',
  link: 'textSecondary',
};

export function Button({ label, variant = 'secondary', size = 'md', busy, block, disabled, style, ...rest }: ButtonProps) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      {...rest}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        styles[variant],
        block && styles.block,
        (pressed || hovered) && !off && pressedStyle[variant],
        off && styles.off,
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={variant === 'primary' ? colors.textInverse : colors.textSecondary} /> : null}
      <Text size={size === 'sm' ? 'sm' : 'base'} weight="medium" color={FG[variant]} tight numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2], borderRadius: radius.md, borderWidth: 1, borderColor: 'transparent' },
  md: { minHeight: 36, paddingHorizontal: space[4] },
  sm: { minHeight: 28, paddingHorizontal: space[3] },
  block: { alignSelf: 'stretch' },
  primary: { backgroundColor: colors.text },
  secondary: { backgroundColor: colors.bg, borderColor: colors.borderStrong },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: colors.dangerBg },
  link: { backgroundColor: 'transparent', paddingHorizontal: 0, minHeight: 0 },
  off: { opacity: 0.5 },
});

const pressedStyle = StyleSheet.create({
  primary: { opacity: 0.85 },
  secondary: { backgroundColor: colors.hover },
  ghost: { backgroundColor: colors.hover },
  danger: { opacity: 0.85 },
  link: { opacity: 0.7 },
});

/** Minimum touch target for icon-size pressables on phones. */
export const TOUCH_MIN = layout.touchMin;
