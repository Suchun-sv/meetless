/**
 * The inbox review (mobile-v2 B3, B4, B6, B7) for one analysed material, plus its failed and
 * committed states. A3's material page renders it once the material is `ready`; a commit reports
 * through `onCommitted` (A3 shows B5).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TextField } from '@/components/ui';
import { useApp, useGo } from '@/state';
import { colors, radius, space } from '@/theme';
import { useHeaderActions, useHeaderBack } from '@/shell/chrome';
import { urgencyTone } from '@/ui/urgency';
import { currentOrLatestRound, daysBetween, myProjectIds, type Id } from '@meetless/core';
import { projectColors } from '../../home/model/mine';
import {
  alternatives,
  commitBody,
  defaultDecision,
  facts,
  initialPlan,
  modeOf,
  NEW,
  newProjectForm,
  reasonFor,
  sameTarget,
  takeCounts,
  newRoundDates,
  targetKey,
  type Decision,
  type ItemPlan,
  type NewProjectForm,
  type Target,
} from './model';
import { fixedProject, reviewOf, type CommitBody, type CommitResult, type InboxItem, type IsoDate, type ReviewMaterial as InboxMaterial } from './types';
import { sourceLabel } from '../model/source';

export type { CommitBody, CommitResult };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TEMPLATES = [null, 'activity', 'paper', 'course'] as const;
const TPL_KEY = { none: 'rv.tpl.none', activity: 'rv.tpl.activity', paper: 'rv.tpl.paper', course: 'rv.tpl.course' } as const;
const WEEK_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function useDates() {
  const { fmtDay, locale, today, t } = useApp();
  const withWeek = (d: IsoDate) => `${fmtDay(d)} ${(locale === 'en' ? WEEK_EN : WEEK_ZH)[new Date(`${d}T12:00:00Z`).getUTCDay()]}`;
  const left = (d: IsoDate) => {
    const n = daysBetween(today, d);
    return { text: n < 0 ? t('round.over', { n: -n }) : t('round.left', { n }), color: urgencyTone(n).fg };
  };
  return { fmtDay, withWeek, left };
}

function useProjects() {
  const { live, me } = useApp();
  return useMemo(() => {
    const ids = myProjectIds(live, me).filter((p) => !live.projects[p]?.archived);
    const tones = projectColors(ids);
    const color = (pid: string) => colors.avatar[(tones.get(pid) ?? 8) - 1]!;
    const name = (pid: string) => live.projects[pid]?.name ?? pid;
    return { ids, color, name };
  }, [live, me]);
}

function Bar({ color, h = 22 }: { color: string; h?: number }) {
  return <View style={{ width: 5, height: h, borderRadius: 3, backgroundColor: color }} />;
}

function Tag({ label, tone = 'plain' }: { label: string; tone?: 'plain' | 'rev' | 'flag' }) {
  const bg = tone === 'rev' ? colors.infoBg : tone === 'flag' ? colors.warningBg : colors.surface;
  const fg = tone === 'rev' ? colors.info : tone === 'flag' ? colors.warning : colors.textSecondary;
  return (
    <View style={[styles.tag, { backgroundColor: bg }]}>
      <Text size="xs" weight="semibold" tight style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}

function DateButton({ value, onChange, disabled }: { value: IsoDate | null; onChange: (d: IsoDate | null) => void; disabled?: boolean }) {
  const { t } = useApp();
  const { withWeek } = useDates();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  return (
    <View style={{ gap: space[2] }}>
      <Pressable testID="rv-due" accessibilityRole="button" disabled={disabled} onPress={() => setOpen((o) => !o)} style={styles.due}>
        <Icon name="calendar" size={14} color="textSecondary" />
        <Text size="sm" weight="medium" tight>
          {value ? withWeek(value) : t('round.none')}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.dateEdit}>
          <View style={{ flex: 1 }}>
            <TextField placeholder={t('need.datePh')} value={draft} onChangeText={setDraft} />
          </View>
          <Button size="sm" label={t('need.setDate')} disabled={!DAY.test(draft)} onPress={() => (onChange(draft), setOpen(false))} />
        </View>
      ) : null}
    </View>
  );
}

function Quote({ item }: { item: InboxItem }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  if (!item.quote) return null;
  const where = item.page ? t('rv.page', { n: item.page }) : '';
  if (!open)
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={styles.srcl}>
        <Text size="sm" color="textTertiary" tight>{`${t('rv.source')} ${where}`.trim()}</Text>
        <Icon name="down" size={13} color="textTertiary" />
      </Pressable>
    );
  return (
    <View style={styles.quote}>
      <Text size="sm">{item.quote}</Text>
      <View style={{ flexDirection: 'row', gap: space[2] }}>
        {where ? (
          <Text size="xs" color="textTertiary">
            {where}
          </Text>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => setOpen(false)} hitSlop={6}>
          <Text size="xs" color="textTertiary">
            {t('rv.fold')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const TYPE_KEY = { need: 'rv.t.need', hyp: 'rv.t.hyp', rev: 'rv.t.rev' } as const;
/** S's `source` codes for materials added in the inbox; anything else (an email sender, 项目 Agent) shows as given. */
const DONE_KEY = { accept: 'rv.done.accept', merge: 'rv.done.merge', skip: 'rv.done.skip', keep: 'rv.done.keep' } as const;

