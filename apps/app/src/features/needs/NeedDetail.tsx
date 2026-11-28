/**
 * The need detail: header (with share to project on an only-me need), handoffs, source, details
 * with their edits (status and verdict, owner, deadline, parent, revise), revisions, activity
 * (captures are read-only reference rows), artifacts and children. One busy lock for the whole
 * detail; a submit that throws shows the network notice.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Avatar, Button, Pill, Sheet, Status, Text, TextField } from '@/components/ui';
import { useRouter, type Href } from 'expo-router';
import { newId, routePath, useApp, useGo } from '@/state';
import { colors, radius, space } from '@/theme';
import { clip, type Id, type IsoDate, type Need, type NeedStatus } from '@meetless/core';
import { runCmds, type Cmd } from '../confirm/model/run';
import { drawerVM, type DrawerVM, type WorkRowVM } from './model/drawer';
import { deadlineChoices, deadlineDateCommands, ownerChoices, ownerCommand, parentChoices, parentCommand, reviseCommand, roundCommand, statusChanged, statusChoices, statusCommand } from './model/edit';
import { SHARE_IDLE, shareClick, shareView, type ShareState } from './model/share';
import { HandoffBlock } from '../handoff/HandoffBlock';
import { Chip, KV, Row, RulesMark, Section, themeTone } from './ui/kit';

export type Busy = { busy: boolean; run: (cmds: readonly Cmd[]) => Promise<boolean> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function isDay(d: string): boolean {
  if (!DAY.test(d)) return false;
  const ms = Date.parse(`${d}T12:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === d;
}

/** The detail's one submit lock: `run` submits commands in order; a throw shows the network notice. */
export function useBusy(needId: Id): Busy {
  const { submit, notify, errorText } = useApp();
  const [busy, setBusy] = useState(false);
  useEffect(() => setBusy(false), [needId]);
  const run = async (cmds: readonly Cmd[]) => {
    setBusy(true);
    try {
      return await runCmds(cmds, submit);
    } catch {
      notify('error', errorText('NETWORK'));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function Header({ vm, projectId, b, onClose }: { vm: DrawerVM; projectId: Id; b: Busy; onClose?: () => void }) {
  const { t, live, submit, notify, errorText } = useApp();
  const go = useGo();
  const router = useRouter();
  const n = vm.need;
  const [share, setShare] = useState<ShareState>(SHARE_IDLE);
  const [sharing, setSharing] = useState(false);
  useEffect(() => setShare(SHARE_IDLE), [n.id]);
  const sv = vm.private ? shareView(live, n, share) : null;
  const onShare = async () => {
    setSharing(true);
    try {
      setShare(await shareClick(live, n, share, submit));
    } catch {
      notify('error', errorText('NETWORK'));
    } finally {
      setSharing(false);
    }
  };
  return (
    <View style={{ gap: space[2] }}>
      <Row>
        <Text size="xs" mono color="textTertiary" tight>
          {n.code}
        </Text>
        <Text size="xs" color="textSecondary" tight>
          {t(`kind.${n.kind}`)}
        </Text>
        <View style={{ flex: 1 }} />
        {onClose ? <Button testID="drawer-close" size="sm" variant="ghost" label={t('close')} onPress={onClose} /> : null}
      </Row>
      <Text size="lg" weight="semibold" tight>
        {n.title}
      </Text>
      <Row wrap>
        <Pill label={t(`st.${n.status}`)} tone={themeTone(vm.tone)} />
        {vm.private ? (
          <Text size="xs" color="textSecondary" tight>
            {t('pv.mine')}
          </Text>
        ) : null}
        {n.verdict ? (
          <Text size="xs" color="textSecondary" tight>
            {n.verdict}
          </Text>
        ) : null}
        <Text size="xs" color="textTertiary" tight>
          {t('dr.version', { v: vm.version })}
        </Text>
      </Row>
      {sv ? (
        <View style={{ gap: space[1] }}>
          <Row wrap>
            <Button testID="dr-share" size="sm" variant="primary" label={t(sv.label)} busy={sharing} disabled={b.busy} onPress={onShare} />
          </Row>
          {sv.also.length > 0 || sv.decideFirst ? (
            <Row wrap>
              <Text size="xs" color="textSecondary">
                {sv.also.length > 0 ? t('dr.shareAlso', { codes: sv.also.join(' ') }) : t('dr.decideFirst')}
              </Text>
              <Button size="sm" variant="link" label={t('dr.review')} onPress={() => go({ view: 'confirm', projectId })} />
            </Row>
          ) : null}
        </View>
      ) : (
        <Row wrap>
          <Button testID="dr-handoff" size="sm" variant="primary" label={t('ho.btn')} disabled={b.busy} onPress={() => go({ view: 'handoff', projectId, needId: n.id })} />
          <Button testID="dr-link" size="sm" label={t('lk.btn')} disabled={b.busy} onPress={() => router.push(`${routePath({ view: 'handoff', projectId, needId: n.id })}&mode=link` as Href)} />
          <Button testID="dr-lineage" size="sm" variant="ghost" label={t('view.lineage')} onPress={() => go({ view: 'lineage', projectId, needId: n.id })} />
        </Row>
      )}
      {vm.pendingCount > 0 ? (
        <Row wrap>
          <Text size="xs" color="warning" weight="medium">
            {t('dr.pending', { n: vm.pendingCount })}
          </Text>
          <Button testID="dr-pending" size="sm" variant="link" label={t('dr.review')} onPress={() => go({ view: 'confirm', projectId })} />
        </Row>
      ) : null}
    </View>
  );
}

export function StatusEdit({ n, b }: { n: Need; b: Busy }) {
  const { t } = useApp();
  const [pending, setPending] = useState<NeedStatus | null>(null);
  const [verdict, setVerdict] = useState(n.verdict ?? '');
  useEffect(() => {
    setPending(null);
    setVerdict(n.verdict ?? '');
  }, [n.id]);
  const status = pending ?? n.status;
  // The verdict saves on blur, a moment later: a status chip pressed right after typing (which blurs
  // the field) takes the save over and sends the verdict with the new status.
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);
  const set = async (s: NeedStatus) => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = null;
    if (!statusChanged(n, s, verdict)) return;
    setPending(s);
    await b.run([statusCommand(n, s, verdict)]);
    setPending(null);
  };
  const onVerdict = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = setTimeout(() => {
      blurTimer.current = null;
      if (statusChanged(n, status, verdict)) void b.run([statusCommand(n, status, verdict)]);
    }, 250);
  };
  return (
    <KV label={t('nn.status')}>
      <Row wrap>
        {statusChoices(n).map((s) => (
          <Chip key={s} testID="dr-status" label={t(`st.${s}`)} on={s === status} disabled={b.busy} onPress={() => set(s)} />
        ))}
      </Row>
      {n.kind === 'hyp' ? <TextField testID="dr-verdict" placeholder={t('nn.verdict')} value={verdict} editable={!b.busy} onChangeText={setVerdict} onBlur={onVerdict} /> : null}
    </KV>
  );
}

