import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow, space, z } from '@/theme';
import { useApp } from '@/state/AppContext';
import { Text } from './Text';

/** The app's notices (AppApi.notify): bottom of the screen, tap to dismiss. */
/** `bottom`: extra offset above bars at the bottom (the phone tab bar). */
export function Notices({ bottom = 0 }: { bottom?: number } = {}) {
  const { notices, dismissNotice } = useApp();
  const insets = useSafeAreaInsets();
  if (notices.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + space[4] + bottom }]}>
      {notices.map((n) => (
        <Pressable key={n.id} onPress={() => dismissNotice(n.id)} style={[styles.toast, n.tone === 'error' ? styles.error : styles.info]}>
          <Text size="sm" color={n.tone === 'error' ? 'danger' : 'textInverse'} style={{ flexShrink: 1 }}>
            {n.text}
          </Text>
          {n.action ? (
            <Pressable
              testID="notice-action"
              hitSlop={8}
              onPress={() => {
                dismissNotice(n.id);
                n.action!.onPress();
              }}
            >
              <Text size="sm" weight="semibold" color={n.tone === 'error' ? 'danger' : 'textInverse'}>
                {n.action.label}
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space[4], right: space[4], alignItems: 'center', gap: space[2], zIndex: z.toast },
  toast: { flexDirection: 'row', alignItems: 'center', gap: space[4], maxWidth: 480, borderRadius: radius.lg, paddingHorizontal: space[4], paddingVertical: space[3], ...shadow.md },
  info: { backgroundColor: colors.text },
  error: { backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: colors.danger },
});
