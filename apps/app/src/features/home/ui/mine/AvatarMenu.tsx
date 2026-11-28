import { useState } from 'react';
import { Pressable } from 'react-native';
import { Avatar, MenuSheet } from '@/components/ui';
import { useApp, useGo } from '@/state';

/** The top-right avatar on 我的 and its menu: search, reminders, settings, Agent access, sign out. */
export function AvatarMenu() {
  const { me, t, signOut } = useApp();
  const go = useGo();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable testID="mine-avatar" accessibilityRole="button" accessibilityLabel={t('xp.settings')} hitSlop={8} onPress={() => setOpen(true)}>
        <Avatar userId={me} />
      </Pressable>
      <MenuSheet
        open={open}
        onClose={() => setOpen(false)}
        items={[
          { label: t('xp.search'), onPress: () => go({ view: 'search' }), testID: 'menu-search' },
          { label: t('xp.reminders'), onPress: () => go({ view: 'reminders' }), testID: 'menu-reminders' },
          { label: t('xp.settings'), onPress: () => go({ view: 'settings' }), testID: 'menu-settings' },
          { label: t('nav.agents'), onPress: () => go({ view: 'agents' }), testID: 'menu-agents' },
          { label: t('web.signOut'), onPress: () => void signOut(), testID: 'menu-signout' },
        ]}
      />
    </>
  );
}
