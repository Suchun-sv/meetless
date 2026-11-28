import { useMemo, useRef } from 'react';
import { PanResponder, Pressable, StyleSheet, View } from 'react-native';
import type { IsoDate } from '@meetless/core';
import { Icon, Text } from '@/components/ui';
import { useApp } from '@/state';
import { colors, space } from '@/theme';
import { URGENCY } from '@/ui/urgency';
import { calendarPage, clipSpan, dayOfMonth, monthName, spansInWeek, type AgendaItem, type CalPage } from '../../model/mine';
import { Stripes } from './parts';

/** Days outside the month page (expanded view). No theme token yet. */
const OUT = colors.otherMonth;

/**
 * Mon to Sun, one page at a time: two weeks collapsed, a month expanded; swipe left or right to
 * turn the page (the list stays put). Today is a filled dark circle, a picked day gets a ring; a
 * deadline day has a dot per deadline (three and a 「+」 at most) and, when overdue or within a
 * week, a red or orange tint; the 1st reads 「1月」; spans run as a striped strip.
 */
export function MineCalendar({ items, page, onSwipe, onToggle, onPick, picked }: { items: AgendaItem[]; page: CalPage; onSwipe: (dir: 1 | -1) => void; onToggle: () => void; onPick: (d: IsoDate) => void; picked: IsoDate | null }) {
  const { t, today, locale } = useApp();
  const rows = calendarPage(items, today, page);
  const swipe = useRef(onSwipe);
  swipe.current = onSwipe;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_e, g) => {
          if (g.dx < -40) swipe.current(1);
          else if (g.dx > 40) swipe.current(-1);
        },
      }),
    [],
  );
  const expanded = page.kind === 'month';
  return (
    <View style={styles.wrap} testID="mine-calendar">
      <View style={styles.row}>
        {t('home.v3.wd')
          .split(',')
          .map((d, i) => (
            <Text key={i} color="textTertiary" align="center" tight style={[styles.cell, { fontSize: 12, paddingVertical: 2 }]}>
              {d}
            </Text>
          ))}
      </View>
      <View {...pan.panHandlers} testID="mine-cal-pages">
        {rows.map((week) => (
          <View key={week[0]!.date} style={[styles.row, styles.week]}>
            {week.map((d) => {
              const tint = d.urgency && !d.today ? URGENCY[d.urgency].bg : null;
              const first = dayOfMonth(d.date) === 1;
              const ring = picked === d.date && !d.today && !d.out;
              const fg = d.out ? OUT : d.today ? colors.textInverse : tint ? URGENCY[d.urgency!].fg : d.past ? colors.textTertiary : colors.text;
              return (
                <Pressable key={d.date} accessibilityRole="button" accessibilityLabel={d.date} disabled={d.out} onPress={() => onPick(d.date)} style={styles.cell} testID={`cal-${d.date}`}>
                  <View>
                    {ring ? <View pointerEvents="none" style={styles.ring} /> : null}
                    <View style={[styles.num, first && !d.out && styles.numTag, tint ? { backgroundColor: tint } : null, d.today && styles.today]}>
                      <Text tight weight={first && !d.out ? 'semibold' : tint || d.today ? 'semibold' : 'medium'} style={{ fontSize: first && !d.out ? 12 : 16.5, color: fg }}>
                        {first && !d.out ? monthName(d.date, locale) : String(dayOfMonth(d.date))}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.dots}>
                    {d.deadlines.slice(0, 3).map((x) => (
                      <View key={x.round.id} style={[styles.dot, { backgroundColor: URGENCY[x.urgency].mark }]} />
                    ))}
                    {d.deadlines.length > 3 ? (
                      <Text color="textTertiary" tight style={styles.plus}>
                        +
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
            {spansInWeek(items, week).map(({ item, from, to }) => {
              const c = expanded ? clipSpan(week, from, to) : { from, to };
              if (!c) return null;
              return (
                <View key={item.round.id} pointerEvents="none" style={[styles.span, { left: `${(c.from / 7) * 100}%`, width: `${((c.to - c.from + 1) / 7) * 100}%` }]}>
                  <View style={styles.spanIn}>
                    <Stripes />
                  </View>
                </View>
              );
            })}
          </View>
        ))}
      </View>
      <Pressable accessibilityRole="button" onPress={onToggle} style={styles.toggle} testID="mine-cal-toggle">
        <Text color="textTertiary" tight style={{ fontSize: 12.5 }}>
          {t(expanded ? 'home.v3.collapse2w' : 'home.v3.expandMonth')}
        </Text>
        <View style={expanded ? { transform: [{ rotate: '180deg' }] } : undefined}>
          <Icon name="down" size={13} color="textTertiary" />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space[3], paddingBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  row: { flexDirection: 'row', position: 'relative' },
  week: { height: 39 },
  cell: { flex: 1, alignItems: 'center', paddingTop: 2, zIndex: 1 },
  ring: { position: 'absolute', top: -3.5, left: -3.5, right: -3.5, bottom: -3.5, borderRadius: 13, borderWidth: 1.5, borderColor: colors.text },
  num: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  numTag: { width: 40 },
  today: { backgroundColor: colors.text, borderRadius: 15 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 5, marginTop: 1, zIndex: 2 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  plus: { fontSize: 9, lineHeight: 9 },
  span: { position: 'absolute', bottom: 1, height: 8, paddingHorizontal: 3, zIndex: 0 },
  spanIn: { flex: 1, borderRadius: 4, overflow: 'hidden' },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 2 },
});
