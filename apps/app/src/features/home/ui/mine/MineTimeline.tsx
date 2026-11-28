import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { IsoDate } from '@meetless/core';
import { Icon, Text } from '@/components/ui';
import { useApp } from '@/state';
import { colors } from '@/theme';
import { URGENCY } from '@/ui/urgency';
import { addDays, addMonths, dayOfMonth, diffDays, firstOfMonth, monthLabel, monthName, monthOf, TL_PX, timeline, weekdayOf, yearOf, type AgendaItem, type Marker } from '../../model/mine';
import { textPx } from '../../../timeline/model/lanes';
import { Stripes } from './parts';

const H = 112;
const LINE_Y = 62;

/**
 * 14 px a day from two days back to the last deadline, scrolling sideways: month labels, day
 * ticks (Mondays long, with the date), today's line and pill, one marker per day (merged with a
 * count), spans as striped pills above, a black line with 「2027」 where a year begins. A marker
 * picks its day; 「1月起 3 个 ›」 scrolls on. Reports the days in view (for the title and the 今天
 * button); a new `resetKey` scrolls back to today.
 */
export function MineTimeline({ items, onPick, picked, resetKey, onView, scrollTo }: { items: AgendaItem[]; onPick: (d: IsoDate) => void; picked: IsoDate | null; resetKey: number; onView: (v: { from: IsoDate; to: IsoDate; todayVisible: boolean }) => void; scrollTo?: IsoDate | null }) {
  const { t, today, locale } = useApp();
  const tl = timeline(items, today);
  const width = tl.days * TL_PX;
  const ref = useRef<ScrollView>(null);
  const [view, setView] = useState({ x: 0, w: 0 });
  const xOf = (d: IsoDate) => diffDays(tl.from, d) * TL_PX;
  const visibleEnd = addDays(tl.from, Math.floor((view.x + view.w) / TL_PX) - 1);
  const beyond = view.w ? items.filter((i) => !i.span && i.round.due > visibleEnd) : [];
  const todayX = xOf(today) + TL_PX / 2;
  const visibleFrom = addDays(tl.from, Math.max(0, Math.floor(view.x / TL_PX)));
  const todayVisible = !view.w || (todayX >= view.x && todayX <= view.x + view.w);
  const report = useRef(onView);
  report.current = onView;
  useEffect(() => {
    if (view.w) report.current({ from: visibleFrom, to: visibleEnd, todayVisible });
  }, [visibleFrom, visibleEnd, todayVisible, view.w]);
  useEffect(() => {
    if (resetKey) ref.current?.scrollTo({ x: 0, animated: true });
  }, [resetKey]);
  // ?scroll=YYYY-MM-DD: start with that day a little in from the left edge.
  useEffect(() => {
    if (!scrollTo || !view.w) return;
    const id = setTimeout(() => ref.current?.scrollTo({ x: Math.max(0, xOf(scrollTo) - view.w / 2), animated: false }), 50);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTo, view.w > 0]);
  const days = Array.from({ length: tl.days }, (_, i) => addDays(tl.from, i));
  const sel = tl.markers.find((m) => m.date === picked) ?? null;
  // The callout sits on top, sized to its text; a span label it would cover is hidden while it is open.
  const zh = locale.startsWith('zh');
  const bubbleText = sel
    ? sel.items.length > 1
      ? t('home.v3.bubble', { d: `${monthName(sel.date, locale)}${zh ? '' : ' '}${dayOfMonth(sel.date)}${zh ? '日' : ''}`, n: sel.items.length })
      : sel.items[0]!.round.title
    : '';
  const bubbleW = Math.min(240, textPx(bubbleText) + 22);
  const bubbleL = sel ? Math.max(4, Math.min(width - bubbleW - 4, sel.x - bubbleW / 2)) : 0;
  const covered = (x0: number, x1: number) => !!sel && x1 > bubbleL - 4 && x0 < bubbleL + bubbleW + 4;
  return (
    <View style={styles.wrap} onLayout={(e) => setView((v) => ({ ...v, w: e.nativeEvent.layout.width }))} testID="mine-timeline">
      <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} scrollEventThrottle={32} onScroll={(e) => setView((v) => ({ ...v, x: e.nativeEvent.contentOffset.x }))}>
        <View style={{ width, height: H }}>
          {days.map((d, i) => {
            if (dayOfMonth(d) !== 1 && i !== 0) return null;
            const newYear = i > 0 && monthOf(d) === 1;
            return (
              <View key={`m${d}`} pointerEvents="none" style={[styles.month, { left: i === 0 ? 16 : xOf(d) }]}>
                {i > 0 ? <View style={newYear ? styles.yearLine : styles.monthLine} /> : null}
                {newYear ? (
                  <View style={styles.yearTag}>
                    <Text color="textInverse" weight="semibold" tight style={{ fontSize: 11.5 }}>
                      {String(yearOf(d))}
                    </Text>
                  </View>
                ) : null}
                <Text weight="semibold" tight style={styles.monthText}>
                  {monthName(d, locale)}
                </Text>
              </View>
            );
          })}
          <View style={styles.axis} />
          {days.map((d) => {
            const monday = weekdayOf(d) === 1;
            const x = xOf(d) + TL_PX / 2;
            return (
              <View key={`t${d}`} pointerEvents="none">
                <View style={[styles.tick, monday && styles.tickBig, { left: x }]} />
                {monday && Math.abs(x - todayX) > 34 ? (
                  <Text color="textTertiary" tight style={[styles.tickLabel, { left: x - 10 }]}>
                    {String(dayOfMonth(d))}
                  </Text>
                ) : null}
              </View>
            );
          })}
          {tl.spans.map((s) => (
            <View key={s.round.id} pointerEvents="none" style={[styles.span, { left: xOf(s.round.start), width: Math.max(TL_PX, (diffDays(s.round.start, s.round.due) + 1) * TL_PX) }]}>
              <Stripes style={{ borderRadius: 8 }} />
              {covered(xOf(s.round.start), xOf(s.round.start) + 7 + textPx(s.round.title)) ? null : (
                <Text color="textSecondary" weight="semibold" tight numberOfLines={1} style={{ fontSize: 11 }}>
                  {s.round.title}
                </Text>
              )}
            </View>
          ))}
          <View pointerEvents="none" style={[styles.todayLine, { left: todayX - 0.75 }]} />
          <View pointerEvents="none" style={[styles.todayPill, { left: todayX - 20 }]}>
            <Text color="textInverse" weight="semibold" tight align="center" style={{ fontSize: 11 }}>
              {t('home.v3.today')}
            </Text>
          </View>
          {tl.markers.map((m) => (
            <MarkerDot key={m.date} m={m} on={picked === m.date} onPress={() => onPick(m.date)} />
          ))}
          {sel ? (
            <View pointerEvents="none" style={[styles.callout, { left: bubbleL, width: bubbleW, top: LINE_Y - (sel.lane ? 22 : 0) - sel.size / 2 - 30 }]} testID="mine-tl-callout">
              <Text weight="semibold" tight numberOfLines={1} align="center" style={{ fontSize: 12 }}>
                {bubbleText}
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
      {/* The month in view stays labelled at the left edge once its own label has scrolled away. */}
      {view.x > 0 && xOf(addMonths(firstOfMonth(visibleFrom), 1)) - view.x > 70 ? (
        <View pointerEvents="none" style={styles.pinMonth}>
          <Text weight="semibold" tight style={styles.monthText}>
            {monthName(visibleFrom, locale)}
          </Text>
        </View>
      ) : null}
      {beyond.length ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => ref.current?.scrollTo({ x: Math.max(0, xOf(beyond[0]!.round.due) - view.w / 2), animated: true })}
          style={styles.more}
          testID="mine-tl-more"
        >
          <Text color="textSecondary" tight style={{ fontSize: 12 }}>
            {t('home.v3.beyond', { m: monthLabel(beyond[0]!.round.due, today, locale), n: beyond.length })}
          </Text>
          <Icon name="chevron" size={12} color="textSecondary" />
        </Pressable>
      ) : null}
    </View>
  );
}

