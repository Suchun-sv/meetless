import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space } from '@/theme';
import { Icon, Text, type IconName } from '@/components/ui';
import { useApp } from '@/state';
import { usePendingMaterialCount } from '@/features/inbox/model/useInbox';
import { useCurrent } from './useCurrent';

type Tab = { key: 'mine' | 'projects' | 'inbox'; icon: IconName; href: '/' | '/projects' | '/inbox' };
const TABS: Tab[] = [
  { key: 'mine', icon: 'calendar', href: '/' },
  { key: 'projects', icon: 'folder', href: '/projects' },
  { key: 'inbox', icon: 'inbox', href: '/inbox' },
];

/** The phone tab bar: 我的 / 项目 / 需求 (mobile-v2), the badge counting materials awaiting confirmation. */
export function TabBar() {
  const { t } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cur = useCurrent();
  const on: Tab['key'] = cur.path === '/' ? 'mine' : cur.path.startsWith('/inbox') || cur.path === '/confirm' ? 'inbox' : cur.path.startsWith('/p/') || cur.path.startsWith('/projects') ? 'projects' : 'mine';
  // Materials awaiting confirmation: the server inbox's badge, else the local per-project count.
  const badge = usePendingMaterialCount();
  const label = { mine: t('nav.home'), projects: t('nav.projects'), inbox: t('nav.board') };
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space[2]) }]} accessibilityRole="tablist">
      {TABS.map((tab) => {
        const active = on === tab.key;
        return (
          <Pressable
            key={tab.key}
            testID={`tab-${tab.key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => (active && tab.key !== 'projects' ? undefined : router.navigate(tab.href))}
            style={styles.tab}
          >
            <View>
              <Icon name={tab.icon} size={25} color={active ? 'text' : 'textTertiary'} />
              {tab.key === 'inbox' && badge > 0 ? (
                <View style={styles.badge} testID="tab-inbox-badge">
                  <Text size="xs" weight="semibold" color="textInverse" tight style={{ fontSize: 11.5, lineHeight: 14 }}>
                    {badge > 99 ? '99+' : String(badge)}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text size="xs" weight="medium" color={active ? 'text' : 'textTertiary'} tight style={{ fontSize: 11 }}>
              {label[tab.key]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: colors.bar, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline, paddingTop: 7 },
  tab: { flex: 1, alignItems: 'center', gap: 4, minHeight: 44 },
  badge: { position: 'absolute', top: -3, left: 18, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: radius.full, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
});
