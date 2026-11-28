/**
 * Phone 待确认 (mobile-v1 04): 全部接受 (with a confirm), the big title, one line on what this is,
 * then one card per item, grouped by project when several have items. An extract card: type tag,
 * project, ⓘ (how it was found), the text, the source quote, the deadline button (change the
 * date) and 忽略 / 接受. Conflicts, questions and proposals keep their full cards.
 */
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Sheet, Text, TextField } from '@/components/ui';
import { useApp } from '@/state';
import { colors, radius, space } from '@/theme';
import { clip, currentOrLatestRound, projectRounds, type Id, type IsoDate } from '@meetless/core';
import { acceptAllPlan, acceptAnswer, confirmPanelVM, extractCommand, extractVM, type ConfirmItem, type ExtractEntry } from '../model/confirm';
import { runCmds } from '../model/run';
import { useHeaderActions } from '@/shell/chrome';
import { ConflictItem, ProposalItem, QuestionItem, useAnswer } from '../ConfirmScreen';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const XT_KEY = { new: 'ask.xt.new', hyp: 'ask.xt.hyp', rev: 'ask.xt.rev', action: 'ask.xt.action' } as const;

function itemProject(i: ConfirmItem, s: ReturnType<typeof useApp>['live']): Id {
  switch (i.kind) {
    case 'conflict':
      return i.conflict.projectId;
    case 'extract':
      return i.input.projectId;
    case 'proposal':
      return i.proposal.projectId;
    case 'question':
      return i.question.projectId;
  }
  void s;
}