function MarkerDot({ m, on, onPress }: { m: Marker; on: boolean; onPress: () => void }) {
  const c = URGENCY[m.urgency].mark;
  const y = LINE_Y - (m.lane ? 22 : 0);
  const ring = on ? m.size + 8 : m.size;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={m.date} hitSlop={8} onPress={onPress} style={[styles.mk, { left: m.x - ring / 2, top: y - ring / 2, width: ring, height: ring, borderRadius: ring / 2 }, on && styles.mkOn]}>
      <View style={[{ width: m.size, height: m.size, borderRadius: m.size / 2, alignItems: 'center', justifyContent: 'center' }, m.hollow ? { borderWidth: 1.5, borderColor: colors.success } : { backgroundColor: c }]}>
        {m.items.length > 1 ? (
          <Text color="textInverse" weight="semibold" tight style={{ fontSize: 11.5 }}>
            {String(m.items.length)}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { height: H, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  month: { position: 'absolute', top: 0, bottom: 24, flexDirection: 'row' },
  monthLine: { width: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong, marginRight: 6 },
  monthText: { fontSize: 15, marginTop: 4 },
  pinMonth: { position: 'absolute', left: 16, top: 0, paddingRight: 8, backgroundColor: colors.bg, zIndex: 3 },
  yearLine: { width: 1.5, backgroundColor: colors.text, marginRight: 6 },
  yearTag: { alignSelf: 'flex-start', marginTop: 3, marginRight: 6, backgroundColor: colors.text, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 },
  axis: { position: 'absolute', left: 0, right: 0, top: 82, height: 1, backgroundColor: colors.borderStrong },
  tick: { position: 'absolute', top: 79, width: 1, height: 4, backgroundColor: colors.borderStrong },
  tickBig: { top: 76, height: 10, backgroundColor: colors.textTertiary },
  tickLabel: { position: 'absolute', top: 90, width: 20, textAlign: 'center', fontSize: 11.5 },
  span: { position: 'absolute', top: 30, height: 16, borderRadius: 8, justifyContent: 'center', paddingLeft: 7, overflow: 'hidden' },
  todayLine: { position: 'absolute', top: 22, height: 64, width: 1.5, backgroundColor: colors.text, zIndex: 1 },
  todayPill: { position: 'absolute', top: 89, width: 40, borderRadius: 9999, backgroundColor: colors.text, paddingVertical: 1 },
  mk: { position: 'absolute', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  mkOn: { borderWidth: 1.5, borderColor: colors.text, backgroundColor: colors.bg },
  callout: { position: 'absolute', backgroundColor: colors.textInverse, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3, zIndex: 10, elevation: 10 },
  more: { position: 'absolute', right: 0, top: 2, flexDirection: 'row', alignItems: 'center', gap: 1, paddingLeft: 24, paddingRight: 12, paddingVertical: 2, backgroundColor: colors.bg, zIndex: 3 },
});
