import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { SUPPORTED_LOCALES, LANG_LABEL, type Locale } from '@/i18n';
import { IS_DESKTOP } from '@/bridge';
import { newInputTarget, sidebarModel } from '@renderer/shell/model';
import { colors, radius, space } from '@/theme';
import { Avatar, AvatarStack, Divider, Segmented, Text } from '@/components/ui';
import { displayName, PROJECT_SECTIONS, routeToHref, SECTION_TITLE_KEY, todayCount, useApp } from '@/state';
import { ProjectSheet } from './ProjectSheet';
import { UpdateArea } from './UpdateCallout';
import { useCurrent } from './useCurrent';

/**
 * The navigation: brand, 我的, the project tree (the current project expanded to its six sections,
 * members and rounds), search, settings and agent access, and the user row with language and sign out.
 * The same content is the wide sidebar and the phone drawer; `onNavigate` closes the drawer.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const app = useApp();
  const { live, me, today, t, locale, setLocale, submit } = app;
  const cur = useCurrent();
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [lastProjectId, setLastProjectId] = useState<string | null>(null);
  if (cur.projectId && cur.projectId !== lastProjectId) setLastProjectId(cur.projectId);
  const router = useRouter();
  const model = sidebarModel(live, me, cur.route, today);
  const go = (href: Href) => {
    router.navigate(href);
    onNavigate?.();
  };

  return (
    <View style={styles.side}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.brand}>
          <View style={styles.mark} />
          <Text size="md" weight="semibold" tight>
            {t('app.name')}
          </Text>
        </View>
        <NavRow
          label={`+ ${t('cm.new')}`}
          onPress={() => {
            // Legacy 「+ 新建」: a new input in the current (or last) project, else a new project.
            const target = newInputTarget(cur.route, lastProjectId, model.projects.map((p) => p.id));
            go('projectId' in target ? routeToHref({ view: 'import', projectId: target.projectId }) : '/projects/new');
          }}
          testID="side-new"
        />
        <NavRow label={t('nav.home')} count={todayCount(live, me, today)} on={cur.path === '/'} onPress={() => go('/')} testID="nav-home" />

        <Text size="xs" color="textTertiary" weight="medium" style={styles.label}>
          {t('nav.projects')}
        </Text>
        {model.projects.length === 0 ? (
          <Text size="sm" color="textTertiary" style={styles.empty}>
            {t('nav.noProjects')}
          </Text>
        ) : null}
        {model.projects.map((p) => (
          <View key={p.id}>
            <NavRow
              label={p.name}
              count={p.open ? 0 : p.total}
              strong={p.open}
              on={p.open && cur.section === 'dash'}
              onPress={() => go(routeToHref({ view: 'dash', projectId: p.id }))}
              onLongPress={() => setSettingsFor(p.id)}
              testID={`nav-project-${p.id}`}
            />
            {p.open ? (
              <View style={styles.sub}>
                <View style={styles.members}>
                  <AvatarStack userIds={p.memberIds} />
                </View>
                {PROJECT_SECTIONS.map((s) => (
                  <NavRow
                    key={s}
                    sub
                    label={t(SECTION_TITLE_KEY[s])}
                    count={p.badges[s] ?? 0}
                    on={cur.section === s || (s === 'board' && cur.section === 'need')}
                    onPress={() => go(routeToHref({ view: s, projectId: p.id }))}
                    testID={`nav-${s}`}
                  />
                ))}
                <View style={styles.links}>
                  <Link label={t('nav.members')} onPress={() => go(routeToHref({ view: 'members', projectId: p.id }))} />
                  <Link label={t('nav.rounds')} onPress={() => go(routeToHref({ view: 'rounds', projectId: p.id }))} />
                  <Link label={t('pj.setup')} onPress={() => setSettingsFor(p.id)} testID="nav-project-settings" />
                </View>
              </View>
            ) : null}
          </View>
        ))}
        {model.archived.length > 0 ? (
          <View testID="side-archived">
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: archivedOpen }} onPress={() => setArchivedOpen((o) => !o)} style={styles.archHead}>
              <Text size="xs" color="textTertiary" weight="medium">
                {t('pj.archivedGroup', { n: model.archived.length })}
              </Text>
            </Pressable>
            {archivedOpen
              ? model.archived.map((p) => (
                  <View key={p.id} style={styles.archRow}>
                    <View style={{ flex: 1 }}>
                      <NavRow sub muted label={p.name} on={cur.projectId === p.id} onPress={() => go(routeToHref({ view: 'dash', projectId: p.id }))} testID="nav-archived-project" />
                    </View>
                    <Link label={t('pj.restore')} onPress={() => void submit('project.unarchived', { projectId: p.id })} testID="project-restore" />
                  </View>
                ))
              : null}
          </View>
        ) : null}
        <NavRow label={t('nav.newProject')} muted on={cur.path === '/projects/new'} onPress={() => go('/projects/new')} testID="nav-new-project" />

        <View style={{ height: space[4] }} />
        <NavRow label={t('xp.search')} on={cur.section === 'search'} onPress={() => go('/search')} testID="nav-search" />
        <NavRow label={t('xp.settings')} on={cur.section === 'settings'} onPress={() => go('/settings')} testID="nav-settings" />
        <NavRow label={t('nav.agents')} on={cur.section === 'agents'} onPress={() => go('/agents')} testID="nav-agents" />
      </ScrollView>
      <ProjectSheet projectId={settingsFor} onClose={() => setSettingsFor(null)} />
      <UpdateArea />
      <Divider />
      <View style={styles.user}>
        <Avatar userId={me} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text size="sm" weight="medium" tight numberOfLines={1}>
            {displayName(live, me)}
          </Text>
          {model.anySample ? (
            <Text size="xs" color="textTertiary" tight>
              {t('app.sample')}
            </Text>
          ) : null}
          <Link label={IS_DESKTOP ? t('user.signOut') : t('web.signOut')} onPress={() => void app.signOut()} testID="sign-out" />
        </View>
        <Segmented<Locale>
          size="sm"
          accessibilityLabel={t('user.language')}
          value={locale}
          options={SUPPORTED_LOCALES.map((l) => ({ value: l, label: LANG_LABEL[l] }))}
          onChange={setLocale}
        />
      </View>
    </View>
  );
}

function NavRow({ label, count = 0, on, sub, strong, muted, onPress, onLongPress, testID }: { label: string; count?: number; on?: boolean; sub?: boolean; strong?: boolean; muted?: boolean; onPress: () => void; onLongPress?: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityState={{ selected: !!on }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.row, sub && styles.rowSub, on && styles.rowOn, (pressed || hovered) && !on && styles.rowHover]}
    >
      <Text size="sm" weight={on || strong ? 'medium' : 'regular'} color={muted ? 'textSecondary' : 'text'} numberOfLines={1} tight style={{ flex: 1 }}>
        {label}
      </Text>
      {count > 0 ? (
        <Text size="xs" color="textSecondary" tight>
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

function Link({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} hitSlop={6}>
      <Text size="xs" color="textSecondary" tight>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  side: { flex: 1, backgroundColor: colors.sidebar },
  scroll: { padding: space[3], gap: 2 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[2], paddingVertical: space[3], marginBottom: space[2] },
  mark: { width: 18, height: 18, borderRadius: radius.sm, backgroundColor: colors.text },
  label: { paddingHorizontal: space[2], marginTop: space[4], marginBottom: space[1] },
  empty: { paddingHorizontal: space[2], paddingVertical: space[1] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 32, paddingHorizontal: space[2], borderRadius: radius.md },
  rowSub: { paddingLeft: space[5] },
  rowOn: { backgroundColor: colors.selected },
  rowHover: { backgroundColor: colors.hover },
  sub: { gap: 2, paddingBottom: space[2] },
  members: { paddingLeft: space[5], paddingVertical: space[1] },
  archHead: { paddingHorizontal: space[2], paddingVertical: space[2], marginTop: space[2] },
  archRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingRight: space[2] },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4], paddingLeft: space[5], paddingTop: space[1] },
  user: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4] },
});
