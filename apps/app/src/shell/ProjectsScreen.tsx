import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { myProjectIds, noDots, progressCard, projectNeeds, CLOSED_STATUSES, type Id } from '@meetless/core';
import { colors, space } from '@/theme';
import { Icon, Text } from '@/components/ui';
import { routeToHref, useApp } from '@/state';
import { daysColor } from './PhoneHeader';
import { ProjectSheet } from './ProjectSheet';

/**
 * The 项目 tab's home (mobile-v1, NOTES 「设计稿里没画的」): one row per project with its current
 * deadline, days left and 外部需求 x/y, nearest deadline first; archived projects fold into one
 * 「已归档 N 个」 row at the bottom. Its large title and + come from the phone header.
 */
export function ProjectsScreen() {
  const { live, me, today, t } = useApp();
  const router = useRouter();
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [settingsFor, setSettingsFor] = useState<Id | null>(null);
  const rows = myProjectIds(live, me).map((id) => {
    const pc = progressCard(live, id, today);
    const open = projectNeeds(live, id).filter((n) => !CLOSED_STATUSES.has(n.status)).length;
    return { id, pc, open };
  });
  rows.sort((a, b) => (a.pc.daysLeft ?? 1e9) - (b.pc.daysLeft ?? 1e9));
  const archived = myProjectIds(live, me, { includeArchived: true }).filter((id) => live.projects[id]?.archived);
  const go = (id: Id) => router.push(routeToHref({ view: 'board', projectId: id }));
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} testID="projects-list">
      {rows.length === 0 ? (
        <Text color="textSecondary" style={styles.empty}>
          {t('nav.noProjects')}
        </Text>
      ) : null}
      {rows.map((r, i) => {
        const p = live.projects[r.id]!;
        return (
          <Pressable key={r.id} testID={`project-row-${r.id}`} onPress={() => go(r.id)} onLongPress={() => setSettingsFor(r.id)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.hover }]}>
            <View style={[styles.body, i > 0 && styles.hair]}>
              <View style={styles.line}>
                <Text size="lg" weight="semibold" tight numberOfLines={1} style={{ flex: 1 }}>
                  {noDots(p.name)}
                </Text>
                {r.pc.daysLeft !== null ? (
                  <Text size="sm" weight="medium" tight color={daysColor(r.pc.daysLeft)}>
                    {r.pc.daysLeft >= 0 ? t('round.left', { n: r.pc.daysLeft }) : t('round.over', { n: -r.pc.daysLeft })}
                  </Text>
                ) : null}
              </View>
              <View style={styles.sub}>
                <Text size="sm" color="textSecondary" tight numberOfLines={1} style={{ flexShrink: 1 }}>
                  {r.pc.round ? noDots(r.pc.round.title) || t('round', { n: r.pc.round.n }) : t('xp.noRound')}
                </Text>
                {r.pc.round ? (
                  <Text size="sm" color="textSecondary" tight>
                    {t('xp.ext', { a: r.pc.done, b: r.pc.ext })}
                  </Text>
                ) : null}
                <Text size="sm" color="textTertiary" tight>
                  {t('xp.open', { n: r.open })}
                </Text>
              </View>
            </View>
            <Icon name="chevron" size={18} color="textTertiary" />
          </Pressable>
        );
      })}
      {archived.length > 0 ? (
        <View style={styles.arch} testID="projects-archived">
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: archivedOpen }} onPress={() => setArchivedOpen((o) => !o)} style={styles.archHead}>
            <Text size="sm" weight="medium" color="textSecondary" style={{ flex: 1 }}>
              {t('xp.archivedN', { n: archived.length })}
            </Text>
            <Icon name={archivedOpen ? 'down' : 'chevron'} size={16} color="textTertiary" />
          </Pressable>
          {archivedOpen
            ? archived.map((id) => (
                <Pressable key={id} onPress={() => go(id)} onLongPress={() => setSettingsFor(id)} style={styles.archRow}>
                  <Text color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
                    {noDots(live.projects[id]!.name)}
                  </Text>
                  <Icon name="chevron" size={16} color="textTertiary" />
                </Pressable>
              ))
            : null}
        </View>
      ) : null}
      <ProjectSheet projectId={settingsFor} onClose={() => setSettingsFor(null)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingTop: space[3], paddingBottom: space[8] },
  empty: { paddingHorizontal: space[5], paddingVertical: space[4] },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: space[5], paddingRight: space[4], gap: space[2] },
  body: { flex: 1, paddingVertical: space[3], gap: 4 },
  hair: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: space[3] },
  sub: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 2 },
  arch: { marginTop: space[5], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline, marginLeft: space[5] },
  archHead: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingRight: space[4] },
  archRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingRight: space[4], gap: space[2] },
});