export function OwnerEdit({ n, b }: { n: Need; b: Busy }) {
  const { t, live } = useApp();
  const [pending, setPending] = useState<{ id: Id | null } | null>(null);
  useEffect(() => setPending(null), [n.id]);
  const owner = pending ? pending.id : n.ownerId;
  const set = async (id: Id | null) => {
    if (id === n.ownerId) return;
    setPending({ id });
    await b.run([ownerCommand(n, id)]);
    setPending(null);
  };
  return (
    <KV label={t('own.owner')}>
      <Row wrap>
        <Chip testID="dr-owner" label={t('own.none')} on={owner === null} disabled={b.busy} onPress={() => set(null)} />
        {ownerChoices(live, n.projectId).map((m) => (
          <Chip key={m.id} testID="dr-owner" label={m.name} on={owner === m.id} disabled={b.busy} onPress={() => set(m.id)} />
        ))}
      </Row>
    </KV>
  );
}

export function DeadlineEdit({ vm, b }: { vm: DrawerVM; b: Busy }) {
  const { t, live, today, fmtDay } = useApp();
  const n = vm.need;
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  useEffect(() => {
    setOpen(false);
    setDate('');
  }, [n.id]);
  const label = vm.round ? `${vm.round.title || t('round', { n: vm.round.n })}  ${fmtDay(vm.round.due)}` : t('round.none');
  const pick = async (roundId: Id | null) => {
    if (await b.run([roundCommand(n, roundId)])) setOpen(false);
  };
  const byDate = async () => {
    const cmds = deadlineDateCommands(live, n, date as IsoDate, today);
    if (!cmds || (await b.run(cmds))) {
      setOpen(false);
      setDate('');
    }
  };
  return (
    <KV label={t('dr.round')}>
      <Row wrap>
        <Text size="sm">{label}</Text>
        {vm.autoRound ? <RulesMark label={t('app.rules')} /> : null}
        <Button testID="dr-round-edit" size="sm" variant="link" label={t('need.change')} onPress={() => setOpen((o) => !o)} />
      </Row>
      {open ? (
        <View testID="dr-round-fix" style={styles.fix}>
          <Row wrap>
            {deadlineChoices(live, n).map((r) => (
              <Chip key={r.id} label={`${r.title || t('round', { n: r.n })}  ${fmtDay(r.due)}`} on={r.id === n.roundId} disabled={b.busy} onPress={() => pick(r.id)} />
            ))}
            <Chip label={t('round.none')} on={n.roundId === null} disabled={b.busy} onPress={() => pick(null)} />
          </Row>
          <Row>
            <View style={{ flex: 1 }}>
              <TextField testID="dr-round-date" placeholder={t('need.datePh')} value={date} onChangeText={setDate} editable={!b.busy} />
            </View>
            <Button size="sm" label={t('need.setDate')} disabled={b.busy || !isDay(date)} onPress={byDate} />
          </Row>
        </View>
      ) : null}
    </KV>
  );
}