/** One item as a B4 card; once decided it folds to a line that reopens on a tap. */
function ItemCard({ p, set, busy }: { p: ItemPlan; set: (patch: Partial<ItemPlan>) => void; busy: boolean }) {
  const { t, live } = useApp();
  const { fmtDay, withWeek, left } = useDates();
  const i = p.item;
  const dup = i.duplicateOf ? live.needs[i.duplicateOf] : undefined;
  const revOf = i.type === 'rev' && !i.conflict && i.revNeedId ? live.needs[i.revNeedId] : undefined;
  const dupRound = dup?.roundId ? live.rounds[dup.roundId] : undefined;
  const c = i.conflict;
  if (p.decision) {
    return (
      <Pressable testID="rv-item-done" accessibilityRole="button" onPress={() => set({ decision: null })} style={[styles.ic, styles.icDone]}>
        <Text size="sm" color={p.decision === 'skip' ? 'textTertiary' : 'success'} weight="medium" tight>
          {t(DONE_KEY[p.decision])}
        </Text>
        <Text size="sm" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
          {i.text}
        </Text>
      </Pressable>
    );
  }
  const due = p.due === undefined ? (i.due ?? null) : p.due;
  return (
    <View testID="rv-item" style={styles.ic}>
      <View style={styles.row}>
        <Tag label={t(TYPE_KEY[i.type])} tone={i.type === 'rev' ? 'rev' : 'plain'} />
        {dup ? <Tag tone="flag" label={t('rv.dup', { code: dup.code })} /> : null}
        {c ? <Tag tone="flag" label={t('rv.conflict')} /> : null}
      </View>
      <Text size="md" weight="semibold" style={{ fontSize: 16.5, lineHeight: 22 }}>
        {i.text}
      </Text>
      {dup ? (
        <Text size="sm" color="textSecondary">
          {t('rv.existing')}
          <Text size="sm" weight="semibold">{` ${dup.code} ${dup.title}`}</Text>
          {dupRound ? `   ${t('rv.dueOn', { d: fmtDay(dupRound.due) })}` : ''}
        </Text>
      ) : null}
      {revOf ? (
        <View style={{ gap: 2 }}>
          <Text size="sm" color="textSecondary">
            {t('rv.revises')}
            <Text size="sm" weight="semibold">{` ${revOf.code} ${revOf.title}`}</Text>
          </Text>
          {(revOf.kind === 'ext' ? revOf.accept : revOf.expect) ? (
            <Text size="sm" color="textTertiary" style={{ textDecorationLine: 'line-through' }}>
              {revOf.kind === 'ext' ? revOf.accept : revOf.expect}
            </Text>
          ) : null}
        </View>
      ) : null}
      {c ? (
        <View style={styles.row}>
          <Text size="md" color="textTertiary" style={{ textDecorationLine: 'line-through' }}>
            {fmtDay(c.old)}
          </Text>
          <Text size="md" color="textTertiary">
            →
          </Text>
          <Text size="md" weight="semibold">
            {withWeek(c.new)}
          </Text>
          <Text size="sm" weight="semibold" style={{ color: left(c.new).color }}>
            {left(c.new).text}
          </Text>
        </View>
      ) : null}
      {i.createsRound && 'projectId' in p.target ? (
        <Pressable
          testID="rv-new-round"
          accessibilityRole="switch"
          accessibilityState={{ checked: !!p.createRound }}
          disabled={busy}
          onPress={() => set({ createRound: !p.createRound })}
          style={styles.switchRow}
        >
          <View style={[styles.switch, p.createRound && styles.switchOn]}>
            <View style={[styles.knob, p.createRound && styles.knobOn]} />
          </View>
          <Text size="sm" color={p.createRound ? 'text' : 'textSecondary'}>
            {t('rv.newRound', { d: fmtDay(i.createsRound.due) })}
          </Text>
        </Pressable>
      ) : null}
      <Quote item={i} />
      <View style={styles.iact}>
        {!c && due !== null && i.due !== undefined ? <DateButton value={due} onChange={(d) => set({ due: d })} disabled={busy} /> : null}
        <View style={{ flex: 1 }} />
        {c ? (
          <>
            <Button testID="rv-keep" size="sm" variant="ghost" label={t('rv.keep', { d: fmtDay(c.old) })} disabled={busy} onPress={() => set({ decision: 'keep' })} />
            <Button testID="rv-apply" size="sm" variant="primary" label={t('rv.apply', { d: fmtDay(c.new) })} disabled={busy} onPress={() => set({ decision: 'accept' })} />
          </>
        ) : (
          <>
            <Button testID="rv-ignore" size="sm" variant="ghost" label={t('rv.ignore')} disabled={busy} onPress={() => set({ decision: 'skip' })} />
            {dup ? (
              <Button testID="rv-merge" size="sm" variant="primary" label={t('rv.merge', { code: dup.code })} disabled={busy} onPress={() => set({ decision: 'merge' })} />
            ) : (
              <Button testID="rv-accept" size="sm" variant="primary" label={t('rv.accept')} disabled={busy} onPress={() => set({ decision: 'accept' })} />
            )}
          </>
        )}
      </View>
    </View>
  );
}

