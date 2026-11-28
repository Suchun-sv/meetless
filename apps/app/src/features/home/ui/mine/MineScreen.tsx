import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams } from 'expo-router';
import type { Id, IsoDate } from '@meetless/core';
import { Button, Segmented, Text } from '@/components/ui';
import { useApp, useGo } from '@/state';
import { usePendingMaterialCount } from '@/features/inbox/model/useInbox';
import { todayCount } from '@/state/today';
import { colors, space } from '@/theme';
import { addDays, addMonths, agenda, dateLine, defaultExpanded, demoSpans, firstOfMonth, mondayOf, monthLabel, pageRange, rangeTitle, sublineCounts, TL_BACK, type CalPage } from '../../model/mine';
import { Agenda } from './Agenda';
import { AvatarMenu } from './AvatarMenu';
import { MineCalendar } from './MineCalendar';
import { MineTimeline } from './MineTimeline';

const MODE_KEY = 'meetless.mine.mode';
type Mode = 'cal' | 'tl';

/**
 * 「我的」 on narrow screens (mine-v3): the date, 「今天要处理 N 件事」 and its subline, the
 * 月历 / 时间轴 switch (remembered on this device) and the calendar or timeline stay put; the
 * agenda scrolls below them. The calendar turns pages by swiping; picking a day scrolls the agenda
 * to it under a month bar and highlights it. One 「今天」 button brings everything back to today.
 */