export function ParentEdit({ vm, b }: { vm: DrawerVM; b: Busy }) {
  const { t, live } = useApp();
  const go = useGo();
  const n = vm.need;
  const [open, setOpen] = useState(false);
  const choices = useMemo(() => (open ? parentChoices(live, n) : []), [open, live, n]);
  const pick = async (id: Id | null) => {
    if (id === n.parentId || (await b.run([parentCommand(n, id)]))) setOpen(false);
  };
  return (
    <KV label={t('need.parent')}>
      <Row wrap>
        {vm.parent ? (
          <Pressable accessibilityRole="link" onPress={() => go({ view: 'board', projectId: n.projectId, needId: vm.parent!.id })}>
            <Text size="sm" style={{ textDecorationLine: 'underline' }}>{`${vm.parent.code} ${clip(vm.parent.title, 40)}`}</Text>
          </Pressable>
        ) : (
          <Text size="sm" color="textTertiary">
            {t('dr.none')}
          </Text>
        )}
        <Button testID="dr-parent-edit" size="sm" variant="link" label={t('need.change')} onPress={() => setOpen(true)} />
      </Row>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('need.parentPick')}>
        <ParentRow label={t('need.parentNone')} on={n.parentId === null} disabled={b.busy} onPress={() => pick(null)} />
        {choices.map((p) => (
          <ParentRow key={p.id} label={`${p.code}  ${p.title}`} on={p.id === n.parentId} disabled={b.busy} onPress={() => pick(p.id)} />
        ))}
      </Sheet>
    </KV>
  );
}

