/**
 * Phone 项目 › 需求 (mobile-v1 02): 下一步, the current deadline's needs (hypotheses nested), then
 * 其他截止 with the past deadlines and unscheduled needs folded. A row opens the need sheet (03).
 */
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Button, CheckCircle, NeedRow, statusColor, Text } from '@/components/ui';
import { statusCommand } from '../model/edit';
import { runCmds } from '../../confirm/model/run';
import { useApp, useGo } from '@/state';
import { colors, space } from '@/theme';
import { daysLeft, isOpen, type Id, type Need, type NeedStatus } from '@meetless/core';
import { urgencyTone } from '@/ui/urgency';
import { mobileNeedsVM, type DeadlineGroup, type NeedRow as Row, type NextReason } from '../model/mobile';

/** Bottom room for the ask bar and the tab bar (mobile-v1 decision 3). */
export const MOBILE_BOTTOM = 160;

function reasonText(t: ReturnType<typeof useApp>['t'], n: Need, r0: NextReason, name: (id: Id) => string): string {
  const r = n.privateTo !== null ? { ...r0, code: `${r0.code} ${t('pv.mine')}` } : r0;
  switch (r.kind) {
    case 'handoff':
      return `${r.code} ${t('ho.from', { who: name(r.h.fromId) })} ${t(`ho.st.${r.h.state}`)}`;
    case 'notStarted':
      return t('need.notStarted', { code: r.code });
    case 'progress':
      return `${r.code} ${r.text}`;
    case 'status':
      return `${r.code} ${t(`st.${r.status}`)}`;
  }
}

const HYP_MENU: NeedStatus[] = ['testing', 'held', 'refuted'];

