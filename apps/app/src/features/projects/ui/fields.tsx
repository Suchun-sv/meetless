import { createElement } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { TextField, Text } from '@/components/ui';
import { colors, fontFor, fontSize, radius, space } from '@/theme';

/*
 * Form pieces for the setup pages: a date field (the browser's own date input on the web, a
 * YYYY-MM-DD text field on iOS) and a wrap of choice chips standing in for a select.
 */

export function DateField({ value, onChange, label, testID }: { value: string; onChange: (v: string) => void; label: string; testID?: string }) {
  if (Platform.OS === 'web') {
    return createElement('input', {
      type: 'date',
      value,
      'aria-label': label,
      title: label,
      'data-testid': testID,
      onChange: (e: { target: { value: string } }) => onChange(e.target.value),
      style: {
        height: 36,
        padding: `0 ${space[2]}px`,
        border: `1px solid ${colors.borderStrong}`,
        borderRadius: radius.md,
        background: colors.bg,
        color: colors.text,
        fontSize: fontSize.base,
        fontFamily: fontFor('regular', {}).fontFamily,
      },
    });
  }
  return (
    <View style={{ minWidth: 140 }}>
      <TextField value={value} onChangeText={onChange} placeholder="YYYY-MM-DD" accessibilityLabel={label} keyboardType="numbers-and-punctuation" maxLength={10} testID={testID} />
    </View>
  );
}

/** One choice from a few, as chips (stands in for a select). `value` '' is the first option when given. */
export function Chips({ value, options, onChange, testID }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; testID?: string }) {
  return (
    <View style={styles.wrap} testID={testID}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value || '_'} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onChange(o.value)} style={[styles.chip, on && styles.on]}>
            <Text size="sm" tight color={on ? 'text' : 'textSecondary'} weight={on ? 'medium' : 'regular'} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A section heading inside a setup page. */
export function H2({ children }: { children: string }) {
  return (
    <Text size="md" weight="semibold" tight style={{ marginTop: space[4] }}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space[3], minHeight: 32, justifyContent: 'center', backgroundColor: colors.bg },
  on: { borderColor: colors.text, backgroundColor: colors.selected },
});