function ParentRow({ label, on, disabled, onPress }: { label: string; on: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.pick, on && styles.pickOn, (pressed || hovered) && styles.pickHover]}
    >
      <Text size="sm" weight={on ? 'medium' : 'regular'} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ReviseForm({ n, b, onDone }: { n: Need; b: Busy; onDone: () => void }) {
  const { t, today } = useApp();
  const [text, setText] = useState('');
  const [why, setWhy] = useState('');
  const ready = reviseCommand(n, text, why, 'draft', today) !== null;
  const send = async () => {
    const cmd = reviseCommand(n, text, why, newId('rev'), today);
    if (cmd && (await b.run([cmd]))) onDone();
  };
  return (
    <View testID="dr-revise-form" style={styles.fix}>
      <TextField testID="nn-revise-text" placeholder={t('nn.reviseText')} value={text} onChangeText={setText} editable={!b.busy} multiline />
      <TextField testID="nn-revise-why" placeholder={t('nn.reviseWhy')} value={why} onChangeText={setWhy} editable={!b.busy} />
      <Row>
        <Button testID="dr-revise-send" size="sm" variant="primary" label={t('nn.revise')} disabled={b.busy || !ready} onPress={send} />
        <Button size="sm" variant="ghost" label={t('common.cancel')} disabled={b.busy} onPress={onDone} />
      </Row>
    </View>
  );
}

