import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { myProjectIds, toConfirm } from '@meetless/core';
import { colors, radius, space } from '@/theme';
import { Icon, Text, type IconName } from '@/components/ui';
import { useApp } from '@/state';
import { useCurrent } from './useCurrent';

/** To confirm across all my projects: the 待确认 tab's badge. */
export function confirmTotal(live: Parameters<typeof myProjectIds>[0], me: string, today: string): number {
  return myProjectIds(live, me).reduce((n, pid) => n + toConfirm(live, me, pid, today).count, 0);
}

type Tab = { key: 'mine' | 'projects' | 'confirm'; icon: IconName; href: '/' | '/projects' | '/confirm' };
const TABS: Tab[] = [
  { key: 'mine', icon: 'calendar', href: '/' },
  { key: 'projects', icon: 'folder', href: '/projects' },
  { key: 'confirm', icon: 'inbox', href: '/confirm' },
];

/** The phone tab bar (mobile-v1): 我的 / 项目 / 待确认 with a red count. Replaces the drawer. */
export function TabBar() {
  const { t, live, me, today } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cur = useCurrent();
  const on: Tab['key'] = cur.path === '/' ? 'mine' : cur.path === '/confirm' ? 'confirm' : cur.path.startsWith('/p/') || cur.path.startsWith('/projects') ? 'projects' : 'mine';
  const badge = confirmTotal(live, me, today);
  const label = { mine: t('nav.home'), projects: t('nav.projects'), confirm: t('w.confirm') };
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
              {tab.key === 'confirm' && badge > 0 ? (
                <View style={styles.badge} testID="tab-confirm-badge">
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
