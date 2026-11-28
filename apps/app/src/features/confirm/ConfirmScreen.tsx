/**
 * 待确认: my items (conflicts, questions, detected extracts, agent proposals), 全部接受 over the
 * extracts (parents first, with the due dates as changed here), the conflicts waiting on someone
 * else, and what I answered in this session. An answered item leaves the list at once.
 */
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Card, Pill, Screen, Text, TextField } from '@/components/ui';
import { newId, useApp, useGo } from '@/state';
import { colors, radius, space, useLayout } from '@/theme';
import { ConfirmMobile } from './mobile/ConfirmMobile';
import { clip, type Id, type IsoDate } from '@meetless/core';
import {
  acceptAllPlan,
  acceptAnswer,
  confirmPanelVM,
  conflictVM,
  extractCommand,
  extractVM,
  handoffAnswer,
  ignoreWorkCommand,
  linkCommand,
  newHypCommands,
  parkAnswer,
  proposalCommand,
  proposalRound,
  proposalVM,
  questionVM,
  reviseAnswer,
  staleCommands,
  type ConfirmItem,
  type ConflictEntry,
  type ExtractEntry,
  type ProposalEntry,
  type QuestionEntry,
  type StaleOption,
} from './model/confirm';
import { runCmds, type Cmd } from './model/run';
import { Chip, Row, RulesMark } from '../needs/ui/kit';

type Done = (label: string) => void;
type Answer = { busy: boolean; run: (cmds: readonly Cmd[], label: string) => Promise<void> };

