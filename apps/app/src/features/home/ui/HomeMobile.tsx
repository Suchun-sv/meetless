import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CLOSED_STATUSES, homeItems, myProjectIds, type Id } from '@meetless/core';
import { Avatar, Button, NeedRow, Sheet, Text } from '@/components/ui';
import { useApp, useGo } from '@/state';
import { todayCount } from '@/state/today';
import { colors, space } from '@/theme';
import { leftText } from '../../dashboard/model/rows';
import { dateLine, deadlineGroups, dueThisWeek, leftTone, monthLabel, type DeadlineGroup } from '../model/mobile';

function Deadline({ g }: { g: DeadlineGroup }) {
  const { t, locale } = useApp();
  const go = useGo();
  const day = Number(g.round.due.slice(8, 10));
  return (
    <View style={styles.dl} testID="mine-deadline">
      <View style={styles.day}>
        <Text weight="semibold" tight style={styles.dayN}>
          {String(day)}
        </Text>
        <Text size="xs" color="textTertiary" tight>
          {monthLabel(g.round.due, locale)}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Pressable accessibilityRole="link" onPress={() => go({ view: 'board', projectId: g.projectId })} style={styles.head}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text weight="semibold" tight numberOfLines={2} style={{ fontSize: 17, lineHeight: 22 }}>
              {g.round.title || t('round', { n: g.round.n })}
            </Text>
            <Text color="textSecondary" tight numberOfLines={1} style={{ fontSize: 14, lineHeight: 20, marginTop: 1 }}>
              {g.projectName}
            </Text>
          </View>
          <Text weight="semibold" color={leftTone(g.daysLeft)} tight style={{ fontSize: 14, paddingTop: 2 }}>
            {leftText(t, g.daysLeft)}
          </Text>
        </Pressable>
        {g.needs.length ? (
          <View style={styles.needs}>
            {g.needs.map((n) => (
              <NeedRow key={n.id} needId={n.id} onPress={() => go({ view: 'board', projectId: g.projectId, needId: n.id })} testID="mine-need" />
            ))}
            {g.more > 0 ? (
              <Pressable accessibilityRole="link" onPress={() => go({ view: 'board', projectId: g.projectId })} style={styles.more}>
                <Text color="textTertiary" tight style={{ fontSize: 14 }}>
                  {t('home.m.more', { n: g.more })}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <Text color="success" tight style={styles.allDone}>
            {t('home.m.allDone')}
          </Text>
        )}
      </View>
    </View>
  );
}

/** The top-right avatar and its menu: search, settings, Agent access, reminders, sign out. */
function AvatarMenu() {
  const { me, t, signOut } = useApp();
  const go = useGo();
  const [open, setOpen] = useState(false);
  const item = (label: string, onPress: () => void, testID: string) => (
    <Pressable key={testID} testID={testID} accessibilityRole="link" onPress={() => (setOpen(false), onPress())} style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: colors.hover }]}>
      <Text>{label}</Text>
    </Pressable>
  );
  return (
    <>
      <Pressable testID="mine-avatar" accessibilityRole="button" accessibilityLabel={t('xp.settings')} hitSlop={8} onPress={() => setOpen(true)}>
        <Avatar userId={me} />
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)}>
        <View>
          {item(t('xp.search'), () => go({ view: 'search' }), 'menu-search')}
          {item(t('xp.reminders'), () => go({ view: 'reminders' }), 'menu-reminders')}
          {item(t('xp.settings'), () => go({ view: 'settings' }), 'menu-settings')}
          {item(t('nav.agents'), () => go({ view: 'agents' }), 'menu-agents')}
          {item(t('web.signOut'), () => void signOut(), 'menu-signout')}
        </View>
      </Sheet>
    </>
  );
}

/**
 * 「我的」 on narrow screens (mobile-v1 01): the date, 「今天要处理 N 件事」, how many DDLs fall
 * this week and how many items wait in 待确认, then every open DDL by date with up to three of
 * its open needs and 「还有 N 条」.
 */
export function HomeMobile() {
  const { live, me, t, today, locale } = useApp();
  const go = useGo();
  // Needs shown open here stay in place once checked off (greyed), so a second tap can undo.
  const shown = useRef(new Set<Id>());
  const groups = deadlineGroups(live, me, today, shown.current);
  for (const g of groups) for (const n of g.needs) if (!CLOSED_STATUSES.has(n.status)) shown.current.add(n.id);
  const confirm = homeItems(live, me, today).confirm;
  const week = dueThisWeek(groups, today);
  const count = todayCount(live, me, today);
  const projects = myProjectIds(live, me);
  const empty = groups.length === 0 && count === 0;
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: space[4] }} testID="page-home">
      <View style={styles.nav}>
        <AvatarMenu />
      </View>
      <Text color="textTertiary" tight style={styles.kicker}>
        {dateLine(today, locale)}
      </Text>
      <Text weight="semibold" style={styles.h1}>
        {empty ? t('home.m.noneTitle') : t('home.hi', { n: count })}
      </Text>
      {empty ? (
        <View style={styles.empty}>
          <Text color="textSecondary" style={{ fontSize: 15 }}>
            {t('home.m.noneSub')}
          </Text>
          <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
            <Button variant="primary" label={t('nav.newProject')} onPress={() => go({ view: 'newProject' })} testID="mine-new-project" />
            {projects[0] ? <Button label={t('home.m.import')} onPress={() => go({ view: 'import', projectId: projects[0]! })} testID="mine-import" /> : null}
          </View>
        </View>
      ) : (
        <Text color="textSecondary" style={styles.sub}>
          {t('home.m.week', { n: week })}
          {confirm.length ? (
            <>
              {t('home.m.sep')}
              <Text color="info" style={{ fontSize: 15 }} onPress={() => go({ view: 'confirmAll' })} testID="mine-confirm">
                {t('home.m.confirm', { n: confirm.length })}
              </Text>
            </>
          ) : null}
        </Text>
      )}
      {groups.map((g, i) => (
        <View key={g.round.id}>
          {i > 0 ? <View style={styles.hair} /> : null}
          <Deadline g={g} />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  nav: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: space[4] },
  kicker: { fontSize: 14, paddingHorizontal: space[5], paddingBottom: 2 },
  h1: { fontSize: 32, lineHeight: 37, letterSpacing: -0.64, paddingHorizontal: space[5], paddingTop: 2 },
  sub: { fontSize: 15, lineHeight: 22, paddingHorizontal: space[5], marginTop: 6, marginBottom: 18 },
  hair: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong, marginLeft: space[5] },
  empty: { paddingHorizontal: space[5], marginTop: 6, gap: space[4], alignItems: 'flex-start' },
  allDone: { fontSize: 14, marginTop: space[2] },
  dl: { flexDirection: 'row', gap: space[3], paddingHorizontal: space[5], paddingTop: space[4], paddingBottom: 14 },
  day: { width: 44, alignItems: 'center', paddingTop: 1, gap: 4 },
  dayN: { fontSize: 26, lineHeight: 28, letterSpacing: -0.52 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  needs: { marginTop: space[1] },
  // Under the title: circle 22 + gap 8 + code 26 + gap 12.
  more: { paddingTop: 4, paddingLeft: 68 },
  menuRow: { paddingVertical: space[3], paddingHorizontal: space[2], borderRadius: 6 },
});