export function MineScreen() {
  const { live, me, t, today, locale } = useApp();
  const go = useGo();
  const demo = useMemo(demoSpans, []);
  const items = agenda(live, me, today, demo);
  // 「N 份材料待确认」: the 需求 tab badge's own count (the server inbox, else the local one).
  const materials = usePendingMaterialCount();
  const count = todayCount(live, me, today);
  const sub = sublineCounts(items, today);

  const [mode, setMode] = useState<Mode>('cal');
  // The calendar page: two weeks from a Monday, or a month when expanded. Turning pages leaves the list alone.
  const home2w = mondayOf(today);
  const homeMonth = firstOfMonth(today);
  const [expanded, setExpanded] = useState(false);
  const [start2w, setStart2w] = useState(home2w);
  const [month, setMonth] = useState(homeMonth);
  const [tlView, setTlView] = useState<{ from: IsoDate; to: IsoDate; todayVisible: boolean } | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [picked, setPicked] = useState<IsoDate | null>(null);
  const [hl, setHl] = useState<IsoDate | null>(null);
  const [toggled, setToggled] = useState<ReadonlySet<Id>>(new Set());
  const scroll = useRef<ScrollView>(null);
  const anchors = useRef(new Map<IsoDate, number>());
  const [listH, setListH] = useState(0);

  // View state from the URL (all builds, also deep links on iOS): ?view=timeline|calendar, ?cal=month (or 5w),
  // ?page=N (calendar pages from today's), ?day=YYYY-MM-DD (as if tapped), ?scroll=YYYY-MM-DD (timeline scrolled there).
  const params = useLocalSearchParams<{ view?: string; cal?: string; day?: string; page?: string; scroll?: string }>();
  const tlScroll = typeof params.scroll === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.scroll) ? params.scroll : null;
  useEffect(() => {
    const v = params.view === 'timeline' ? 'tl' : params.view === 'calendar' ? 'cal' : null;
    if (v) setMode(v);
    else void AsyncStorage.getItem(MODE_KEY).then((m) => (m === 'tl' || m === 'cal') && setMode(m));
    const month1 = params.cal === '5w' || params.cal === 'month';
    if (month1) setExpanded(true);
    const n = Number(params.page ?? 0);
    if (Number.isInteger(n) && n !== 0) {
      if (month1) setMonth(addMonths(firstOfMonth(today), n));
      else setStart2w(addDays(mondayOf(today), 14 * n));
    }
    const day = typeof params.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : null;
    if (day) {
      const id = setTimeout(() => pickRef.current(day), 800);
      return () => clearTimeout(id);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.view, params.cal, params.day, params.page]);
  const switchMode = (m: Mode) => {
    setMode(m);
    void AsyncStorage.setItem(MODE_KEY, m);
  };

  // Expanded: the nearest deadline from today on, the picked day's deadlines, and whatever was tapped (a tap flips it).
  const base = new Set<Id>();
  const def = defaultExpanded(items);
  if (def) base.add(def);
  if (hl) for (const i of items) if (i.date === hl) base.add(i.round.id);
  const open = new Set([...base].filter((id) => !toggled.has(id)));
  for (const id of toggled) if (!base.has(id)) open.add(id);
  const toggle = (id: Id) => setToggled((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  const pick = (d: IsoDate) => {
    setPicked(d);
    const target = items.find((i) => i.date >= d)?.date ?? items.at(-1)?.date ?? null;
    setHl(target);
    setToggled(new Set());
    if (!target) return;
    setTimeout(() => {
      const y = anchors.current.get(target);
      if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y), animated: true });
    }, 30);
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const page: CalPage = expanded ? { kind: 'month', first: month } : { kind: 'weeks', start: start2w };
  const turn = (dir: 1 | -1) => (expanded ? setMonth((m) => addMonths(m, dir)) : setStart2w((d) => addDays(d, 14 * dir)));
  // Expanding opens the month of the two weeks shown; collapsing stops at the two weeks holding the
  // picked day in that month, else the month's first week (this week when it is today's month).
  const toggleCal = () => {
    if (!expanded) {
      setMonth(firstOfMonth(start2w === home2w ? today : start2w));
      setExpanded(true);
      return;
    }
    if (picked && picked.slice(0, 7) === month.slice(0, 7)) setStart2w(mondayOf(picked));
    else setStart2w(month === homeMonth ? home2w : mondayOf(month));
    setExpanded(false);
  };
  // The one 今天 button: shown while the calendar or timeline is away from today or the list was moved by a pick.
  const away = hl !== null || (mode === 'cal' ? (expanded ? month !== homeMonth : start2w !== home2w) : tlView ? !tlView.todayVisible : false);
  const goToday = () => {
    setStart2w(home2w);
    setMonth(homeMonth);
    setResetKey((k) => k + 1);
    setPicked(null);
    setHl(null);
    scroll.current?.scrollTo({ y: 0, animated: true });
  };

  const parts: string[] = [];
  if (sub.overdue) parts.push(t('home.v3.overdueCount', { n: sub.overdue }));
  if (sub.today) parts.push(t('home.v3.dueToday', { n: sub.today }));
  if (sub.tomorrow) parts.push(t('home.v3.dueTomorrow', { n: sub.tomorrow }));
  if (!parts.length) parts.push(t('home.m.week', { n: sub.week }));
  const range = mode === 'cal' ? pageRange(page) : (tlView ?? { from: addDays(today, -TL_BACK), to: addDays(today, 25) });

  return (
    <View style={styles.root} testID="page-home">
      <View>
        <View style={styles.top}>
          <Text color="textTertiary" tight style={{ fontSize: 14 }}>
            {dateLine(today, locale)}
          </Text>
          <AvatarMenu />
        </View>
        <View style={styles.hd}>
          <Text weight="semibold" style={styles.h1}>
            {count ? t('home.hi', { n: count }) : t('home.m.noneTitle')}
          </Text>
          <Text color="textSecondary" style={styles.sub}>
            {parts.join(t('home.m.sep'))}
            {materials ? (
              <>
                {t('home.m.sep')}
                <Text color="info" style={{ fontSize: 15 }} onPress={() => go({ view: 'inbox' })} testID="mine-confirm">
                  {t('home.v3.materials', { n: materials })}
                </Text>
              </>
            ) : null}
          </Text>
        </View>
      </View>
      <View style={styles.vr}>
        <Text weight="semibold" tight numberOfLines={1} style={styles.vt}>
          {rangeTitle(range.from, range.to, today, locale)}
        </Text>
        {away ? (
          <Pressable accessibilityRole="button" onPress={goToday} style={styles.today} testID="mine-today">
            <Text weight="medium" tight style={{ fontSize: 14 }}>
              {t('home.v3.today')}
            </Text>
          </Pressable>
        ) : null}
        <View style={{ width: 136 }}>
          <Segmented<Mode>
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'cal', label: t('home.v3.cal') },
              { value: 'tl', label: t('home.v3.tl') },
            ]}
          />
        </View>
      </View>
      {mode === 'cal' ? (
        <MineCalendar items={items} page={page} onSwipe={turn} onToggle={toggleCal} onPick={pick} picked={picked} />
      ) : (
        <MineTimeline items={items} onPick={pick} picked={picked} resetKey={resetKey} onView={setTlView} scrollTo={tlScroll} />
      )}
      {hl ? (
        <View style={styles.pin}>
          <Text weight="semibold" tight style={{ fontSize: 20, letterSpacing: -0.4 }}>
            {monthLabel(hl, today, locale)}
          </Text>
        </View>
      ) : null}
      {/* Room below the last day so any picked day can scroll to the top. */}
      <ScrollView ref={scroll} style={styles.root} contentContainerStyle={{ paddingBottom: hl ? Math.max(space[4], listH - 120) : space[4] }} onLayout={(e) => setListH(e.nativeEvent.layout.height)}>
        {items.length === 0 ? (
          <View style={styles.empty}>
            <Text color="textTertiary" style={{ fontSize: 14 }}>
              {t('home.v3.none')}
            </Text>
            <Button variant="primary" label={t('nav.newProject')} onPress={() => go({ view: 'newProject' })} testID="mine-new-project" />
          </View>
        ) : (
          <Agenda items={items} open={open} onToggle={toggle} hl={hl} onAnchor={(d, y) => anchors.current.set(d, y)} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: { height: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4, paddingHorizontal: space[5] },
  hd: { paddingHorizontal: space[5] },
  h1: { fontSize: 26, lineHeight: 31, letterSpacing: -0.52 },
  sub: { fontSize: 15, lineHeight: 22, marginTop: 3 },
  vr: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 12, paddingBottom: 6, paddingHorizontal: space[5] },
  vt: { flex: 1, fontSize: 16, letterSpacing: -0.45 },
  today: { backgroundColor: colors.surface, borderRadius: 9, paddingHorizontal: 9, height: 32, justifyContent: 'center' },
  pin: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space[5], backgroundColor: colors.bg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  empty: { paddingHorizontal: space[5], paddingTop: space[4], gap: space[3], alignItems: 'flex-start' },
});
