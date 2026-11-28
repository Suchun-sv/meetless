/**
 * Phone need detail sheet (mobile-v1 03): kind and code, title, the status button (its menu), the
 * parent it belongs to, 截止 and 负责人 rows (each opens its picker), 出处原文, 看来龙去脉, 验收标准,
 * 预期 or 结论, and the fixed 交接摘要 with 复制摘要 / 转交 (公开到项目 for an only-me need).
 */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useIsFocused } from 'expo-router';
import { Avatar, Button, Sheet, Text, TextField } from '@/components/ui';
import { useApp, useGo } from '@/state';
import { colors, radius, space, tones } from '@/theme';
import { workFor, type Id, type NeedStatus } from '@meetless/core';
import { drawerVM } from '../model/drawer';
import { statusCommand } from '../model/edit';
import { statusTone } from '../model/board';
import { SHARE_IDLE, shareClick, shareView, type ShareState } from '../model/share';
import { DeadlineEdit, OwnerEdit, ParentEdit, ReviseForm, useBusy } from '../NeedDetail';
import { HandoffBlock } from '../../handoff/HandoffBlock';
import { themeTone } from '../ui/kit';
import { NeedTrailSheet } from '../../lineage/NeedTrail';

const EXT_MENU: NeedStatus[] = ['todo', 'doing', 'partial', 'met', 'moved', 'dropped'];
const HYP_MENU: NeedStatus[] = ['testing', 'held', 'refuted', 'parked'];

