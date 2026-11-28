import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { noDots } from '@meetless/core';
import { Text } from '@/components/ui';
import { useApp } from '@/state';
import { colors, space } from '@/theme';
import { Icon } from '../../chat/ui/icons';
import { useInboxDone, useInboxWatchApi } from '../model/watch';

/** 「《title》分析完了」 with 去看看, shown on any page when a material followed in the background finishes. */
export function InboxDoneBar() {
  const { t } = useApp();
  const router = useRouter();
  useInboxWatchApi();
  const { done, dismiss } = useInboxDone();
  if (!done) return null;
  return (
    <View style={styles.bar} testID="inbox-done-bar">
      <Icon name="checkCircle" size={18} color={colors.successBg} />
      <Text size="sm" color="textInverse" numberOfLines={1} style={styles.grow}>
        {t('inb.analysed', { title: noDots(done.title) })}
      </Text>
      <Pressable
        hitSlop={8}
        onPress={() => {
          dismiss();
          router.push(`/inbox/${encodeURIComponent(done.id)}` as Href);
        }}
        testID="inbox-done-look"
      >
        <Text size="sm" weight="semibold" color="textInverse">
          {t('inb.look')}
        </Text>
      </Pressable>
      <Pressable hitSlop={8} onPress={dismiss} accessibilityLabel={t('close')}>
        <Icon name="x" size={16} color={colors.borderStrong} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: colors.text, borderRadius: 14, marginHorizontal: space[3], marginBottom: space[2], paddingHorizontal: space[4], paddingVertical: space[3] },
  grow: { flex: 1 },
});
