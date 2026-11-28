import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, layout, space, useLayout } from '@/theme';
import { Text } from './Text';

/**
 * A page body: scrolls, pads, and centres the content column (768 wide on big screens) unless
 * `full` is set. `title` renders the page heading.
 */
export function Screen({ title, actions, children, full, scroll = true, style }: { title?: string; actions?: ReactNode; children: ReactNode; full?: boolean; scroll?: boolean; style?: StyleProp<ViewStyle> }) {
  const { phone } = useLayout();
  const inner = (
    <View style={[styles.inner, { padding: phone ? space[4] : space[8] }, !full && styles.column, style]}>
      {title || actions ? (
        <View style={styles.head}>
          {title ? (
            <Text size="xl" weight="semibold" tight style={{ flex: 1 }}>
              {title}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          {actions}
        </View>
      ) : null}
      {children}
    </View>
  );
  if (!scroll) return <View style={styles.root}>{inner}</View>;
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
      {inner}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  inner: { gap: space[4], flexGrow: 1 },
  column: { width: '100%', maxWidth: layout.content + space[8] * 2, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
});