/** A hypothesis row (mobile-v1 decision 4): no check circle; its status opens a 验证中 / 已验证 / 已否定 menu. */
function HypLine({ row, onOpen, divider }: { row: Row; onOpen: (n: Need) => void; divider?: boolean }) {
  const { t, submit, notify, errorText } = useApp();
  const n = row.need;
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = async (st: NeedStatus) => {
    setMenu(false);
    if (st === n.status) return;
    setBusy(true);
    try {
      await runCmds([statusCommand(n, st)], submit);
    } catch {
      notify('error', errorText('NETWORK'));
    } finally {
      setBusy(false);
    }
  };
  const done = n.status === 'held' || n.status === 'met';
  return (
    <View style={[styles.rowPad, { paddingLeft: space[5] + (row.nested ? 32 : 0) }]}>
      <Pressable testID="m-need" accessibilityRole="button" onPress={() => onOpen(n)} style={({ pressed }) => [styles.hrow, divider && styles.hdiv, pressed && { opacity: 0.6 }]}>
        {n.kind === 'ext' ? <CheckCircle needId={n.id} /> : <View style={styles.noCheck} />}
        <Text mono size="sm" color="textTertiary" tight style={styles.hcode}>
          {n.code}
        </Text>
        {n.privateTo !== null ? (
          <Text size="xs" color="textSecondary" tight>
            {t('pv.mine')}
          </Text>
        ) : null}
        <Text size="md" color={done ? 'textTertiary' : 'text'} numberOfLines={1} style={{ flex: 1 }} tight>
          {n.title}
        </Text>
        {n.kind === 'hyp' ? (
          <Pressable testID="m-hyp-status" accessibilityRole="button" disabled={busy} hitSlop={10} onPress={() => setMenu((m) => !m)}>
            <Text size="sm" tight color={statusColor(n.status)}>{`${t(`st.${n.status}`)} ⌄`}</Text>
          </Pressable>
        ) : (
          <Text size="sm" tight color={statusColor(n.status)}>
            {t(`st.${n.status}`)}
          </Text>
        )}
      </Pressable>
      {menu ? (
        <View testID="m-hyp-menu" style={styles.menu}>
          {HYP_MENU.map((st) => (
            <Pressable key={st} accessibilityRole="menuitem" onPress={() => set(st)} style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}>
              <Text size="md" style={{ flex: 1 }}>
                {t(`st.${st}`)}
              </Text>
              {st === n.status ? <Text size="md">✓</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** A need row: an external need is the shell's NeedRow (check circle with undo); a hypothesis is `HypLine`. */
function NeedLine({ row, onOpen, divider }: { row: Row; onOpen: (n: Need) => void; divider?: boolean }) {
  if (row.need.kind === 'hyp' || row.need.privateTo !== null) return <HypLine row={row} onOpen={onOpen} divider={divider} />;
  return (
    <View style={styles.rowPad}>
      <NeedRow testID="m-need" needId={row.need.id} depth={row.nested ? 1 : 0} divider={divider} onPress={() => onOpen(row.need)} />
    </View>
  );
}

type Left = { text: string; color: string } | null;

function SectionHead({ title, right, left }: { title: string; right?: string; left?: Left }) {
  return (
    <View style={styles.secH}>
      <Text size="sm" weight="medium" color="textSecondary" tight style={{ flex: 1 }}>
        {title}
      </Text>
      {left ? (
        <Text size="sm" tight style={{ color: left.color }}>
          {left.text}
        </Text>
      ) : null}
      {right ? (
        <Text size="sm" color="textTertiary" tight>
          {right}
        </Text>
      ) : null}
    </View>
  );
}

function Fold({ label, right, left, children, testID }: { label: string; right?: string; left?: Left; children: React.ReactNode; testID?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((o) => !o)} style={({ pressed }) => [styles.grp, pressed && styles.pressed]}>
        <Text size="md" style={{ flex: 1 }} numberOfLines={1}>
          {label}
        </Text>
        {left ? (
          <Text size="sm" tight style={{ color: left.color }}>
            {left.text}
          </Text>
        ) : null}
        {right ? (
          <Text size="sm" color="textTertiary" tight>
            {right}
          </Text>
        ) : null}
        <Text size="lg" color="textTertiary" tight>
          {open ? '⌄' : '›'}
        </Text>
      </Pressable>
      {open ? <View style={styles.foldBody}>{children}</View> : null}
    </View>
  );
}

export function NeedsMobile({ projectId }: { projectId: Id }) {
  const { t, live, me, today, fmtDay } = useApp();
  const go = useGo();
  const [refreshing, setRefreshing] = useState(false);
  const vm = useMemo(() => mobileNeedsVM(live, me, projectId, today), [live, me, projectId, today]);
  const open = (n: Need) => go({ view: 'board', projectId, needId: n.id });
  const name = (id: Id) => live.users[id]?.displayName ?? id;
  const leftOf = (g: DeadlineGroup): Left => {
    if (!g.round) return null;
    const d = daysLeft(g.round, today);
    const done = g.rows.length > 0 && g.rows.every((r) => !isOpen(r.need));
    return { text: d < 0 ? t('round.over', { n: -d }) : t('round.left', { n: d }), color: urgencyTone(d, done).fg };
  };
  const roundTitle = (g: DeadlineGroup) => (g.round ? g.round.title || t('round', { n: g.round.n }) : t('col.unscheduled'));
  // Live state streams in; pull-to-refresh only gives the gesture its feedback.
  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 600);
  };
  return (
    <ScrollView testID="page-board" style={styles.root} contentContainerStyle={{ paddingBottom: MOBILE_BOTTOM }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {vm.next.length > 0 ? (
        <View style={styles.blk}>
          <SectionHead title={t('need.next')} />
          {vm.next.map((s, i) => (
            <Pressable key={s.need.id} testID="m-next" accessibilityRole="button" onPress={() => open(s.need)} style={({ pressed }) => [styles.row, i > 0 && styles.hair, pressed && styles.pressed]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text size="md" numberOfLines={2}>
                  {s.need.title}
                </Text>
                <Text size="sm" color="textSecondary" numberOfLines={1}>
                  {reasonText(t, s.need, s.reason, name)}
                </Text>
              </View>
              <Text size="lg" color="textTertiary" tight>
                ›
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {!vm.current ? (
        <View style={[styles.blk, styles.empty]}>
          <Text size="md" color="textSecondary">
            {t('need.noDeadline')}
          </Text>
          <Button size="sm" label={t('need.addDeadline')} onPress={() => go({ view: 'rounds', projectId })} />
        </View>
      ) : null}
      <View style={styles.blk}>
        <SectionHead title={vm.current ? vm.current.title || t('round', { n: vm.current.n }) : t('nav.board')} right={vm.current ? fmtDay(vm.current.due) : undefined} left={vm.current ? leftOf({ round: vm.current, rows: vm.rows }) : null} />
        {vm.rows.length === 0 ? (
          <Text size="sm" color="textTertiary" style={styles.pad}>
            {t('col.empty')}
          </Text>
        ) : (
          vm.rows.map((r, i) => <NeedLine key={r.need.id} row={r} onOpen={open} divider={i > 0} />)
        )}
      </View>

      {vm.others.length > 0 || vm.past.length > 0 || vm.unscheduled.length > 0 ? (
        <View style={styles.blk}>
          <SectionHead title={t('need.others')} />
          {vm.others.map((g) => (
            <Fold key={g.round!.id} testID="m-other" label={roundTitle(g)} right={fmtDay(g.round!.due)} left={leftOf(g)}>
              {g.rows.length === 0 ? (
                <Text size="sm" color="textTertiary" style={styles.pad}>
                  {t('col.empty')}
                </Text>
              ) : (
                g.rows.map((r) => <NeedLine key={r.need.id} row={r} onOpen={open} />)
              )}
            </Fold>
          ))}
          {vm.unscheduled.length > 0 ? (
            <Fold label={t('col.unscheduled')} right={t('need.count', { n: vm.unscheduled.length })}>
              {vm.unscheduled.map((r) => (
                <NeedLine key={r.need.id} row={r} onOpen={open} />
              ))}
            </Fold>
          ) : null}
          {vm.past.length > 0 ? (
            <Fold label={t('need.past', { n: vm.past.length })}>
              {vm.past.map((g) => (
                <Fold key={g.round!.id} label={roundTitle(g)} right={fmtDay(g.round!.due)}>
                  {g.rows.map((r) => (
                    <NeedLine key={r.need.id} row={r} onOpen={open} />
                  ))}
                </Fold>
              ))}
            </Fold>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const HAIR = StyleSheet.hairlineWidth;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  blk: { marginTop: space[5] },
  secH: { flexDirection: 'row', gap: space[3], alignItems: 'baseline', paddingHorizontal: space[5], marginBottom: space[1] },
  rowPad: { paddingHorizontal: space[5] },
  hrow: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 44, paddingVertical: 10 },
  hdiv: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderStrong },
  noCheck: { width: 22 - space[1] },
  hcode: { minWidth: 26 },
  menu: { marginLeft: 22 + space[2], borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.textInverse, overflow: 'hidden', marginBottom: space[2] },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space[4], paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pad: { paddingHorizontal: space[5], paddingVertical: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: 10, paddingLeft: space[5], paddingRight: space[5] },
  hair: { borderTopWidth: HAIR, borderTopColor: colors.borderStrong, marginLeft: space[5], paddingLeft: 0 },
  nrow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: 11, paddingHorizontal: space[5] },
  nested: { paddingLeft: space[5] + 24 },
  pressed: { backgroundColor: colors.hover },
  empty: { paddingHorizontal: space[5], gap: space[2], alignItems: 'flex-start' },
  circle: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  circleOn: { backgroundColor: colors.success, borderColor: colors.success },
  code: { width: 28, marginLeft: space[1] },
  title: { flex: 1, minWidth: 0 },
  grp: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: 11, paddingHorizontal: space[5] },
  foldBody: { paddingBottom: space[2] },
});
