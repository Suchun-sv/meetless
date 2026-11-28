import { Pressable, StyleSheet, View } from 'react-native';
import type { Id, IsoDate } from '@meetless/core';
import { NeedRow, Text } from '@/components/ui';
import { useApp, useGo } from '@/state';
import { colors, space } from '@/theme';
import { URGENCY, mostUrgent } from '@/ui/urgency';
import { dayOfMonth, monthLabel, spanRange, weekdayOf, type AgendaItem } from '../../model/mine';
import { projectColor, Stripes } from './parts';

/*
 * The L1 agenda: one group per day (a 50 pt date column, then a row per deadline with its project
 * colour bar), the 「今天」 line when nothing is due today, a big month header when the month
 * changes, spans as striped rows. Reports where each day sits so the calendar can scroll to it.
 */

type Block = { kind: 'day'; date: IsoDate; items: AgendaItem[] } | { kind: 'now' } | { kind: 'month'; date: IsoDate; count: number };

export function agendaBlocks(items: AgendaItem[], today: IsoDate): Block[] {
  const days: { date: IsoDate; items: AgendaItem[] }[] = [];
  for (const i of items) {
    const last = days.at(-1);
    if (last && last.date === i.date) last.items.push(i);
    else days.push({ date: i.date, items: [i] });
  }
  const dueToday = days.some((d) => d.date === today && d.items.some((i) => !i.span));
  const out: Block[] = [];
  let month = today.slice(0, 7);
  let nowDone = dueToday;
  for (const d of days) {
    if (!nowDone && d.date > today) {
      out.push({ kind: 'now' });
      nowDone = true;
    }
    if (d.date > today && d.date.slice(0, 7) !== month) {
      month = d.date.slice(0, 7);
      out.push({ kind: 'month', date: d.date, count: items.filter((i) => !i.span && i.round.due.slice(0, 7) === d.date.slice(0, 7)).length });
    }
    out.push({ kind: 'day', ...d });
  }
  if (!nowDone) out.push({ kind: 'now' });
  return out;
}

function Progress({ it }: { it: AgendaItem }) {
  const pct = it.total ? Math.round((it.met / it.total) * 100) : 0;
  return (
    <View style={styles.pg}>
      <View style={styles.pb}>
        <View style={{ width: `${pct}%`, height: '100%', borderRadius: 2, backgroundColor: it.done ? colors.success : colors.text }} />
      </View>
      <Text tight style={{ fontSize: 12, color: it.done ? colors.success : colors.textTertiary, fontVariant: ['tabular-nums'] }}>
        {`${it.met}/${it.total}`}
      </Text>
    </View>
  );
}