function ExtractCard({ item, due, setDue, onDone, showProject }: { item: ExtractEntry; due: IsoDate | null | undefined; setDue: (d: IsoDate | null | undefined) => void; onDone: (l: string) => void; showProject: boolean }) {
  const { t, live, today, fmtDay } = useApp();
  const a = useAnswer(onDone);
  const vm = extractVM(live, item);
  const { input, extract: x } = item;
  const [info, setInfo] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState('');
  const pid = input.projectId;
  const rounds = projectRounds(live, pid).filter((r) => r.status !== 'delivered');
  const chosen = due === undefined ? vm.due : due;
  const target = chosen ? rounds.find((r) => r.due === chosen) : currentOrLatestRound(live, pid);
  const dateLabel = chosen && !target ? `${fmtDay(chosen)} ${t('cfm.newDeadline')}` : target ? `${target.title || t('round', { n: target.n })} ${fmtDay(target.due)}` : t('round.none');
  const para = x.paraId ? input.body.find((p) => p.id === x.paraId)?.text : null;
  const who = input.from?.name ?? (input.from?.userId ? live.users[input.from.userId]?.displayName : null);
  const revNeed = vm.revNeedId ? live.needs[vm.revNeedId] : null;
  const what = clip(vm.text, 60);
  return (
    <View testID="ask-item" style={styles.card}>
      <View style={styles.ctop}>
        <View style={styles.meta}>
          <View style={styles.tag}>
            <Text size="xs" weight="medium" color="textSecondary" tight>
              {t(XT_KEY[vm.type])}
            </Text>
          </View>
          {showProject ? (
            <Text size="sm" color="textTertiary" numberOfLines={1} style={{ flexShrink: 1 }}>
              {live.projects[pid]?.name ?? ''}
            </Text>
          ) : null}
        </View>
        <Pressable testID="x-info" accessibilityRole="button" accessibilityLabel="info" hitSlop={8} onPress={() => setInfo((v) => !v)} style={styles.info}>
          <Icon name="info" size={18} color="textTertiary" />
        </Pressable>
      </View>
      {info ? (
        <View style={styles.infoBox}>
          <Text size="xs" color={vm.ai ? 'ai' : 'textSecondary'}>
            {vm.ai ? t('ai.deepseek') : t('in.rules')}
          </Text>
          <Text size="xs" color="textSecondary">
            {t('ask.from', { title: vm.inputTitle })}
          </Text>
          {vm.under ? (
            <Text size="xs" color="textSecondary">
              {t('cfm.under', { what: vm.under.kind === 'need' ? vm.under.code : clip(vm.under.text, 40) })}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Text size="lg" weight="semibold">
        {revNeed ? (
          <Text size="sm" mono color="textTertiary">{`${revNeed.code} `}</Text>
        ) : null}
        {revNeed && vm.text.startsWith(`${revNeed.code} `) ? vm.text.slice(revNeed.code.length + 1) : vm.text}
      </Text>
      {vm.met ? (
        <Text size="xs" color="success">
          {t('ask.alreadyDone')}
        </Text>
      ) : null}
      <View style={styles.quote}>
        <Text size="sm">{para ? `“${para}”` : vm.text}</Text>
        <Text size="xs" color="textTertiary">
          {[who, input.title, fmtDay(input.date)].filter(Boolean).join('  ')}
        </Text>
      </View>
      {picking ? (
        <View style={styles.pick}>
          {rounds.map((r) => (
            <Pressable key={r.id} accessibilityRole="button" onPress={() => (setDue(r.due), setPicking(false))} style={[styles.pickRow, target?.id === r.id && styles.pickOn]}>
              <Text size="md" style={{ flex: 1 }}>
                {r.title || t('round', { n: r.n })}
              </Text>
              <Text size="sm" color="textTertiary">
                {fmtDay(r.due)}
              </Text>
            </Pressable>
          ))}
          <View style={styles.pickDate}>
            <View style={{ flex: 1 }}>
              <TextField placeholder={t('need.datePh')} value={draft} onChangeText={setDraft} />
            </View>
            <Button size="sm" label={t('need.setDate')} disabled={!DAY.test(draft)} onPress={() => (setDue(draft as IsoDate), setPicking(false))} />
          </View>
        </View>
      ) : null}
      <View style={styles.acts}>
        {vm.datable ? (
          <Pressable testID="x-due" accessibilityRole="button" onPress={() => setPicking((p) => !p)} style={styles.dateBtn}>
            <Icon name="calendar" size={15} color="textSecondary" />
            <Text size="sm" numberOfLines={1} style={{ flexShrink: 1 }}>
              {dateLabel}
            </Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }} />
        <Button testID="x-ignore" size="sm" variant="ghost" label={t('ask.ignore')} disabled={a.busy} onPress={() => a.run([extractCommand('ignore', input, x, '')], `${t('ask.ignore')} ${what}`)} />
        <Button testID="x-accept" size="sm" variant="primary" label={t('ask.accept')} disabled={a.busy} onPress={() => a.run(acceptAnswer(live, item, today, chosen), `${t('ask.accept')} ${what}`)} />
      </View>
    </View>
  );
}

export function ConfirmMobile({ projectId }: { projectId: Id | null }) {
  const { t, live, me, today, submit, notify, errorText } = useApp();
  const [done, setDone] = useState<{ id: string; label: string }[]>([]);
  const [dues, setDues] = useState<Map<string, IsoDate | null>>(() => new Map());
  const [asking, setAsking] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const answered = useMemo(() => new Set(done.map((d) => d.id)), [done]);
  const vm = confirmPanelVM(live, me, projectId, today, answered);
  useHeaderActions(vm.bulk > 0 ? [{ text: t('ans.added.acceptAll'), label: t('ans.added.acceptAll'), onPress: () => setAsking(true), testID: 'ask-accept-all' }] : []);
  const groups = useMemo(() => {
    const m = new Map<Id, ConfirmItem[]>();
    for (const i of vm.items) {
      const p = itemProject(i, live);
      m.set(p, [...(m.get(p) ?? []), i]);
    }
    return [...m.entries()];
  }, [vm.items, live]);
  const grouped = projectId === null && groups.length > 1;
  const setDue = (id: string, d: IsoDate | null | undefined) =>
    setDues((m) => {
      const next = new Map(m);
      if (d === undefined) next.delete(id);
      else next.set(id, d);
      return next;
    });
  const acceptAll = async () => {
    const plan = acceptAllPlan(live, vm.items, today, dues);
    setBulkBusy(true);
    try {
      if (await runCmds(plan.cmds, submit)) setDone((d) => [...d, ...plan.ids.map((id) => ({ id, label: t('ans.added.acceptAll') }))]);
    } catch {
      notify('error', errorText('NETWORK'));
    } finally {
      setBulkBusy(false);
      setAsking(false);
    }
  };
  const card = (i: ConfirmItem) => {
    const onDone = (label: string) => setDone((d) => [...d, { id: i.id, label }]);
    const pid = itemProject(i, live);
    switch (i.kind) {
      case 'extract':
        return <ExtractCard key={i.id} item={i} due={dues.has(i.id) ? dues.get(i.id) : undefined} setDue={(d) => setDue(i.id, d)} onDone={onDone} showProject={projectId === null && !grouped} />;
      case 'conflict':
        return <ConflictItem key={i.id} item={i} projectId={pid} onDone={onDone} />;
      case 'question':
        return <QuestionItem key={i.id} item={i} projectId={pid} onDone={onDone} />;
      case 'proposal':
        return <ProposalItem key={i.id} item={i} projectId={pid} onDone={onDone} />;
    }
  };
  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 600);
  };
  return (
    <View style={styles.root} testID="page-confirm">
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <Text size="md" color="textSecondary" style={styles.intro}>
          {vm.items.length === 0 ? t('ask.empty') : t('cfm.intro', { n: vm.items.length })}
        </Text>
        <View style={styles.cards}>
          {grouped
            ? groups.map(([pid, items]) => (
                <View key={pid} style={{ gap: space[3] }}>
                  <Text size="sm" weight="medium" color="textSecondary" style={{ paddingHorizontal: space[1] }}>
                    {live.projects[pid]?.name ?? ''}
                  </Text>
                  {items.map(card)}
                </View>
              ))
            : vm.items.map(card)}
          {vm.waiting.map((w) => (
            <View key={w.conflict.id} style={styles.muted} testID="ask-waiting">
              <Text size="sm">{t('cf.q', { need: w.code ?? t('common.missingText') })}</Text>
              <Text size="xs" color="textSecondary">
                {t('ask.waiting', { who: w.decider })}
              </Text>
            </View>
          ))}
          {done.map((d) => (
            <View key={d.id} style={styles.muted} testID="ask-done">
              <Text size="sm" color="success">{`✓ ${t('ask.answered')}  ${d.label}`}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      <Sheet
        open={asking}
        onClose={() => setAsking(false)}
        title={t('cfm.acceptAllQ', { n: vm.bulk })}
        footer={
          <>
            <Button label={t('common.cancel')} variant="ghost" onPress={() => setAsking(false)} />
            <Button testID="ask-accept-all-ok" label={t('ans.added.acceptAll')} variant="primary" busy={bulkBusy} onPress={acceptAll} />
          </>
        }
      >
        <Text size="sm" color="textSecondary">
          {t('cfm.acceptAllSub')}
        </Text>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: 120 },
  intro: { paddingHorizontal: space[5], paddingTop: space[1], paddingBottom: space[4] },
  cards: { paddingHorizontal: space[4], gap: space[3] },
  card: { backgroundColor: colors.textInverse, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  ctop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 1 },
  tag: { backgroundColor: colors.surface, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  info: { width: 28, height: 28, alignItems: 'flex-end', justifyContent: 'center' },
  infoBox: { gap: 2, padding: space[3], borderRadius: radius.md, backgroundColor: colors.surface },
  quote: { backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  acts: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  dateBtn: { height: 36, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, borderColor: colors.borderStrong, flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '58%' },
  pick: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[4], paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pickOn: { backgroundColor: colors.selected },
  pickDate: { flexDirection: 'row', alignItems: 'center', gap: space[2], padding: space[3] },
  muted: { padding: space[3], borderRadius: radius.md, backgroundColor: colors.surface, gap: 2 },
});
