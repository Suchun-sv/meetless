import { Pressable, StyleSheet, View } from 'react-native';
import { colors, space } from '@/theme';
import { Sheet } from './Sheet';
import { Text } from './Text';

export interface MenuItem {
  label: string;
  onPress: () => void;
  tone?: 'danger';
  testID?: string;
}

/** The ⋯ menu and the 我的 avatar menu: a bottom sheet (dialog on wide screens) with one row per action. */
export function MenuSheet({ open, onClose, title, items }: { open: boolean; onClose: () => void; title?: string; items: MenuItem[] }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <View>
        {items.map((it, i) => (
          <Pressable
            key={it.label}
            testID={it.testID}
            accessibilityRole="button"
            onPress={() => {
              onClose();
              it.onPress();
            }}
            style={({ pressed }) => [styles.row, i > 0 && styles.sep, pressed && { backgroundColor: colors.hover }]}
          >
            <Text size="md" color={it.tone === 'danger' ? 'danger' : 'text'}>
              {it.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 48, justifyContent: 'center', paddingVertical: space[2] },
  sep: { borderTopWidth: 1, borderTopColor: colors.border },
});
