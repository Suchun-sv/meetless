import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { Id, IsoDate } from '@meetless/core';
import { Text } from '@/components/ui';
import { useApp, useGo } from '@/state';
import { colors, radius, space } from '@/theme';
import { EV_TYPES, placeTicks, type EvType, type EventDay, type Tick, type TimelineEvent } from '../model/events';
import { labelBox, type AxisLabel } from '../model/lanes';
import type { Bar, TimelineLayout } from '../model/layout';

/*
 * Pieces shared by the project and Home timelines: the sideways scroller that starts at today,
 * the axis, the today line, bar labels, the 「显示事件」 switch with its legend, and event ticks.
 */

export const ROW_H = 22;
export const ROW_GAP = space[2];

export const TICK_COLOR: Record<EvType, string> = {
  added: colors.info,
  met: colors.success,
  artifact: colors.warning,
  delivered: colors.text,
  scene: colors.textTertiary,
  agent: colors.ai,
};

/** The container width, measured once laid out (0 before). */
export function useWidth(): [number, (w: number) => void] {
  return useState(0);
}

/** A horizontal scroller over a `width` px track, scrolled once to `scrollTo` when it first gets a width. */
export function TrackScroll({ width, scrollTo, onWidth, children }: { width: number; scrollTo: number; onWidth: (w: number) => void; children: ReactNode }) {
  const ref = useRef<ScrollView>(null);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || scrollTo <= 0) return;
    done.current = true;
    const id = setTimeout(() => ref.current?.scrollTo({ x: scrollTo, animated: false }), 0);
    return () => clearTimeout(id);
  }, [scrollTo]);
  return (
    <View onLayout={(e) => onWidth(Math.floor(e.nativeEvent.layout.width))}>
      <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ width }}>
        <View style={{ width }}>{children}</View>
      </ScrollView>
    </View>
  );
}

function Label({ l, width, strong }: { l: AxisLabel; width: number; strong?: boolean }) {
  const box = labelBox(l.x, l.text, width);
  return (
    <View style={[styles.lbl, { left: box.left - 4, width: box.width + 8 }, strong && styles.today]}>
      <Text size="xs" tight numberOfLines={1} align="center" weight={strong ? 'semibold' : 'regular'} color={strong ? 'text' : 'textTertiary'}>
        {l.text}
      </Text>
    </View>
  );
}

/** The month row (when there is one) and the day row with 「今天」 on top. */
export function Axis<T>({ l }: { l: TimelineLayout<T> }) {
  const { t } = useApp();
  return (
    <>
      {l.axis.months.length > 0 ? (
        <View style={styles.months}>
          {l.axis.months.map((m) => (
            <MonthLabel key={`${m.x}-${m.text}`} l={m} width={l.width} />
          ))}
        </View>
      ) : null}
      <View style={styles.axis}>
        {l.axis.main.map((m) => (
          <Label key={`${m.x}-${m.text}`} l={m} width={l.width} />
        ))}
        {l.todayX >= 0 && l.todayX <= l.width ? <Label l={{ x: l.todayX, text: t('tl.today') }} width={l.width} strong /> : null}
      </View>
    </>
  );
}

function MonthLabel({ l, width }: { l: AxisLabel; width: number }) {
  const box = labelBox(l.x, l.text, width);
  return (
    <View style={[styles.lbl, { left: box.left - 4, width: box.width + 8 }]}>
      <Text size="xs" tight numberOfLines={1} align="center" weight="medium" color="textSecondary">
        {l.text}
      </Text>
    </View>
  );
}

/** The today line over the lanes. */
export function TodayLine({ x }: { x: number }) {
  return <View pointerEvents="none" style={[styles.todayLine, { left: x }]} />;
}

/** A bar's label beside it (right, or left when the right has no room), above the today line. */
export function OutLabel<T>({ b }: { b: Bar<T> }) {
  if (b.labelAt === 'none') return null;
  return (
    <View pointerEvents="none" style={[styles.out, { left: b.labelX, width: b.labelW }, b.labelAt === 'left' && { alignItems: 'flex-end' }]}>
      <Text size="xs" color="textSecondary" tight numberOfLines={1} style={styles.outText}>
        {b.label}
      </Text>
    </View>
  );
}

/** The 「显示事件」 switch, and the event legend while it is on. */
export function EventBar({ on, setOn }: { on: boolean; setOn: (v: boolean) => void }) {
  const { t } = useApp();
  return (
    <View style={styles.evbar}>
      <Pressable testID="tl-events" accessibilityRole="switch" accessibilityState={{ checked: on }} onPress={() => setOn(!on)} hitSlop={8} style={styles.sw}>
        <View style={[styles.track, on && styles.trackOn]}>
          <View style={[styles.knob, on && styles.knobOn]} />
        </View>
        <Text size="xs" color="textSecondary" tight>
          {t('ev.show')}
        </Text>
      </Pressable>
      {on
        ? EV_TYPES.map((k) => (
            <View key={k} style={styles.lg}>
              <View style={[styles.lgTick, { backgroundColor: TICK_COLOR[k] }]} />
              <Text size="xs" color="textSecondary" tight>
                {t(`ev.${k}`)}
              </Text>
            </View>
          ))
        : null}
    </View>
  );
}

