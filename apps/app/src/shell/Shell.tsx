import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useGlobalSearchParams, usePathname, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, layout, useLayout } from '@/theme';
import { Notices } from '@/components/ui';
import { ChatDock } from '@/slots/ChatDock';
import { ReminderSync } from '@/features/reminders/ui/sync';
import { InboxDoneBar } from '@/features/inbox/ui/DoneBar';
import { PhoneHeader, phoneHeaderKind } from './PhoneHeader';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { Topbar } from './Topbar';

/** Wide screens: sidebar plus content (unchanged). Phones: mobile-v1, tab bar and per-page headers, no drawer. */
export function Shell({ children }: { children: ReactNode }) {
  const { phone } = useLayout();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const router = useRouter();
  const params = useGlobalSearchParams();
  // The wide 看板 (/p/:pid) has no phone segment: phones open the project on 需求, keeping the query
  // (?ask=1). Replaced in an effect: returning a <Redirect> here unmounts the stack and lands on /.
  const bare = phone ? /^\/p\/([^/]+)\/?$/.exec(path)?.[1] : undefined;
  useEffect(() => {
    if (!bare) return;
    const q = Object.entries(params)
      .filter(([k, v]) => k !== 'projectId' && typeof v === 'string')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
      .join('&');
    router.replace(`/p/${encodeURIComponent(bare)}/board${q ? `?${q}` : ''}` as Href);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bare]);

  if (!phone) {
    return (
      <View style={styles.row}>
        <ReminderSync />
        <View style={styles.sidebar}>
          <Sidebar />
        </View>
        <View style={styles.main}>
          <Topbar />
          <View style={styles.content}>{children}</View>
          <ChatDock />
        </View>
        <Notices />
      </View>
    );
  }

  // Phones (mobile-v1): a header per page, the content, the Agent ask bar (A3's ChatDock) on 我的 and
  // the project segments, and the tab bar. The bars sit in the layout flow, so pages are never covered.
  const kind = phoneHeaderKind(path);
  return (
    <View style={[styles.main, { paddingTop: insets.top }]}>
      <ReminderSync />
      <PhoneHeader />
      <View style={styles.content}>{children}</View>
      {/* 「《…》分析完了」 shows on every page once: ChatDock and B1 mount it themselves, the rest get it here. */}
      {kind === 'mine' || kind === 'project' ? <ChatDock /> : kind === 'inbox' ? null : <InboxDoneBar />}
      <TabBar />
      <Notices bottom={56} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  sidebar: { width: layout.sidebar, borderRightWidth: 1, borderRightColor: colors.border },
  main: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1 },
});