export function useAnswer(onDone: Done): Answer {
  const { submit, notify, errorText } = useApp();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const run = async (cmds: readonly Cmd[], label: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    let ok = false;
    try {
      ok = await runCmds(cmds, submit);
    } catch {
      notify('error', errorText('NETWORK'));
    }
    if (ok) return onDone(label);
    inFlight.current = false;
    setBusy(false);
  };
  return { busy, run };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A need as a left-aligned link: its code and title. */
function NeedLink({ projectId, needId }: { projectId: Id; needId: Id }) {
  const { live } = useApp();
  const go = useGo();
  const n = live.needs[needId];
  if (!n) return null;
  return (
    <Pressable accessibilityRole="link" onPress={() => go({ view: 'board', projectId, needId })} style={styles.link}>
      <Text size="sm" color="textSecondary" style={{ textDecorationLine: 'underline' }}>{`${n.code} ${clip(n.title, 40)}`}</Text>
    </Pressable>
  );
}

/** A revision: the need's code, its current wording struck through, then the new wording (as in the old renderer). */
function RevisionText({ projectId, needId, text }: { projectId: Id; needId: Id; text: string }) {
  const { live } = useApp();
  const go = useGo();
  const n = live.needs[needId];
  const old = n ? ((n.kind === 'ext' ? n.accept : n.expect) ?? n.title) : null;
  return (
    <View style={styles.rev}>
      {n ? (
        <Pressable accessibilityRole="link" onPress={() => go({ view: 'board', projectId, needId })} style={styles.link}>
          <Text size="xs" mono color="textTertiary" tight>
            {n.code}
          </Text>
        </Pressable>
      ) : null}
      {old ? (
        <Text size="sm" color="textTertiary" style={{ textDecorationLine: 'line-through' }}>
          {old}
        </Text>
      ) : null}
      <Text weight="medium">{text}</Text>
    </View>
  );
}

function ExtractItem({ item, projectId, due, setDue, onDone }: { item: ExtractEntry; projectId: Id; due: IsoDate | null | undefined; setDue: (d: IsoDate | null | undefined) => void; onDone: Done }) {
  const { t, live, today } = useApp();
  const a = useAnswer(onDone);
  const vm = extractVM(live, item);
  const what = clip(vm.text, 60);
  const shown = due === undefined ? (vm.due ?? '') : (due ?? '');
  const [draft, setDraft] = useState(shown);
  const bad = draft !== '' && !DAY.test(draft);
  const commit = (v: string) => {
    setDraft(v);
    if (v === '') setDue(null);
    else if (DAY.test(v)) setDue(v as IsoDate);
  };
  return (
    <Card testID="ask-item">
      <Row>
        <Pill label={t(`ask.xt.${vm.type}`)} />
        <View style={{ flex: 1 }} />
        {vm.ai ? <Pill label={t('ai.deepseek')} tone="ai" /> : <RulesMark label={t('ai.rules')} />}
      </Row>
      <Text size="xs" color="textTertiary">
        {t('ask.from', { title: vm.inputTitle })}
      </Text>
      {vm.revNeedId ? <RevisionText projectId={projectId} needId={vm.revNeedId} text={vm.text} /> : <Text weight="medium">{vm.text}</Text>}
      {vm.met ? (
        <Text size="xs" color="success">
          {t('ask.alreadyDone')}
        </Text>
      ) : null}
      {vm.under ? (
        <Text size="xs" color="textSecondary">
          {t('cfm.under', { what: vm.under.kind === 'need' ? vm.under.code : clip(vm.under.text, 40) })}
        </Text>
      ) : null}
      {vm.datable ? (
        <Row>
          <Text size="sm" color="textSecondary">
            {t('ask.due')}
          </Text>
          <View style={{ width: 150 }}>
            <TextField testID="x-due" placeholder={t('need.datePh')} value={draft} onChangeText={commit} editable={!a.busy} error={bad ? ' ' : null} />
          </View>
          {draft ? <Button size="sm" variant="link" label={t('ask.dueClear')} onPress={() => commit('')} /> : null}
        </Row>
      ) : null}
      <Row>
        <Button
          testID="x-accept"
          size="sm"
          variant="primary"
          label={t('ask.accept')}
          disabled={a.busy || bad}
          onPress={() => a.run(acceptAnswer(live, item, today, due), `${t('ask.accept')} ${what}`)}
        />
        <Button testID="x-ignore" size="sm" label={t('ask.ignore')} disabled={a.busy} onPress={() => a.run([extractCommand('ignore', item.input, item.extract, '')], `${t('ask.ignore')} ${what}`)} />
      </Row>
    </Card>
  );
}

export function ConflictItem({ item, projectId, onDone }: { item: ConflictEntry; projectId: Id; onDone: Done }) {
  const { phone } = useLayout();
  const { t, live, me, today } = useApp();
  const a = useAnswer(onDone);
  const vm = conflictVM(live, me, projectId, item);
  const code = vm.code ?? t('common.missingText');
  const [picking, setPicking] = useState(false);
  const [to, setTo] = useState<Id | null>(vm.people[0]?.id ?? null);
  const c = item.conflict;
  const why = vm.why.kind === 'delegated' ? t('cf.whyDelegated', { who: vm.why.who }) : t(vm.why.kind === 'decider' ? 'cf.why' : 'cf.whyOwner');
  const send = () => to && a.run(handoffAnswer(live, projectId, c, to, t('cf.handoffAsk', { need: code }), today), t('ask.waiting', { who: vm.people.find((p) => p.id === to)?.name ?? '' }));
  return (
    <Card testID="ask-item">
      <Row>
        <Pill label={t('cf.title')} tone="warning" />
        <View style={{ flex: 1 }} />
        {phone ? null : <RulesMark label={t('ai.rules')} />}
      </Row>
      <Text weight="medium">{t('cf.q', { need: code })}</Text>
      <View style={styles.sides}>
        <View style={styles.side}>
          <Text size="xs" color="textTertiary">
            {t('cf.old', { need: code })}
          </Text>
          <Text size="sm">{vm.old}</Text>
        </View>
        <View style={[styles.side, styles.sideNew]}>
          <Text size="xs" color="textTertiary">
            {`${t('cf.new')} ${vm.src}`}
          </Text>
          <Text size="sm">{vm.neu}</Text>
        </View>
      </View>
      <Text size="xs" color="textSecondary">
        {why}
      </Text>
      <View style={styles.opts}>
        <Button testID="cf-revise" size="sm" label={t('cf.revise', { need: code })} disabled={a.busy} onPress={() => a.run(reviseAnswer(c), t('cf.resolved.revise', { need: code }))} />
        <View style={styles.opt}>
          <Text size="sm">{t('cf.park', { need: code })}</Text>
          <Row wrap>
            {vm.parkRounds.map((r) => (
              <Chip key={r.id} testID="cf-park" label={r.title || t('round', { n: r.n })} disabled={a.busy} onPress={() => a.run(parkAnswer(c, r.id, newId('n')), t('cf.resolved.park', { need: code }))} />
            ))}
            <Chip testID="cf-park" label={t('cf.parkNone')} disabled={a.busy} onPress={() => a.run(parkAnswer(c, null, newId('n')), t('cf.resolved.park', { need: code }))} />
          </Row>
        </View>
        <Button testID="cf-handoff" size="sm" label={t('cf.handoff')} disabled={a.busy} onPress={() => setPicking((p) => !p)} />
        {picking ? (
          vm.people.length === 0 ? (
            <Text size="sm" color="textTertiary">
              {t('ho.nobody')}
            </Text>
          ) : (
            <View style={styles.opt}>
              <Text size="xs" color="textSecondary">
                {t('cf.pick')}
              </Text>
              <Row wrap>
                {vm.people.map((p) => (
                  <Chip key={p.id} testID="cf-person" label={`${p.name}  ${p.role ?? t('ho.noRole')}`} on={to === p.id} disabled={a.busy} onPress={() => setTo(p.id)} />
                ))}
              </Row>
              <Row>
                <Button testID="cf-send" size="sm" variant="primary" label={t('cf.send')} disabled={a.busy || !to} onPress={send} />
              </Row>
            </View>
          )
        ) : null}
      </View>
    </Card>
  );
}

const STALE_KEY = { park: 'ask.park', drop: 'ask.drop', next: 'ask.next' } as const;

export function QuestionItem({ item, projectId, onDone }: { item: QuestionEntry; projectId: Id; onDone: Done }) {
  const { phone } = useLayout();
  const { t, live, me, fmtDay } = useApp();
  const a = useAnswer(onDone);
  const vm = questionVM(live, projectId, item);
  let body;
  if (vm.kind === 'unlinked') {
    const w = vm.work;
    body = (
      <>
        <Text weight="medium">{t('ask.q.unlinked', { work: clip(w.text, 80) })}</Text>
        <Text size="xs" color="textSecondary">{`${t(`src.${w.src}`)}  ${fmtDay(w.date)}`}</Text>
        {w.why ? (
          <Text size="xs" color="textSecondary">
            {w.why}
          </Text>
        ) : null}
        <Row wrap>
          {vm.suggestion ? (
            <Button testID="q-link" size="sm" variant="primary" label={t('ask.link', { need: vm.suggestion.code })} disabled={a.busy} onPress={() => a.run([linkCommand(w, vm.suggestion!.id)], t('ask.link', { need: vm.suggestion!.code }))} />
          ) : null}
          <Button
            testID="q-new"
            size="sm"
            label={t('ask.newHyp')}
            disabled={a.busy}
            onPress={() => a.run(newHypCommands(w, newId('n'), live.rounds[proposalRound(live, projectId) ?? ''] ?? null, me, t(`src.${w.src}`)), t('ask.newHyp'))}
          />
          <Button testID="q-ignore" size="sm" variant="ghost" label={t('ask.skip')} disabled={a.busy} onPress={() => a.run([ignoreWorkCommand(w)], t('ask.skip'))} />
        </Row>
        {vm.others.length > 0 ? (
          <View style={styles.opt}>
            <Text size="xs" color="textSecondary">
              {t('ask.linkOther')}
            </Text>
            <Row wrap>
              {vm.others.map((n) => (
                <Chip key={n.id} label={`${n.code} ${clip(n.title, 24)}`} disabled={a.busy} onPress={() => a.run([linkCommand(w, n.id)], t('ask.link', { need: n.code }))} />
              ))}
            </Row>
          </View>
        ) : null}
      </>
    );
  } else if (vm.kind === 'stale') {
    const label = (o: StaleOption) => (o === 'next' ? t(STALE_KEY.next, { n: vm.next?.n ?? 0 }) : t(STALE_KEY[o]));
    body = (
      <>
        <Text weight="medium">{t('ask.q.stale', { need: vm.need.code, idle: vm.idle, left: vm.left })}</Text>
        <NeedLink projectId={projectId} needId={vm.need.id} />
        <Row wrap>
          {vm.options.map((o) => (
            <Button key={o} testID={`q-${o}`} size="sm" label={label(o)} disabled={a.busy} onPress={() => a.run(staleCommands(o, vm.need, vm.next), `${vm.need.code} ${label(o)}`)} />
          ))}
        </Row>
      </>
    );
  } else {
    body = (
      <Text size="sm" color="textTertiary">
        {t('common.missingText')}
      </Text>
    );
  }
  return (
    <Card testID="ask-item">
      <Row>
        <View style={{ flex: 1 }} />
        {phone ? null : <RulesMark label={t('ai.rules')} />}
      </Row>
      {body}
    </Card>
  );
}

export function ProposalItem({ item, projectId, onDone }: { item: ProposalEntry; projectId: Id; onDone: Done }) {
  const { t, live } = useApp();
  const a = useAnswer(onDone);
  const vm = proposalVM(live, item);
  const p = vm.proposal;
  const what = clip(p.title, 60);
  return (
    <Card testID="ask-item">
      <Row>
        <Pill label={t('pr.title')} tone="ai" />
        <View style={{ flex: 1 }} />
        <Text size="xs" color="textTertiary">
          {t('pr.by', { who: vm.by, client: vm.client ?? t('src.agent') })}
        </Text>
      </Row>
      <Text weight="medium">{p.title}</Text>
      {p.why ? (
        <Text size="sm" color="textSecondary">
          {p.why}
        </Text>
      ) : null}
      <Row>
        <Button testID="pr-accept" size="sm" variant="primary" label={t('pr.accept')} disabled={a.busy} onPress={() => a.run([proposalCommand('accept', p, newId('n'), proposalRound(live, projectId))], `${t('pr.accept')} ${what}`)} />
        <Button testID="pr-reject" size="sm" label={t('pr.reject')} disabled={a.busy} onPress={() => a.run([proposalCommand('reject', p, '', null)], `${t('pr.reject')} ${what}`)} />
      </Row>
    </Card>
  );
}

function Item({ item, projectId, dues, setDue, onDone }: { item: ConfirmItem; projectId: Id; dues: Map<string, IsoDate | null>; setDue: (id: string, d: IsoDate | null | undefined) => void; onDone: Done }) {
  switch (item.kind) {
    case 'conflict':
      return <ConflictItem item={item} projectId={projectId} onDone={onDone} />;
    case 'question':
      return <QuestionItem item={item} projectId={projectId} onDone={onDone} />;
    case 'extract':
      return <ExtractItem item={item} projectId={projectId} due={dues.has(item.id) ? dues.get(item.id) : undefined} setDue={(d) => setDue(item.id, d)} onDone={onDone} />;
    case 'proposal':
      return <ProposalItem item={item} projectId={projectId} onDone={onDone} />;
  }
}

export function ConfirmScreen({ projectId }: { projectId: Id | null }) {
  const { phone } = useLayout();
  if (phone || projectId === null) return <ConfirmMobile projectId={projectId} />;
  return <ConfirmWide projectId={projectId} />;
}

function ConfirmWide({ projectId }: { projectId: Id }) {
  const { t, live, me, today, submit, notify, errorText } = useApp();
  const [done, setDone] = useState<{ id: string; label: string }[]>([]);
  const [dues, setDues] = useState<Map<string, IsoDate | null>>(() => new Map());
  const [bulkBusy, setBulkBusy] = useState(false);
  const answered = useMemo(() => new Set(done.map((d) => d.id)), [done]);
  const vm = confirmPanelVM(live, me, projectId, today, answered);
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
    }
  };
  return (
    <Screen
      title={t('ask.title')}
      actions={vm.bulk > 0 ? <Button testID="ask-accept-all" size="sm" variant="primary" label={`${t('ans.added.acceptAll')} ${vm.bulk}`} busy={bulkBusy} onPress={acceptAll} /> : null}
    >
      <Text size="sm" color="textSecondary">
        {t('ask.sub')}
      </Text>
      {vm.items.length === 0 ? (
        <View style={styles.empty}>
          <Text color="textSecondary">{t('ask.empty')}</Text>
        </View>
      ) : null}
      {vm.items.map((i) => (
        <Item key={i.id} item={i} projectId={projectId} dues={dues} setDue={setDue} onDone={(label) => setDone((d) => [...d, { id: i.id, label }])} />
      ))}
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'flex-start' },
  rev: { gap: space[1], alignItems: 'flex-start' },
  sides: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  side: { flexGrow: 1, flexBasis: 240, gap: space[1], padding: space[3], borderRadius: radius.md, backgroundColor: colors.surface },
  sideNew: { backgroundColor: colors.warningBg },
  opts: { gap: space[2], alignItems: 'flex-start' },
  opt: { gap: space[2], padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignSelf: 'stretch' },
  empty: { padding: space[6], borderRadius: radius.lg, backgroundColor: colors.surface, alignItems: 'center' },
  muted: { padding: space[3], borderRadius: radius.md, backgroundColor: colors.surface, gap: 2 },
});