/** The material's own card (B6, B7): icon, title, source and time, summary. */
function MaterialCard({ m }: { m: InboxMaterial }) {
  const { t, fmtClock, fmtDay, today } = useApp();
  const at = m.addedAt ?? m.at ?? '';
  const when = !at ? '' : at.slice(0, 10) === today ? `${t('tl.today')} ${fmtClock(at)}` : fmtDay(at.slice(0, 10));
  const icon = m.kind === 'mail' ? 'mail' : m.kind === 'chat' ? 'chat' : m.kind === 'proposal' || m.kind === 'agent' ? 'sparkle' : 'file';
  return (
    <View style={styles.mcard}>
      <View style={[styles.mic, icon === 'sparkle' && { backgroundColor: colors.aiBg }]}>
        <Icon name={icon} size={20} color={icon === 'sparkle' ? 'ai' : 'textSecondary'} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text size="md" weight="semibold" numberOfLines={1}>
          {m.title}
        </Text>
        <Text size="sm" color="textTertiary" tight>{`${sourceLabel(t, m.source)}   ${when}`}</Text>
        {m.summary ? (
          <Text size="sm" style={{ marginTop: 6, lineHeight: 21 }}>
            {m.summary}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** The new-project form (B7), in place. */
function NewProjectCard({ form, setForm, plan, busy, onCreate, onExisting, embedded }: {
  m?: InboxMaterial;
  form: NewProjectForm;
  setForm: (f: NewProjectForm) => void;
  plan: ItemPlan[];
  busy: boolean;
  onCreate?: () => void;
  onExisting?: () => void;
  embedded?: boolean;
}) {
  const { t } = useApp();
  const { left } = useDates();
  const mine = plan.filter((p) => 'newProject' in p.target);
  const n = mine.filter((p) => !form.off.has(p.item.id)).length;
  const toggle = (id: string) => {
    const off = new Set(form.off);
    if (off.has(id)) off.delete(id);
    else off.add(id);
    setForm({ ...form, off });
  };
  return (
    <View testID="rv-new" style={embedded ? { gap: space[1] } : styles.sug}>
      {!embedded ? (
        <>
          <Text size="sm" weight="semibold" color="textTertiary">
            {t('rv.suggestNew')}
          </Text>
          {form.reason ? (
            <Text size="md" color="textSecondary" style={{ lineHeight: 23 }}>
              {form.reason}
            </Text>
          ) : null}
        </>
      ) : null}
      <Text style={styles.fl}>{t('rv.form.name')}</Text>
      <TextField testID="rv-name" value={form.name} onChangeText={(name) => setForm({ ...form, name })} autoFocus={!embedded} style={styles.fi} />
      <Text style={styles.fl}>{t('rv.form.round')}</Text>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <TextField placeholder={t('rv.form.roundPh')} value={form.roundTitle} onChangeText={(roundTitle) => setForm({ ...form, roundTitle })} style={styles.fi} />
        </View>
        <DateButton value={form.due} onChange={(due) => setForm({ ...form, due })} disabled={busy} />
      </View>
      {form.due || form.quote ? (
        <Text size="xs" color="textTertiary">
          {form.due ? <Text size="xs" style={{ color: left(form.due).color }}>{`${left(form.due).text}   `}</Text> : null}
          {form.quote ? t('rv.form.quote', { q: form.quote }) : ''}
        </Text>
      ) : null}
      <Text style={styles.fl}>{t('rv.form.template')}</Text>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        {TEMPLATES.map((tpl) => {
          const on = form.template === tpl;
          return (
            <Pressable key={tpl ?? 'none'} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setForm({ ...form, template: tpl })} style={[styles.chip, on && styles.chipOn]}>
              <Text size="sm" color={on ? 'textInverse' : 'text'} tight>
                {t(TPL_KEY[tpl ?? 'none'])}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {!embedded ? (
        <>
          <Text style={styles.fl}>{t('rv.form.items')}</Text>
          {mine.map((p) => {
            const on = !form.off.has(p.item.id);
            return (
              <Pressable key={p.item.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(p.item.id)} style={styles.ckRow}>
                <View style={[styles.ck, on && styles.ckOn]}>{on ? <Icon name="check" size={12} color="textInverse" strokeWidth={2.4} /> : null}</View>
                <Text size="md" style={{ flex: 1 }}>
                  {p.item.text}
                </Text>
              </Pressable>
            );
          })}
          <Button testID="rv-create" variant="primary" label={t('rv.create', { n })} busy={busy} disabled={!form.name.trim() || n === 0} onPress={onCreate} style={styles.wide} />
          {onExisting ? <Button variant="ghost" label={t('rv.existingInstead')} onPress={onExisting} style={styles.wide} /> : null}
        </>
      ) : null}
    </View>
  );
}

export function MaterialReview({
  material,
  commit,
  onCommitted,
  onReanalyze,
  onRemove,
}: {
  material: unknown;
  commit: (id: string, body: CommitBody) => Promise<CommitResult>;
  /** ⋯ 重新分析 (retry) and 删除 (remove); the menu shows when either is given. */
  onReanalyze?: () => void;
  onRemove?: () => void;
  onCommitted: (r: CommitResult & { materialId: string; body: CommitBody }) => void;
}) {
  const m = reviewOf(material);
  const { t, notify, errorText } = useApp();
  const { fmtDay } = useDates();
  const P = useProjects();
  const fixed = fixedProject(m);
  const [plan, setPlan] = useState<ItemPlan[]>(() => initialPlan(m));
  const [form, setForm] = useState<NewProjectForm>(() => newProjectForm(m));
  const [step, setStep] = useState<'main' | 'items' | 'pick'>('main');
  const [moving, setMoving] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const sent = useRef(false);
  useEffect(() => {
    setPlan(initialPlan(m));
    setForm(newProjectForm(m));
    setStep('main');
    sent.current = false;
  }, [m.id]);

  const mode = modeOf(plan);
  const target = plan[0]?.target ?? NEW;
  const setItem = (id: string, patch: Partial<ItemPlan>) => setPlan((ps) => ps.map((p) => (p.item.id === id ? { ...p, ...patch } : p)));
  const retarget = (to: Target) => setPlan((ps) => ps.map((p) => ({ ...p, target: to })));

  const send = async (all: boolean) => {
    if (sent.current) return;
    const ps = all ? plan.map((p) => ({ ...p, decision: p.decision ?? defaultDecision(p.item) })) : plan;
    const body = commitBody(ps, plan.some((p) => 'newProject' in p.target) ? form : null);
    sent.current = true;
    setBusy(true);
    try {
      const r = await commit(m.id, body);
      onCommitted({ ...r, materialId: m.id, body });
    } catch {
      sent.current = false;
      notify('error', errorText('NETWORK'));
    } finally {
      setBusy(false);
    }
  };

  // B4: once every item is decided, commit by itself.
  useEffect(() => {
    if (step === 'items' && plan.length > 0 && plan.every((p) => p.decision)) void send(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, step]);

  // Nav bar: B4 (and its project picker) step back inside the page; B3, B6 and B7 keep 「‹ 需求」.
  const showAcceptAll = step === 'items' || mode === 'split';
  const hasMenu = !!(onReanalyze || onRemove);
  useHeaderActions(
    showAcceptAll
      ? [{ text: t('ans.added.acceptAll'), label: t('ans.added.acceptAll'), onPress: () => void send(true), testID: 'rv-accept-all' }]
      : hasMenu
        ? [{ icon: 'more', label: t('rv.more'), onPress: () => setMenu((v) => !v), testID: 'rv-more' }]
        : [],
  );
  useHeaderBack(step === 'items' ? { label: t('rv.back'), onPress: () => setStep('main') } : step === 'pick' ? { label: t('rv.back'), onPress: () => setStep('items') } : null);

  const body = commitBody(plan.map((p) => ({ ...p, decision: p.decision ?? defaultDecision(p.item) })), form);
  const counts = takeCounts(body);

  // ---------------------------------------------------------------- B4
  if (step === 'items') {
    const pid = 'projectId' in target ? target.projectId : null;
    return (
      <ScrollView testID="rv-items" contentContainerStyle={styles.scroll}>
        <View style={styles.ptarget}>
          <Text size="sm" color="textSecondary">
            {t('rv.putInto')}
          </Text>
          <Pressable accessibilityRole="button" disabled={fixed} onPress={() => setStep('pick')} style={styles.pchip}>
            {pid ? <Bar color={P.color(pid)} h={12} /> : null}
            <Text size="sm" tight>
              {pid ? P.name(pid) : form.name}
            </Text>
            {fixed ? null : <Icon name="down" size={13} color="textSecondary" />}
          </Pressable>
          <View style={{ flex: 1 }} />
          <Text size="sm" color="textTertiary">
            {t('rv.count', { n: plan.length })}
          </Text>
        </View>
        {plan.map((p) => (
          <ItemCard key={p.item.id} p={p} busy={busy} set={(patch) => setItem(p.item.id, patch)} />
        ))}
      </ScrollView>
    );
  }

  // ---------------------------------------------------------------- picking a project for everything
  const choose = (to: Target) => {
    retarget(to);
    setStep('main');
  };
  const pickList = (
    <View style={styles.alts}>
      {P.ids
        .filter((pid) => step === 'pick' || alternatives(m, target).includes(pid))
        .map((pid, k) => (
          <Pressable key={pid} testID="rv-alt" accessibilityRole="radio" accessibilityState={{ selected: sameTarget(target, { projectId: pid }) }} onPress={() => choose({ projectId: pid })} style={[styles.alt, k > 0 && styles.hair]}>
            <View style={[styles.rad, sameTarget(target, { projectId: pid }) && styles.radOn]} />
            <Bar color={P.color(pid)} />
            <View style={{ flex: 1 }}>
              <Text size="md" weight="medium">
                {P.name(pid)}
              </Text>
              {m.routing?.candidates.find((c) => c.projectId === pid)?.reason ? (
                <Text size="sm" color="textTertiary" numberOfLines={2}>
                  {m.routing.candidates.find((c) => c.projectId === pid)!.reason}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))}
      <Pressable testID="rv-alt-new" accessibilityRole="button" onPress={() => choose(NEW)} style={[styles.alt, styles.hair]}>
        <View style={[styles.rad, styles.radPlus]}>
          <Icon name="plus" size={12} color="textSecondary" />
        </View>
        <View style={{ flex: 1 }}>
          <Text size="md" weight="medium">
            {t('rv.newProject')}
          </Text>
          <Text size="sm" color="textTertiary">
            {t('rv.newProjectSub')}
          </Text>
        </View>
      </Pressable>
    </View>
  );

  const readLine = (
    <View style={styles.mmini}>
      <Icon name="file" size={16} color="textSecondary" />
      <Text size="sm" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
        {m.title}
      </Text>
      <Icon name="check" size={14} color="success" />
      <Text size="sm" weight="semibold" color="success" tight>
        {m.pages ? t('rv.read', { n: m.pages }) : t('rv.readDone')}
      </Text>
    </View>
  );

  if (step === 'pick') {
    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text size="sm" weight="semibold" color="textSecondary" style={styles.sech}>
          {t('rv.pickProject')}
        </Text>
        {pickList}
      </ScrollView>
    );
  }

  // ---------------------------------------------------------------- B6
  if (mode === 'split') {
    const groups = new Map<string, { target: Target; ps: ItemPlan[] }>();
    for (const p of plan) {
      const k = targetKey(p.target);
      groups.set(k, { target: p.target, ps: [...(groups.get(k)?.ps ?? []), p] });
    }
    const places: Target[] = [...new Map([...plan.map((p) => p.target), ...(m.routing?.candidates ?? []).map((c): Target => ({ projectId: c.projectId }))].map((x) => [targetKey(x), x])).values()].filter((x) => !('newProject' in x));
    return (
      <View style={{ flex: 1 }}>
        <ScrollView testID="rv-split" contentContainerStyle={[styles.scroll, { paddingBottom: 200 }]}>
          <MaterialCard m={m} />
          <Text size="sm" color="textSecondary" style={styles.splitNote}>
            {t('rv.splitNote', { n: groups.size })}
          </Text>
          {[...groups.values()].map(({ target: g, ps }) => {
            return (
              <View key={targetKey(g)} style={styles.pgrp}>
                <GroupHead target={g} n={ps.length} form={form} />
                {'newProject' in g ? (
                  <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
                    <NewProjectCard m={m} form={form} setForm={setForm} plan={plan} busy={busy} embedded />
                  </View>
                ) : null}
                {ps.map((p) => {
                  const dup = p.item.duplicateOf;
                  return (
                    <View key={p.item.id}>
                      <Pressable testID="rv-row" accessibilityRole="button" onPress={() => setOpenRow(openRow === p.item.id ? null : p.item.id)} style={[styles.row2, moving === p.item.id && styles.moving]}>
                        <Tag label={t(TYPE_KEY[p.item.type])} tone={p.item.type === 'rev' ? 'rev' : 'plain'} />
                        <Text size="md" numberOfLines={1} style={{ flex: 1 }} color={p.decision === 'skip' ? 'textTertiary' : 'text'}>
                          {p.item.text}
                        </Text>
                        {dup ? <DupFlag needId={dup} /> : null}
                        {fixed ? null : <Pressable testID="rv-move" accessibilityRole="button" accessibilityLabel={t('rv.moveTo')} hitSlop={6} onPress={() => setMoving(moving === p.item.id ? null : p.item.id)} style={[styles.mv, moving === p.item.id && styles.mvOn]}>
                          <Icon name="swap" size={16} color={moving === p.item.id ? 'text' : 'textTertiary'} />
                        </Pressable>}
                      </Pressable>
                      {moving === p.item.id ? (
                        <View style={styles.picker}>
                          <Text size="xs" color="textTertiary">
                            {t('rv.moveTo')}
                          </Text>
                          {[...places, NEW].map((to) => {
                            const on = sameTarget(to, p.target);
                            return (
                              <Pressable key={targetKey(to)} accessibilityRole="button" onPress={() => (setItem(p.item.id, { target: to }), setMoving(null))} style={[styles.pko, on && styles.pkoOn]}>
                                <Text size="sm" weight={on ? 'semibold' : 'regular'} tight>
                                  {'projectId' in to ? P.name(to.projectId) : t('rv.newProject')}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : null}
                      {openRow === p.item.id ? (
                        <View style={{ paddingHorizontal: 8, paddingBottom: 8 }}>
                          <ItemCard p={p} busy={busy} set={(patch) => setItem(p.item.id, patch)} />
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
        <View style={styles.bottomCta}>
          <Button testID="rv-accept-split" variant="primary" label={t('rv.acceptSplit', { n: counts.items, m: counts.places })} busy={busy} disabled={counts.items === 0} onPress={() => void send(true)} style={styles.wide} />
        </View>
      </View>
    );
  }

  // ---------------------------------------------------------------- B7
  if (mode === 'new') {
    return (
      <ScrollView testID="rv-newproject" contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <MaterialCard m={m} />
        <NewProjectCard
          m={m}
          form={form}
          setForm={setForm}
          plan={plan}
          busy={busy}
          onCreate={() => void send(true)}
          onExisting={() => {
            const alt = m.routing?.candidates[0]?.projectId ?? P.ids[0];
            if (alt) retarget({ projectId: alt });
          }}
        />
      </ScrollView>
    );
  }

  // ---------------------------------------------------------------- B3
  const pid = 'projectId' in target ? target.projectId : '';
  const reason = reasonFor(m, pid);
  const f = facts(m);
  return (
    <ScrollView testID="rv-suggest" contentContainerStyle={styles.scroll}>
      {readLine}
      {menu ? (
        <View testID="rv-menu" style={[styles.alts, { marginTop: 8 }]}>
          {onReanalyze ? (
            <Pressable accessibilityRole="menuitem" onPress={() => (setMenu(false), onReanalyze())} style={styles.alt}>
              <Text size="md">{t('rv.reanalyze')}</Text>
            </Pressable>
          ) : null}
          {onRemove ? (
            <Pressable accessibilityRole="menuitem" onPress={() => (setMenu(false), onRemove())} style={[styles.alt, onReanalyze ? styles.hair : null]}>
              <Text size="md" color="danger">
                {t('rv.remove')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={styles.sug}>
        <Text size="sm" weight="semibold" color="textTertiary">
          {t('rv.suggest')}
        </Text>
        <View style={[styles.row, { gap: 10, marginTop: 4 }]}>
          <Bar color={P.color(pid)} h={24} />
          <Text weight="semibold" tight style={styles.sname} numberOfLines={2}>
            {P.name(pid)}
          </Text>
        </View>
        {reason.length ? (
          <Text size="md" color="textSecondary" style={{ lineHeight: 23, marginTop: 8 }}>
            {reason.map((r, k) =>
              r.bold ? (
                <Text key={k} size="md" weight="semibold">
                  {r.text}
                </Text>
              ) : (
                r.text
              ),
            )}
          </Text>
        ) : null}
        <View style={styles.facts}>
          {f.needs ? <Fact text={t('rv.facts.needs', { n: f.needs })} /> : null}
          {f.hyps ? <Fact text={t('rv.facts.hyps', { n: f.hyps })} /> : null}
          {f.revs ? <Fact text={t('rv.facts.revs', { n: f.revs })} /> : null}
          {f.due ? <Fact text={t('rv.facts.due', { d: fmtDay(f.due) })} /> : null}
          {newRoundDates(plan).map((d) => (
            <Fact key={d} text={t('rv.facts.noRound', { d: fmtDay(d) })} />
          ))}
        </View>
        <Button testID="rv-accept-all-one" variant="primary" label={t('rv.acceptAll', { name: P.name(pid), n: plan.length })} busy={busy} onPress={() => void send(true)} style={styles.wide} />
        <Button testID="rv-one-by-one" variant="ghost" label={t('rv.oneByOne')} disabled={busy} onPress={() => setStep('items')} style={styles.wide} />
      </View>
      {fixed ? null : (
        <>
          <Text size="sm" weight="semibold" color="textSecondary" style={styles.sech}>
            {t('rv.maybe')}
          </Text>
          {pickList}
        </>
      )}
    </ScrollView>
  );
}

function Fact({ text }: { text: string }) {
  return (
    <View style={styles.fact}>
      <Text size="sm" weight="medium" tight>
        {text}
      </Text>
    </View>
  );
}

function DupFlag({ needId }: { needId: string }) {
  const { t, live } = useApp();
  const n = live.needs[needId];
  return n ? <Tag tone="flag" label={t('rv.dup', { code: n.code })} /> : null;
}

function GroupHead({ target, n, form }: { target: Target; n: number; form: NewProjectForm }) {
  const { t, live } = useApp();
  const { fmtDay } = useDates();
  const P = useProjects();
  const pid = 'projectId' in target ? target.projectId : null;
  const round = pid ? currentOrLatestRound(live, pid as Id) : null;
  return (
    <View style={styles.pgh}>
      <Bar color={pid ? P.color(pid) : colors.textTertiary} h={30} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text size="md" weight="semibold" numberOfLines={1}>
          {pid ? P.name(pid) : form.name || t('rv.newProject')}
        </Text>
        {round ? (
          <Text size="xs" color="textTertiary">
            {t('rv.groupDue', { title: round.title || t('round', { n: round.n }), d: fmtDay(round.due) })}
          </Text>
        ) : !pid ? (
          <Text size="xs" color="textTertiary">
            {t('rv.newProject')}
          </Text>
        ) : null}
      </View>
      <Text size="sm" color="textTertiary">
        {t('rv.count', { n })}
      </Text>
    </View>
  );
}

/** 没读出来 + 重试 (NOTES §4). */
export function MaterialFailed({ material, retry }: { material: unknown; retry: (id: string) => Promise<unknown> }) {
  const m = reviewOf(material);
  const { t, notify, errorText } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await retry(m.id);
    } catch {
      notify('error', errorText('NETWORK'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView testID="rv-failed" contentContainerStyle={styles.scroll}>
      <MaterialCard m={m} />
      <View style={[styles.sug, { gap: space[2] }]}>
        <Text size="lg" weight="semibold">
          {t('rv.failed')}
        </Text>
        {m.error ? (
          <Text size="sm" color="textSecondary">
            {m.error.message}
          </Text>
        ) : null}
        <Button testID="rv-retry" variant="primary" label={t('rv.retry')} busy={busy} onPress={run} style={styles.wide} />
      </View>
    </ScrollView>
  );
}

/** A committed material, read-only: where it went, the items, and 撤销. */
export function MaterialCommitted({ material, undo }: { material: unknown; undo: (id: string) => Promise<unknown> }) {
  const m = reviewOf(material);
  const { t, notify, errorText } = useApp();
  const go = useGo();
  const P = useProjects();
  const [busy, setBusy] = useState(false);
  const pids = m.committed?.projectIds ?? m.projectIds ?? [];
  const run = async () => {
    setBusy(true);
    try {
      await undo(m.id);
    } catch {
      notify('error', errorText('NETWORK'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView testID="rv-committed" contentContainerStyle={styles.scroll}>
      <MaterialCard m={m} />
      <View style={[styles.sug, { gap: space[2] }]}>
        {pids.map((pid) => (
          <Pressable key={pid} accessibilityRole="link" onPress={() => go({ view: 'board', projectId: pid })} style={styles.row}>
            <Icon name="check" size={16} color="success" />
            <Bar color={P.color(pid)} h={16} />
            <Text size="md" weight="medium" style={{ flex: 1 }}>
              {t('rv.committed', { name: P.name(pid), n: m.items.filter((i) => !i.projectId || i.projectId === pid).length })}
            </Text>
            <Icon name="chevron" size={14} color="textTertiary" />
          </Pressable>
        ))}
        {m.items.map((i) => (
          <View key={i.id} style={styles.row}>
            <Tag label={t(TYPE_KEY[i.type])} tone={i.type === 'rev' ? 'rev' : 'plain'} />
            <Text size="sm" numberOfLines={1} style={{ flex: 1 }}>
              {i.text}
            </Text>
          </View>
        ))}
        <Button testID="rv-undo" variant="ghost" label={t('rv.undo')} busy={busy} onPress={run} style={styles.wide} />
      </View>
    </ScrollView>
  );
}

const HAIR = StyleSheet.hairlineWidth;
const styles = StyleSheet.create({
  scroll: { paddingBottom: 140, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mmini: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginTop: 2 },
  sug: { marginHorizontal: 16, marginTop: 12, padding: 16, backgroundColor: colors.textInverse, borderWidth: 1, borderColor: colors.border, borderRadius: 18, gap: 2 },
  sname: { fontSize: 24, lineHeight: 30, letterSpacing: -0.48, flexShrink: 1 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12, marginBottom: 14 },
  fact: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 7, backgroundColor: colors.surface },
  wide: { alignSelf: 'stretch', minHeight: 44, borderRadius: 12, marginTop: 4 },
  sech: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },
  alts: { marginHorizontal: 16, backgroundColor: colors.textInverse, borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' },
  alt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  hair: { borderTopWidth: HAIR, borderTopColor: colors.borderStrong },
  rad: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  radOn: { borderWidth: 6, borderColor: colors.text },
  radPlus: { borderStyle: 'dashed' },
  ptarget: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 10 },
  pchip: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 26, paddingHorizontal: 8, borderRadius: 7, backgroundColor: colors.surface },
  ic: { marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: colors.textInverse, borderWidth: 1, borderColor: colors.border, borderRadius: 14, gap: 6 },
  icDone: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: 10 },
  tag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  iact: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 },
  due: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, borderColor: colors.borderStrong, alignSelf: 'flex-start' },
  dateEdit: { flexDirection: 'row', alignItems: 'center', gap: space[2], minWidth: 240 },
  srcl: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
  quote: { backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  mcard: { flexDirection: 'row', gap: 12, marginHorizontal: 16, marginTop: 4, padding: 14, backgroundColor: colors.textInverse, borderWidth: 1, borderColor: colors.border, borderRadius: 16 },
  mic: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  splitNote: { marginHorizontal: 20, marginTop: 12, marginBottom: 4 },
  pgrp: { marginHorizontal: 16, marginTop: 8, backgroundColor: colors.textInverse, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingTop: 4, overflow: 'hidden' },
  pgh: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8 },
  row2: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: HAIR, borderTopColor: colors.borderStrong },
  moving: { backgroundColor: colors.bg },
  mv: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  mvOn: { backgroundColor: colors.surface },
  picker: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 4, paddingBottom: 8, backgroundColor: colors.bg },
  pko: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.textInverse },
  pkoOn: { borderColor: colors.text },
  bottomCta: { position: 'absolute', left: 16, right: 16, bottom: 16 },
  fl: { fontSize: 12.5, fontWeight: '600', color: colors.textTertiary, marginTop: 10, marginBottom: 5 },
  fi: { backgroundColor: colors.surface, borderWidth: 0, borderRadius: 10, minHeight: 40 },
  chip: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: radius.full, borderWidth: 1, borderColor: colors.borderStrong },
  chipOn: { backgroundColor: colors.text, borderColor: colors.text },
  ckRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  ck: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  ckOn: { backgroundColor: colors.success, borderColor: colors.success },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 2 },
  switch: { width: 34, height: 20, borderRadius: 10, backgroundColor: colors.borderStrong, padding: 2, justifyContent: 'center' },
  switchOn: { backgroundColor: colors.success },
  knob: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.textInverse },
  knobOn: { alignSelf: 'flex-end' },
});

export type { ReactNode, Decision };