export function WorkRow({ r }: { r: WorkRowVM }) {
  const { t, fmtDay } = useApp();
  const w = r.w;
  return (
    <View style={[styles.work, r.capture && styles.capture]}>
      {w.by ? <Avatar userId={w.by} size="sm" /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Row wrap>
          <Text size="xs" color="textTertiary" tight>
            {fmtDay(w.date)}
          </Text>
          <Text size="xs" color="textSecondary" tight>
            {t(`src.${w.src}`)}
          </Text>
        </Row>
        <Text size="sm">{w.text}</Text>
        <Row wrap>
          {r.capture ? <Pill label={t('cap.label')} /> : w.effect ? <Pill label={t(`ef.${w.effect}`)} tone={themeTone(r.effectTone)} /> : null}
          {w.result ? <Pill label={t(`res.${w.result}`)} tone={themeTone(r.resultTone)} /> : null}
          {w.via ? (
            <Text size="xs" color="textSecondary" tight>
              {t('dr.via', { client: w.via.client })}
            </Text>
          ) : null}
        </Row>
        {!r.capture && w.why ? (
          <Text size="xs" color="textSecondary">
            {w.why}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** The detail body for `needId`; `onClose` adds a close button (the wide side pane). */
export function NeedDetail({ projectId, needId, onClose }: { projectId: Id; needId: Id; onClose?: () => void }) {
  const { live, me, today, t, fmtDay } = useApp();
  const go = useGo();
  const b = useBusy(needId);
  const [revising, setRevising] = useState(false);
  useEffect(() => setRevising(false), [needId]);
  const vm = useMemo(() => drawerVM(live, me, projectId, needId, today), [live, me, projectId, needId, today]);

  if (!vm) {
    return (
      <View style={styles.pad} testID="drawer">
        <Row>
          <Text color="textSecondary" style={{ flex: 1 }}>
            {t('dr.missing')}
          </Text>
          {onClose ? <Button size="sm" variant="ghost" label={t('close')} onPress={onClose} /> : null}
        </Row>
      </View>
    );
  }
  const n = vm.need;
  const src = vm.source;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.pad} testID="drawer" keyboardShouldPersistTaps="handled">
      <Header vm={vm} projectId={projectId} b={b} onClose={onClose} />

      {vm.handoffs.map((h) => (
        <HandoffBlock key={h.id} need={n} h={h} />
      ))}

      <Section title={t('dr.source')}>
        <View style={styles.quote}>
          <Text size="sm">{src.quote}</Text>
        </View>
        <Row wrap>
          <Text size="xs" color="textSecondary" tight>
            {`${t(`src.${src.src}`)}  ${src.ref}  ${fmtDay(src.date)}`}
          </Text>
          {src.inputId ? <Button testID="dr-source-open" size="sm" variant="link" label={t('dr.open')} onPress={() => go({ view: 'inputs', projectId, focusId: src.inputId! })} /> : null}
        </Row>
      </Section>

      <Section title={t('dr.meta')}>
        <StatusEdit n={n} b={b} />
        <OwnerEdit n={n} b={b} />
        <KV label={t('dr.requester')}>
          <Text size="sm">{vm.requester.self ? t('card.self') : vm.requester.name}</Text>
        </KV>
        <DeadlineEdit vm={vm} b={b} />
        <ParentEdit vm={vm} b={b} />
        {vm.fields.kind === 'ext' ? (
          <KV label={t('dr.accept')}>
            <Text size="sm">{vm.fields.accept ?? t('dr.none')}</Text>
          </KV>
        ) : (
          <>
            <KV label={t('dr.expect')}>
              <Text size="sm" color={vm.fields.expect ? 'text' : 'textTertiary'}>
                {vm.fields.expect ?? t('dr.none')}
              </Text>
            </KV>
            <KV label={t('dr.verify')}>
              <Text size="sm" color={vm.fields.verify ? 'text' : 'textTertiary'}>
                {vm.fields.verify ?? t('dr.none')}
              </Text>
            </KV>
          </>
        )}
        {revising ? (
          <ReviseForm n={n} b={b} onDone={() => setRevising(false)} />
        ) : (
          <Row>
            <Button testID="dr-revise" size="sm" label={t('nn.revise')} disabled={b.busy} onPress={() => setRevising(true)} />
          </Row>
        )}
      </Section>

      {vm.revisions.length > 0 ? (
        <Section title={t('dr.rev')}>
          {vm.revisions.map((r) => (
            <View key={r.id} style={{ gap: 2 }}>
              <Row wrap>
                <Text size="xs" color="textTertiary" tight>
                  {fmtDay(r.date)}
                </Text>
                <Text size="xs" color="textSecondary" tight>
                  {t('dr.version', { v: r.version })}
                </Text>
              </Row>
              <Text size="sm">{r.text}</Text>
              <Text size="xs" color="textSecondary">
                {r.why}
              </Text>
            </View>
          ))}
        </Section>
      ) : null}

      <Section title={t('dr.work')}>
        {vm.work.length === 0 ? (
          <Text size="sm" color="textTertiary">
            {t('dr.none')}
          </Text>
        ) : (
          vm.work.map((r) => <WorkRow key={r.w.id} r={r} />)
        )}
      </Section>

      {vm.artifacts.length > 0 ? (
        <Section title={t('dr.artifacts')}>
          {vm.artifacts.map((a) => (
            <Pressable key={a.id} accessibilityRole="link" onPress={() => go({ view: 'artifacts', projectId, focusId: a.id })} style={styles.li}>
              <Text size="xs" mono color="textTertiary" tight>
                {a.kind.toUpperCase()}
              </Text>
              <Text size="sm" style={{ flex: 1 }} numberOfLines={1}>
                {a.title}
              </Text>
            </Pressable>
          ))}
        </Section>
      ) : null}

      {vm.children.length > 0 ? (
        <Section title={t('dr.children')}>
          {vm.children.map((k) => (
            <Pressable key={k.need.id} accessibilityRole="link" onPress={() => go({ view: 'board', projectId, needId: k.need.id })} style={styles.li}>
              <Text size="xs" mono color="textTertiary" tight>
                {k.need.code}
              </Text>
              <Text size="sm" style={{ flex: 1 }} numberOfLines={2}>
                {k.need.title}
              </Text>
              <Status label={t(`st.${k.need.status}`)} tone={themeTone(k.tone)} />
            </Pressable>
          ))}
        </Section>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: space[4], gap: space[4], paddingBottom: space[12] },
  fix: { gap: space[2], padding: space[3], borderRadius: radius.md, backgroundColor: colors.surface },
  quote: { borderLeftWidth: 2, borderLeftColor: colors.borderStrong, paddingLeft: space[3] },
  work: { flexDirection: 'row', gap: space[2], alignItems: 'flex-start', paddingVertical: space[1] },
  capture: { opacity: 0.75 },
  li: { flexDirection: 'row', gap: space[2], alignItems: 'center', paddingVertical: space[1] },
  pick: { paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.md },
  pickOn: { backgroundColor: colors.selected },
  pickHover: { backgroundColor: colors.hover },
});
