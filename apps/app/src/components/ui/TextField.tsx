import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { colors, fontFor, fontSize, hasCjk, radius, space } from '@/theme';
import { Text } from './Text';

export interface TextFieldProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  mono?: boolean;
}

/** A labelled text input. Multiline grows with its content up to the given height. */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField({ label, hint, error, mono, style, multiline, value, placeholder, ...rest }, ref) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      {label ? (
        <Text size="sm" weight="medium" color="textSecondary" tight>
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        value={value}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        multiline={multiline}
        autoCorrect={false}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        style={[
          fontFor('regular', { mono, cjk: hasCjk(String(value ?? placeholder ?? '')) }),
          styles.input,
          multiline && styles.multi,
          focused && styles.focused,
          !!error && styles.errorBorder,
          style,
        ]}
      />
      {error ? (
        <Text size="sm" color="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text size="xs" color="textTertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: space[1] },
  input: {
    fontSize: fontSize.base,
    color: colors.text,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    minHeight: 40,
  },
  multi: { minHeight: 88, textAlignVertical: 'top' },
  focused: { borderColor: colors.focus },
  errorBorder: { borderColor: colors.danger },
});
