import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Id } from '@meetless/core';
import { useApp } from '@/state';
import { colors, space } from '@/theme';
import { eventsFor, type Tick } from '../model/events';
import { projectTimeline } from '../model/layout';
import { Axis, EventBar, OutLabel, styles as ts, TickDetail, TickRow, TodayLine, TrackScroll, useWidth } from './Track';

/**
 * A project's DDLs as a gantt with a today line: diamonds on their own strip above the bars
 * (a deadline red, a check-in outlined, planned ones faded), overlapping DDLs in lanes, the
 * current round filled. Tapping a bar selects it (`onSelect`), tapping it again clears it.
 */
export function ProjectTimeline({ projectId, selected = null, onSelect, events }: { projectId: Id; selected?: number | null; onSelect?: (n: number | null) => void; events?: 'on' | 'off' }) {
  const { live, t, locale, today, fmtDay } = useApp();
  const [avail, setAvail] = useWidth();
  const [showEv, setShowEv] = useState(events === 'on');
  const [tick, setTick] = useState<Tick | null>(null);
  const l = projectTimeline(live, t, locale, projectId, today, avail);
  if (!l) return null;
  return (
    <View style={{ gap: space[1] }}>
      {events ? <EventBar on={showEv} setOn={(v) => (setShowEv(v), setTick(null))} /> : null}
      <TrackScroll width={l.width} scrollTo={l.scrollTo} onWidth={setAvail}>
        <Axis l={l} />
        {events && showEv ? <TickRow days={eventsFor(live, [projectId])} px={l.px} width={l.width} selected={tick?.date ?? null} onSelect={setTick} /> : null}
        <View style={styles.ms}>
          {l.milestones.map((m) => (
            <View
              key={m.key}
              accessibilityLabel={m.title}
              style={[styles.diamond, { left: m.x - 5 }, m.kind === 'hard' ? styles.hard : styles.cadence, m.status === 'planned' && { opacity: 0.45 }]}
            />
          ))}
        </View>
        <View style={ts.lanes}>
          {l.lanes.map((lane) => (
            <View key={lane[0]!.key} style={ts.lane}>
              {lane.map((b) => {
                const r = b.item;
                const on = selected === r.n;
                const look = r.status === 'current' ? styles.cur : r.status === 'delivered' ? styles.done : styles.plan;
                return (
                  <View key={b.key}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${b.label} ${fmtDay(r.due)}`}
                      onPress={() => onSelect?.(on ? null : r.n)}
                      style={[ts.bar, look, { left: b.left, width: b.width }, on && styles.on]}
                    >
                    </Pressable>
                    <OutLabel b={b} />
                  </View>
                );
              })}
            </View>
          ))}
          <TodayLine x={l.todayX} />
        </View>
      </TrackScroll>
      <TickDetail tick={tick} onClose={() => setTick(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  ms: { position: 'relative', height: 12, marginTop: space[1] },
  diamond: { position: 'absolute', top: 1, width: 10, height: 10, transform: [{ rotate: '45deg' }], zIndex: 2 },
  hard: { backgroundColor: colors.danger },
  cadence: { backgroundColor: colors.bg, borderWidth: 1.5, borderColor: colors.textSecondary },
  cur: { backgroundColor: colors.text },
  done: { backgroundColor: colors.selected },
  plan: { backgroundColor: 'transparent', borderStyle: 'dashed', borderColor: colors.borderStrong },
  on: { borderWidth: 2, borderColor: colors.text },
});