function Row({ it, open, hl, onToggle }: { it: AgendaItem; open: boolean; hl: boolean; onToggle: () => void }) {
  const { t, locale } = useApp();
  const go = useGo();
  const u = URGENCY[it.urgency];
  if (it.span) {
    return (
      <View style={[styles.ev, hl && styles.hl]} testID="mine-span">
        <View style={styles.bar}>
          <Stripes vertical />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.spanBox}>
            <Stripes light style={{ borderRadius: 8 }} />
            <Text weight="semibold" tight numberOfLines={1} style={{ fontSize: 15, flexShrink: 1 }}>
              {it.round.title}
            </Text>
            <Text color="textSecondary" tight style={{ fontSize: 12.5 }}>
              {`${spanRange(it.round.start, it.round.due, locale)}  ${t('home.v3.days', { n: it.spanDays })}`}
            </Text>
          </View>
          <Text color="textTertiary" tight numberOfLines={1} style={{ fontSize: 13, marginTop: 3 }}>
            {it.projectName}
          </Text>
        </View>
      </View>
    );
  }
  const right = it.done ? t('home.v3.done') : it.daysLeft < 0 ? t('home.v3.past', { n: -it.daysLeft }) : it.daysLeft === 0 ? t('home.v3.dueNow') : t('round.left', { n: it.daysLeft });
  const shown = it.open.slice(0, 2);
  return (
    <View style={[styles.ev, hl && styles.hl]} testID="mine-deadline">
      <View style={[styles.bar, { backgroundColor: projectColor(it.color) }]} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle}>
          <View style={styles.evh}>
            <Text weight="semibold" tight numberOfLines={1} style={{ fontSize: 16, lineHeight: 21, flex: 1 }}>
              {it.round.title || t('round', { n: it.round.n })}
            </Text>
            <Text weight="semibold" tight style={{ fontSize: 13.5, color: u.fg }}>
              {right}
            </Text>
          </View>
          <View style={styles.evs}>
            <Text color="textTertiary" tight numberOfLines={1} style={{ fontSize: 13, flexShrink: 1 }}>
              {it.projectName}
            </Text>
            <Progress it={it} />
          </View>
        </Pressable>
        {open && shown.length ? (
          <View style={{ marginTop: 4 }}>
            {shown.map((n) => (
              <NeedRow key={n.id} needId={n.id} onPress={() => go({ view: 'board', projectId: it.projectId, needId: n.id })} testID="mine-need" />
            ))}
            {it.open.length > 2 ? (
              <Pressable accessibilityRole="link" onPress={() => go({ view: 'board', projectId: it.projectId })} style={{ paddingLeft: 30, paddingTop: 1 }}>
                <Text color="textTertiary" tight style={{ fontSize: 13.5 }}>
                  {t('home.m.more', { n: it.open.length - 2 })}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function DateCol({ date, items, hl }: { date: IsoDate; items: AgendaItem[]; hl: boolean }) {
  const { t, today } = useApp();
  const live = items.filter((i) => !i.span);
  const u = live.length ? URGENCY[mostUrgent(live.map((i) => i.urgency))] : null;
  const days = live[0]?.daysLeft ?? null;
  const rel = days === null ? null : days < 0 ? t('home.v3.overdue') : days === 0 ? t('home.v3.today') : days === 1 ? t('home.v3.tomorrow') : days === 2 ? t('home.v3.dayAfter') : null;
  const isToday = date === today && live.length > 0;
  return (
    <View style={styles.agd}>
      {isToday ? (
        <View style={styles.todayNum}>
          <Text color="textInverse" weight="semibold" tight style={{ fontSize: 17 }}>
            {String(dayOfMonth(date))}
          </Text>
        </View>
      ) : (
        <Text weight="semibold" tight style={{ fontSize: 21, letterSpacing: -0.4, color: hl && u ? u.fg : colors.text }}>
          {String(dayOfMonth(date))}
        </Text>
      )}
      <Text color="textTertiary" tight style={{ fontSize: 11.5, marginTop: 2 }}>
        {t('home.v3.wk').split(',')[weekdayOf(date)]}
      </Text>
      {rel && u ? (
        <Text weight="semibold" tight style={{ fontSize: 11.5, marginTop: 1, color: u.fg }}>
          {rel}
        </Text>
      ) : null}
    </View>
  );
}

export function Agenda({ items, open, onToggle, hl, onAnchor }: { items: AgendaItem[]; open: ReadonlySet<Id>; onToggle: (id: Id) => void; hl: IsoDate | null; onAnchor: (date: IsoDate, y: number) => void }) {
  const { t, today, locale } = useApp();
  const blocks = agendaBlocks(items, today);
  return (
    <View>
      {blocks.map((b, i) => {
        const sep = i > 0 ? styles.sep : null;
        if (b.kind === 'now')
          return (
            <View key="now" style={[styles.now, sep]} onLayout={(e) => onAnchor(today, e.nativeEvent.layout.y)} testID="mine-now">
              <View style={styles.nowPill}>
                <Text color="textInverse" weight="semibold" tight style={{ fontSize: 12 }}>
                  {t('home.v3.todayPill', { d: dayOfMonth(today), w: t('home.v3.wk').split(',')[weekdayOf(today)]! })}
                </Text>
              </View>
              <Text color="textTertiary" tight style={{ fontSize: 13 }}>
                {t('home.v3.noneToday')}
              </Text>
              <View style={styles.nowLine} />
            </View>
          );
        if (b.kind === 'month')
          return (
            <View key={`m${b.date}`} style={[styles.month, sep]}>
              <Text weight="semibold" tight style={{ fontSize: 28, letterSpacing: -0.56 }}>
                {monthLabel(b.date, today, locale)}
              </Text>
              <Text color="textTertiary" tight style={{ fontSize: 13.5 }}>
                {t('home.v3.monthCount', { n: b.count })}
              </Text>
            </View>
          );
        const isHl = hl === b.date;
        return (
          <View key={b.date} style={[styles.ag, blocks[i - 1]?.kind === 'day' ? styles.sep : null]} onLayout={(e) => onAnchor(b.date, e.nativeEvent.layout.y)}>
            <DateCol date={b.date} items={b.items} hl={isHl} />
            <View style={styles.agb}>
              {b.items.map((it) => (
                <Row key={it.round.id} it={it} open={open.has(it.round.id)} hl={isHl} onToggle={() => onToggle(it.round.id)} />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  ag: { flexDirection: 'row', gap: 8, paddingLeft: 14, paddingRight: space[5] },
  agd: { width: 50, alignItems: 'center', paddingTop: 9 },
  todayNum: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  agb: { flex: 1, minWidth: 0, paddingVertical: 4, gap: 0 },
  ev: { flexDirection: 'row', gap: 10, paddingVertical: 6, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 10, borderWidth: 1, borderColor: 'transparent' },
  hl: { backgroundColor: colors.textInverse, borderColor: colors.borderStrong, marginVertical: 3 },
  bar: { width: 4, borderRadius: 2, alignSelf: 'stretch', overflow: 'hidden' },
  evh: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  evs: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 1 },
  pg: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
  pb: { width: 30, height: 4, borderRadius: 2, backgroundColor: colors.surface, overflow: 'hidden' },
  spanBox: { height: 28, borderRadius: 8, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 10 },
  now: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingLeft: 14, paddingRight: space[5] },
  nowPill: { backgroundColor: colors.text, borderRadius: 9999, paddingHorizontal: 9, paddingVertical: 2 },
  nowLine: { flex: 1, height: 1.5, borderRadius: 1, backgroundColor: colors.text },
  month: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingTop: 14, paddingBottom: 4, paddingHorizontal: space[5] },
});