/** Opens what an event is about: the need, the artifact, the delivery or the input. */
export function useOpenEvent(): (ev: TimelineEvent) => void {
  const go = useGo();
  return (ev) => {
    const g = ev.target;
    if ('need' in g) go({ view: 'board', projectId: ev.projectId, needId: g.need });
    else if ('artifact' in g) go({ view: 'artifacts', projectId: ev.projectId, focusId: g.artifact });
    else if ('round' in g) go({ view: 'deliveries', projectId: ev.projectId, round: g.round });
    else go({ view: 'inputs', projectId: ev.projectId, focusId: g.input });
  };
}

/** The tick strip: a thin line per day (a count when several). Tapping a tick lists its events under the track. */
export function TickRow({ days, px, width, names, selected, onSelect }: { days: EventDay[]; px: (d: IsoDate) => number; width: number; names?: Map<Id, string>; selected: IsoDate | null; onSelect: (tick: Tick | null) => void }) {
  const { t } = useApp();
  const ticks = placeTicks(t, days, px, width, names);
  return (
    <View style={styles.ticks}>
      {ticks.map((k) => (
        <Pressable
          key={k.date}
          testID="tl-tick"
          accessibilityRole="button"
          accessibilityLabel={k.lines[0]}
          onPress={() => onSelect(selected === k.date ? null : k)}
          style={[styles.tick, { left: k.x - 10 }]}
        >
          <View style={[styles.tickLine, { backgroundColor: TICK_COLOR[k.day.type] }, selected === k.date && { width: 3 }]} />
          {k.day.events.length > 1 ? (
            <Text size="xs" color="textSecondary" tight style={styles.tickN}>
              {k.day.events.length}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

/** The events of the tapped tick, each opening what it is about. */
export function TickDetail({ tick, onClose }: { tick: Tick | null; onClose: () => void }) {
  const { fmtDay } = useApp();
  const open = useOpenEvent();
  if (!tick) return null;
  return (
    <View style={styles.detail}>
      <Pressable onPress={onClose} accessibilityRole="button">
        <Text size="xs" weight="medium" color="textSecondary" tight>
          {fmtDay(tick.date)}
        </Text>
      </Pressable>
      {tick.day.events.slice(0, 6).map((ev, i) => (
        <Pressable key={i} accessibilityRole="link" onPress={() => open(ev)} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.detailRow, hovered && { backgroundColor: colors.hover }]}>
          <View style={[styles.lgTick, { backgroundColor: TICK_COLOR[ev.type] }]} />
          <Text size="xs" tight numberOfLines={1} style={{ flex: 1 }}>
            {tick.lines[i]}
          </Text>
        </Pressable>
      ))}
      {tick.lines.length > 6 ? (
        <Text size="xs" color="textTertiary" tight>
          {tick.lines[6]}
        </Text>
      ) : null}
    </View>
  );
}

export const styles = StyleSheet.create({
  months: { position: 'relative', height: 16 },
  axis: { position: 'relative', height: 18 },
  lbl: { position: 'absolute', top: 0 },
  today: { backgroundColor: colors.bg, zIndex: 4 },
  todayLine: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.text, zIndex: 3 },
  out: { position: 'absolute', top: 3, zIndex: 4 },
  outText: { backgroundColor: colors.bg, maxWidth: '100%' },
  lanes: { position: 'relative', gap: ROW_GAP, paddingTop: space[2] },
  lane: { position: 'relative', height: ROW_H },
  bar: { position: 'absolute', top: 0, height: ROW_H, borderRadius: radius.sm, borderWidth: 1, borderColor: 'transparent', overflow: 'hidden' },
  evbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[3] },
  sw: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  track: { width: 26, height: 14, borderRadius: 7, backgroundColor: colors.borderStrong, padding: 2 },
  trackOn: { backgroundColor: colors.text },
  knob: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.bg },
  knobOn: { transform: [{ translateX: 12 }] },
  lg: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  lgTick: { width: 2, height: 10, borderRadius: 1 },
  ticks: { position: 'relative', height: 18, marginTop: space[1] },
  tick: { position: 'absolute', top: 0, height: 18, width: 20, alignItems: 'center' },
  tickLine: { position: 'absolute', left: 9, top: 1, bottom: 1, width: 2, borderRadius: 1 },
  tickN: { position: 'absolute', left: 13, top: -2, fontSize: 10, lineHeight: 12 },
  detail: { gap: 2, padding: space[2], borderRadius: radius.md, backgroundColor: colors.sidebar },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: 2, borderRadius: radius.sm },
});