export function NeedSheet({ projectId, needId, onClose }: { projectId: Id; needId: Id; onClose: () => void }) {
  const { t, live, me, today, fmtDay, notify, submit, errorText } = useApp();
  const go = useGo();
  const b = useBusy(needId);
  // On native the Stack keeps this screen mounted under the next one: the sheet shows only while it is focused.
  const focused = useIsFocused();
  const [trail, setTrail] = useState(false);
  const vm = useMemo(() => drawerVM(live, me, projectId, needId, today), [live, me, projectId, needId, today]);
  const [menu, setMenu] = useState(false);
  const [pick, setPick] = useState<'deadline' | 'owner' | 'parent' | null>(null);
  const [revising, setRevising] = useState(false);
  const [reason, setReason] = useState<NeedStatus | null>(null);
  const [verdict, setVerdict] = useState('');
  const [share, setShare] = useState<ShareState>(SHARE_IDLE);
  useEffect(() => {
    setMenu(false);
    setPick(null);
    setRevising(false);
    setReason(null);
    setShare(SHARE_IDLE);
    setTrail(false);
  }, [needId]);

  if (!vm) {
    return (
      <Sheet open={focused} onClose={onClose} title={t('dr.missing')}>
        <View />
      </Sheet>
    );
  }
  const n = vm.need;
  const tone = tones[themeTone(statusTone(n.status))];
  const setStatus = async (st: NeedStatus, v?: string) => {
    setMenu(false);
    if (n.kind === 'hyp' && st === 'refuted' && v === undefined) {
      setReason(st);
      setVerdict(n.verdict ?? '');
      return;
    }
    if (st === n.status && v === undefined) return;
    if (await b.run([statusCommand(n, st, v)])) setReason(null);
  };
  const last = workFor(live, n.id).filter((w) => !w.ignored && !w.capture).at(-1);
  const summary = last?.text ?? vm.handoffs[0]?.ask ?? null;
  const copy = async () => {
    const text = [`${n.code} ${n.title}`, t(`st.${n.status}`), vm.round ? `${t('dr.round')} ${vm.round.title || t('round', { n: vm.round.n })} ${fmtDay(vm.round.due)}` : null, summary].filter(Boolean).join('\n');
    const ok = await Clipboard.setStringAsync(text).catch(() => false);
    notify(ok === false ? 'error' : 'info', ok === false ? errorText('NETWORK') : t('cp.copied'));
  };
  const sv = vm.private ? shareView(live, n, share) : null;
  const onShare = async () => {
    try {
      setShare(await shareClick(live, n, share, submit));
    } catch {
      notify('error', errorText('NETWORK'));
    }
  };
  const criteria = n.kind === 'ext' ? n.accept : n.verify;
  const footer = (
    <View style={{ flex: 1, gap: space[3] }}>
      {summary ? (
        <View style={{ gap: 2 }}>
          <Text size="sm" weight="semibold">
            {t('need.summary')}
          </Text>
          <Text size="sm" color="textSecondary" numberOfLines={3}>
            {summary}
          </Text>
        </View>
      ) : null}
      <View style={styles.acts}>
        <Button testID="m-copy" label={t('need.copySummary')} style={styles.act} onPress={copy} />
        {sv ? (
          <Button testID="dr-share" variant="primary" label={t(sv.label)} style={styles.act} disabled={b.busy} onPress={onShare} />
        ) : (
          <Button testID="dr-handoff" variant="primary" label={t('ho.btn')} style={styles.act} onPress={() => go({ view: 'handoff', projectId, needId: n.id })} />
        )}
      </View>
    </View>
  );
  if (trail) return <NeedTrailSheet projectId={projectId} needId={n.id} open={focused} onClose={onClose} onBack={() => setTrail(false)} />;
  return (
    <Sheet
      open={focused}
      onClose={onClose}
      footer={footer}
      header={
        <View style={styles.kind}>
          <Text size="sm" mono color="textSecondary" tight>
            {n.code}
          </Text>
          <Text size="sm" color="textTertiary" tight>
            {t(`kind.${n.kind}`)}
          </Text>
          {vm.private ? (
            <Text size="sm" color="textTertiary" tight>
              {t('pv.mine')}
            </Text>
          ) : null}
        </View>
      }
    >
      <View testID="need-sheet" style={{ gap: space[3] }}>
        <Text size="xl" weight="semibold" tight style={{ fontSize: 23, lineHeight: 30 }}>
          {n.title}
        </Text>
        <View style={styles.stRow}>
          <Pressable testID="m-status" accessibilityRole="button" disabled={b.busy} onPress={() => setMenu((m) => !m)} style={[styles.stBtn, { backgroundColor: tone.bg }]}>
            <Text size="md" weight="semibold" tight style={{ color: tone.fg }}>{`${t(`st.${n.status}`)} ⌄`}</Text>
          </Pressable>
          {vm.parent ? (
            <Pressable accessibilityRole="link" onPress={() => go({ view: 'board', projectId, needId: vm.parent!.id }, { replace: true })} style={{ flexShrink: 1 }}>
              <Text size="sm" color="textSecondary" numberOfLines={1}>
                {t('need.belongs', { code: vm.parent.code, title: vm.parent.title })}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {menu ? (
          <View testID="m-status-menu" style={styles.menu}>
            {(n.kind === 'ext' ? EXT_MENU : HYP_MENU).map((st) => (
              <Pressable key={st} accessibilityRole="menuitem" onPress={() => setStatus(st)} style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}>
                <Text size="md" style={{ flex: 1 }}>
                  {t(`st.${st}`)}
                </Text>
                {st === n.status ? <Text size="md">✓</Text> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
        {reason ? (
          <View style={styles.box}>
            <TextField placeholder={t('need.reasonPh')} value={verdict} onChangeText={setVerdict} />
            <View style={styles.acts}>
              <Button size="sm" variant="ghost" label={t('common.cancel')} onPress={() => setReason(null)} />
              <Button size="sm" variant="primary" label={t('common.save')} disabled={b.busy} onPress={() => setStatus(reason, verdict)} />
            </View>
          </View>
        ) : null}

        <View style={styles.fields}>
          <Pressable testID="m-deadline" accessibilityRole="button" onPress={() => setPick(pick === 'deadline' ? null : 'deadline')} style={styles.f}>
            <Text size="md" color="textSecondary" style={styles.k}>
              {t('dr.round')}
            </Text>
            <View style={styles.v}>
              <Text size="md" numberOfLines={1} style={{ flexShrink: 1 }}>
                {vm.round ? vm.round.title || t('round', { n: vm.round.n }) : t('round.none')}
              </Text>
              {vm.round ? (
                <Text size="md" color="textTertiary">
                  {fmtDay(vm.round.due)}
                </Text>
              ) : null}
            </View>
          </Pressable>
          {pick === 'deadline' ? <DeadlineEdit vm={vm} b={b} /> : null}
          <Pressable testID="m-owner" accessibilityRole="button" onPress={() => setPick(pick === 'owner' ? null : 'owner')} style={styles.f}>
            <Text size="md" color="textSecondary" style={styles.k}>
              {t('own.owner')}
            </Text>
            <View style={styles.v}>
              {n.ownerId ? <Avatar userId={n.ownerId} size="sm" /> : null}
              <Text size="md" color={n.ownerId ? 'text' : 'textTertiary'}>
                {n.ownerId ? (live.users[n.ownerId]?.displayName ?? n.ownerId) : t('own.none')}
              </Text>
            </View>
          </Pressable>
          {pick === 'owner' ? <OwnerEdit n={n} b={b} /> : null}
        </View>

        {vm.source.quote ? (
          <View style={{ gap: space[2] }}>
            <Text size="sm" weight="medium" color="textSecondary">
              {t('need.sourceText')}
            </Text>
            <Pressable
              accessibilityRole="link"
              disabled={!vm.source.inputId}
              onPress={() => go({ view: 'inputs', projectId, focusId: vm.source.inputId! })}
              style={styles.quote}
            >
              <Text size="md">{vm.source.quote}</Text>
              <Text size="xs" color="textTertiary">{`${vm.source.ref}  ${fmtDay(vm.source.date)}`}</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable testID="m-trace" accessibilityRole="link" onPress={() => setTrail(true)} style={styles.trace}>
          <Text size="md" style={{ flex: 1 }}>
            {t('need.trace')}
          </Text>
          <Text size="lg" color="textTertiary" tight>
            ›
          </Text>
        </Pressable>

        <View style={{ gap: space[1] }}>
          <Text size="sm" weight="medium" color="textSecondary">
            {t('dr.accept')}
          </Text>
          {criteria ? (
            <Text size="md">{criteria}</Text>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => setRevising(true)}>
              <Text size="md" color="textTertiary">
                {t('need.noCriteria')}
              </Text>
            </Pressable>
          )}
        </View>
        {n.kind === 'hyp' ? (
          <View style={{ gap: space[1] }}>
            <Text size="sm" weight="medium" color="textSecondary">
              {n.verdict ? t('dr.verdict') : t('dr.expect')}
            </Text>
            <Text size="md" color={n.verdict || n.expect ? 'text' : 'textTertiary'}>
              {n.verdict ?? n.expect ?? t('dr.none')}
            </Text>
          </View>
        ) : null}

        {vm.handoffs.map((h) => (
          <HandoffBlock key={h.id} need={n} h={h} />
        ))}

        <View style={styles.rows}>
          <Pressable testID="m-revise" accessibilityRole="button" accessibilityState={{ expanded: revising }} onPress={() => setRevising((r) => !r)} style={styles.trace}>
            <Text size="md" style={{ flex: 1 }}>
              {t('nn.revise')}
            </Text>
            <Text size="lg" color="textTertiary" tight>
              {revising ? '⌄' : '›'}
            </Text>
          </Pressable>
          {revising ? <ReviseForm n={n} b={b} onDone={() => setRevising(false)} /> : null}
          <Pressable testID="m-parent" accessibilityRole="button" accessibilityState={{ expanded: pick === 'parent' }} onPress={() => setPick(pick === 'parent' ? null : 'parent')} style={styles.trace}>
            <Text size="md" style={{ flex: 1 }}>
              {t('need.parent')}
            </Text>
            <Text size="md" color="textTertiary" numberOfLines={1} style={{ flexShrink: 1 }}>
              {vm.parent ? vm.parent.code : t('dr.none')}
            </Text>
            <Text size="lg" color="textTertiary" tight>
              {pick === 'parent' ? '⌄' : '›'}
            </Text>
          </Pressable>
        </View>
        {pick === 'parent' ? <ParentEdit vm={vm} b={b} /> : null}
      </View>
    </Sheet>
  );
}

const HAIR = StyleSheet.hairlineWidth;
const styles = StyleSheet.create({
  kind: { flexDirection: 'row', alignItems: 'baseline', gap: space[2] },
  stRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], flexWrap: 'wrap' },
  stBtn: { height: 32, paddingHorizontal: 12, borderRadius: radius.full, justifyContent: 'center' },
  menu: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, overflow: 'hidden' },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space[4], paddingVertical: 10, borderBottomWidth: HAIR, borderBottomColor: colors.border },
  pressed: { backgroundColor: colors.hover },
  box: { gap: space[2], padding: space[3], borderRadius: radius.md, backgroundColor: colors.surface },
  fields: { borderTopWidth: HAIR, borderTopColor: colors.borderStrong },
  f: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: 12, borderBottomWidth: HAIR, borderBottomColor: colors.borderStrong },
  k: { width: 88 },
  v: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2], minWidth: 0 },
  quote: { backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  trace: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: 10, borderBottomWidth: HAIR, borderBottomColor: colors.borderStrong },
  acts: { flexDirection: 'row', gap: space[3], justifyContent: 'flex-end' },
  act: { flex: 1, minHeight: 44, borderRadius: 12 },
  rows: { borderTopWidth: HAIR, borderTopColor: colors.borderStrong },
});
