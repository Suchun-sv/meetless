import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Segmented, Text } from '@/components/ui';
import { useApp, useGo } from '@/state';
import { colors, radius, space } from '@/theme';
import { eventsFor, type Tick } from '../model/events';
import { homeTimeline, type ProjectTone } from '../model/layout';
import { Axis, EventBar, OutLabel, styles as ts, TickDetail, TickRow, TodayLine, TrackScroll, useWidth } from './Track';

const toneColor = (n: ProjectTone) => colors.avatar[n - 1]!;

/** A project-coloured bar fill: the avatar colour, faint, under a solid border of it. */
function Fill({ tone }: { tone: ProjectTone }) {
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: toneColor(tone), opacity: 0.22 }]} />;
}

/**
 * Every round of my projects on one timeline (Home's timeline card): lanes so parallel rounds all
 * show, 「项目名 轮次名」 in its project's colour with a legend, 近 12 周 or 全部, event ticks
 * behind a switch. A bar opens that project's Deliveries at its round.
 */
export function HomeTimeline() {
  const { live, me, t, locale, today } = useApp();
  const go = useGo();
  const [avail, setAvail] = useWidth();
  const [all, setAll] = useState<'window' | 'all'>('window');
  const [showEv, setShowEv] = useState(false);
  const [tick, setTick] = useState<Tick | null>(null);
  const l = homeTimeline(live, t, locale, me, today, avail, all === 'all');
  if (!l)
    return (
      <Text size="sm" color="textSecondary">
        {t('tl.noneHome')}
      </Text>
    );
  const names = new Map(l.projectIds.map((pid) => [pid, live.projects[pid]?.name ?? pid]));
  return (
    <View style={{ gap: space[2] }}>
      <View style={styles.top}>
        <View style={styles.legend}>
          {l.legend.map((p) => (
            <View key={p.projectId} style={styles.key}>
              <View style={[styles.sw, { borderColor: toneColor(p.tone) }]}>
                <Fill tone={p.tone} />
              </View>
              <Text size="xs" color="textSecondary" tight numberOfLines={1}>
                {p.name}
              </Text>
            </View>
          ))}
        </View>
        <Segmented
          size="sm"
          value={all}
          onChange={(v) => setAll(v)}
          options={[
            { value: 'window', label: t('tl.window') },
            { value: 'all', label: t('tl.all') },
          ]}
        />
      </View>
      <EventBar on={showEv} setOn={(v) => (setShowEv(v), setTick(null))} />
      <TrackScroll key={all} width={l.width} scrollTo={l.scrollTo} onWidth={setAvail}>
        <Axis l={l} />
        {showEv ? <TickRow days={eventsFor(live, l.projectIds)} px={l.px} width={l.width} names={names} selected={tick?.date ?? null} onSelect={setTick} /> : null}
        <View style={ts.lanes}>
          {l.lanes.map((lane) => (
            <View key={lane[0]!.key} style={ts.lane} testID="tlm-lane">
              {lane.map((b) => (
                <View key={b.key}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={b.label}
                    onPress={() => go({ view: 'deliveries', projectId: b.item.projectId, round: b.item.round.n })}
                    style={[ts.bar, { left: b.left, width: b.width, borderColor: toneColor(b.item.tone) }]}
                  >
                    <Fill tone={b.item.tone} />
                  </Pressable>
                  <OutLabel b={b} />
                </View>
              ))}
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
  top: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[3] },
  legend: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', columnGap: space[4], rowGap: space[2] },
  key: { flexDirection: 'row', alignItems: 'center', gap: space[2], maxWidth: 220 },
  sw: { width: 12, height: 8, borderRadius: radius.sm, borderWidth: 1, overflow: 'hidden' },
});
