import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { MessageKey } from '@meetless/i18n';
import { topbarModel } from '@renderer/shell/model';
import { colors, layout, radius, space, useLayout } from '@/theme';
import { AvatarStack, Text } from '@/components/ui';
import { routeToHref, useApp } from '@/state';
import { useCurrent } from './useCurrent';

/** The view title for the first path segment (project sections and global pages). */
const TITLE: Record<string, MessageKey> = {
  home: 'nav.home',
  dash: 'nav.dash',
  board: 'nav.board',
  need: 'xp.need',
  inputs: 'nav.inputs',
  artifacts: 'nav.artifacts',
  stream: 'nav.stream',
  deliveries: 'nav.deliveries',
  members: 'nav.members',
  rounds: 'nav.rounds',
  confirm: 'w.confirm',
  chat: 'xp.chat',
  import: 'xp.import',
  handoff: 'cp.handoff',
  lineage: 'lin.title',
  search: 'xp.search',
  settings: 'xp.settings',
  agents: 'nav.agents',
  reminders: 'xp.reminders',
  projects: 'nav.newProject',
};

/**
 * The top bar (legacy shell/Topbar and StatusBar): menu on phones, the crumb (project / view), the
 * project's members (opens members) and 「待确认」 with its count; sync state, records the local
 * replay could not apply, and the desktop outbox (queued, rejected with dismiss) as coloured text.
 */
export function Topbar({ onMenu }: { onMenu?: () => void }) {
  const { live, me, today, t, errorText, snapshot, skipped, bridge } = useApp();
  const router = useRouter();
  const { phone } = useLayout();
  const cur = useCurrent();
  const model = topbarModel(live, me, cur.route, today);
  const pid = model.projectId;
  const titleKey = TITLE[cur.section];
  const state = snapshot.status.state;
  const queued = snapshot.outbox.filter((o) => o.status === 'queued').length;
  const rejected = snapshot.outbox.filter((o) => o.status === 'rejected');
  return (
    <View>
      <View style={styles.bar}>
        {onMenu ? (
          <Pressable testID="menu" accessibilityRole="button" onPress={onMenu} hitSlop={8} style={styles.menu}>
            <Text size="sm" weight="medium" tight>
              {t('web.menu')}
            </Text>
          </Pressable>
        ) : null}
        <View style={styles.crumb}>
          <Text size="md" weight="semibold" tight numberOfLines={1} style={{ flexShrink: 1 }}>
            {pid ? (model.projectName ?? '') : titleKey ? t(titleKey) : t('app.name')}
          </Text>
          {pid && titleKey && !phone ? (
            <Text size="md" color="textTertiary" tight numberOfLines={1}>
              {`/ ${t(titleKey)}`}
            </Text>
          ) : null}
        </View>
        {state !== 'online' ? (
          <Text size="xs" tight color={state === 'offline' ? 'warning' : 'textTertiary'} testID="sync-status">
            {t(`sync.${state}`)}
          </Text>
        ) : null}
        {pid ? (
          <>
            {!phone ? (
              <Pressable testID="top-members" accessibilityLabel={t('top.members')} onPress={() => router.navigate(routeToHref({ view: 'members', projectId: pid }))}>
                <AvatarStack userIds={model.memberIds} />
              </Pressable>
            ) : null}
            <Pressable
              testID="topbar-confirm"
              accessibilityRole="button"
              onPress={() => router.navigate(routeToHref({ view: 'confirm', projectId: pid }))}
              style={[styles.ask, model.confirmCount > 0 && styles.askHas]}
            >
              <Text size="sm" weight="medium" tight color={model.confirmCount > 0 ? 'warning' : 'textSecondary'}>
                {model.confirmCount > 0 ? `${t('ask.btn')} ${model.confirmCount}` : t('ask.btn')}
              </Text>
            </Pressable>
          </>
        ) : null}
      </View>
      {skipped.length > 0 || queued > 0 || rejected.length > 0 ? (
        <View style={styles.strip}>
          {skipped.length > 0 ? (
            <Text size="xs" color="warning" testID="sync-skipped">
              {t('sync.skipped', { n: skipped.length })}
            </Text>
          ) : null}
          {queued > 0 ? (
            <Text size="xs" color="warning">
              {t('outbox.queued', { n: queued })}
            </Text>
          ) : null}
          {rejected.map((o) => (
            <View key={o.id} style={styles.rejected}>
              <Text size="xs" color="danger">
                {t('outbox.rejected', { reason: errorText(o.error?.code ?? '') })}
              </Text>
              <Pressable onPress={() => void bridge.dismissOutbox(o.id)} hitSlop={6}>
                <Text size="xs" color="textSecondary">
                  {t('outbox.dismiss')}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <NewBuild />
    </View>
  );
}

/** Web: the server serves a newer build than this page (a `newBuild` event): offer a refresh. */
function NewBuild() {
  const { bridge, t } = useApp();
  const [shown, setShown] = useState(false);
  useEffect(() => bridge.subscribe((e) => e.type === 'newBuild' && setShown(true)), [bridge]);
  if (!shown || Platform.OS !== 'web') return null;
  return (
    <Pressable testID="new-build" onPress={() => globalThis.location?.reload()} style={styles.newBuild}>
      <Text size="sm" weight="medium" color="info">
        {t('web.newBuild')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { height: layout.topbar, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg },
  menu: { minHeight: layout.touchMin, justifyContent: 'center', paddingRight: space[1] },
  crumb: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2], minWidth: 0 },
  ask: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space[3], minHeight: 30, justifyContent: 'center' },
  askHas: { backgroundColor: colors.warningBg, borderColor: colors.warningBg },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[1], borderBottomWidth: 1, borderBottomColor: colors.border },
  rejected: { flexDirection: 'row', gap: space[2], alignItems: 'center' },
  newBuild: { alignSelf: 'center', marginTop: space[2], backgroundColor: colors.infoBg, borderRadius: radius.full, paddingHorizontal: space[4], paddingVertical: space[1] },
});
