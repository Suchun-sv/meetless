import { noDots, SEP, type Id, type IsoDate, type NeedStatus, type RoundStatus, type State } from '@meetless/core';
import type { MessageKey, Translator } from '@meetless/i18n';
import { requesterLabel } from '@renderer/inputs/model';
import { flowTimeline, type FlowEntry, type FlowFilter, type FlowItem, type FlowNode } from '@renderer/needs/lineage';
import { childrenOf } from '@renderer/needs/model';
import type { Target } from '../../chat/model/target';

// Source nodes, round sections and the one-line timeline are the desktop's own (`needs/lineage.ts`).
export {
  FLOW_FILTERS,
  firstMeaningful,
  flowNodes,
  flowSections,
  flowTimeline,
  inFilter,
  sceneOf,
  type FlowEntry,
  type FlowFilter,
  type FlowItem,
  type FlowNode,
  type FlowSection,
  type NodeType,
} from '@renderer/needs/lineage';

/*
 * The vertical 「脉络」 timeline as rows a screen draws top to bottom: oldest first, opened at today.
 * Each source is a card on the line with its date on the left; a DDL is a marker on the line; today
 * is a labelled rule across it. A card folds open to what it produced, and its original behind 「原文」.
 */

/** A source card, collapsed or open. */
export interface SceneCard {
  key: string;
  type: FlowNode['type'];
  typeLabel: string;
  /** Agent proposals are AI output: violet. Everything else neutral. */
  typeTone: 'ai' | 'neutral';
  /** A 「DeepSeek 识别」 pill: extracts DeepSeek found (not on proposals, already violet). */
  aiPill: boolean;
  title: string;
  gist: string | null;
  /** Who it came from and how much it produced, joined. */
  meta: string;
  /** The first produced item as one line, shown while collapsed. */
  preview: string;
  count: number;
  original: string[];
}

function itemPreview(live: State, it: FlowItem | undefined): string {
  if (!it) return '';
  if (it.kind === 'need' || it.kind === 'rev' || it.kind === 'decision') {
    const n = live.needs[it.needId];
    return n ? `${n.code} ${noDots(n.title)}` : '';
  }
  return noDots(it.text);
}

export function sceneCard(t: Translator['t'], live: State, node: FlowNode): SceneCard {
  const who = requesterLabel(live, node.from);
  return {
    key: node.key,
    type: node.type,
    typeLabel: t(`lin.type.${node.type}` as MessageKey),
    typeTone: node.type === 'proposal' ? 'ai' : 'neutral',
    aiPill: node.ai && node.type !== 'proposal',
    title: noDots(node.title),
    gist: node.gist ? noDots(node.gist) : null,
    meta: [who, t('lin.made', { n: node.items.length })].filter(Boolean).join(SEP),
    preview: itemPreview(live, node.items[0]),
    count: node.items.length,
    original: node.original.map(noDots),
  };
}

/** A row inside an open card. Needs nest their derived needs under a quiet 「衍生」, `depth` deep. */
export type ItemRow =
  | { kind: 'need'; key: string; needId: Id; status: NeedStatus; depth: number; derived: boolean; target: Target }
  | { kind: 'rev'; key: string; needId: Id; label: string; text: string; target: Target }
  | { kind: 'decision'; key: string; needId: Id; label: string; text: string; target: Target }
  | { kind: 'action'; key: string; label: string; text: string }
  | { kind: 'pending'; key: string; label: string; text: string; status: string; target: Target };

export function itemRows(t: Translator['t'], live: State, projectId: Id, items: readonly FlowItem[]): ItemRow[] {
  const out: ItemRow[] = [];
  const needTarget = (needId: Id): Target => ({ kind: 'need', projectId, needId });
  const walk = (needId: Id, depth: number, seen: Set<Id>, key: string) => {
    const n = live.needs[needId];
    if (!n || seen.has(needId)) return;
    seen.add(needId);
    out.push({ kind: 'need', key, needId, status: n.status, depth, derived: depth > 0, target: needTarget(needId) });
    for (const k of childrenOf(live, needId)) walk(k.id, depth + 1, seen, `${key}/${k.id}`);
  };
  items.forEach((it, i) => {
    const key = `${i}`;
    switch (it.kind) {
      case 'need':
        walk(it.needId, 0, new Set(), key);
        break;
      case 'rev':
        if (live.needs[it.needId]) out.push({ kind: 'rev', key, needId: it.needId, label: t('in.x.rev'), text: noDots(it.text), target: needTarget(it.needId) });
        break;
      case 'decision':
        if (live.needs[it.needId]) out.push({ kind: 'decision', key, needId: it.needId, label: t('lin.decision'), text: t(`lin.dec.${it.resolution}` as MessageKey), target: needTarget(it.needId) });
        break;
      case 'action':
        out.push({ kind: 'action', key, label: t('in.x.action'), text: noDots(it.text) });
        break;
      case 'pending':
        out.push({ kind: 'pending', key, label: t(`in.x.${it.type}`), text: noDots(it.text), status: t('lin.pending'), target: { kind: 'confirm', projectId } });
        break;
    }
  });
  return out;
}

/** One row on the line. `event` rows (a need's own handoffs, reports, revisions) show only on a need's route. */
export type LineRow =
  | { kind: 'today'; key: 'today'; label: string }
  | { kind: 'ddl'; key: string; date: string; text: string; status: RoundStatus }
  | { kind: 'src'; key: string; date: string; node: FlowNode; card: SceneCard }
  | { kind: 'event'; key: string; date: string; text: string; target: Target };

export function lineRows(t: Translator['t'], live: State, entries: readonly FlowEntry[], fmtDay: (d: IsoDate) => string): LineRow[] {
  return entries.map((e): LineRow => {
    if (e.kind === 'today') return { kind: 'today', key: 'today', label: t('tl.today') };
    if (e.kind === 'ddl') {
      const title = noDots(e.round.title) || t('round', { n: e.round.n });
      // The date is in the left column already.
      return { kind: 'ddl', key: `ddl-${e.round.id}`, date: fmtDay(e.date), text: t('lnv.ddl', { title }), status: e.round.status };
    }
    return { kind: 'src', key: e.node.key, date: e.node.date ? fmtDay(e.node.date) : t('lin.pending'), node: e.node, card: sceneCard(t, live, e.node) };
  });
}

/** The whole tab: rows, where today is (to scroll it into the upper third on open and on 「回到今天」), and whether any source shows. */
export interface LineageView {
  rows: LineRow[];
  todayIndex: number;
  empty: boolean;
}

export function lineageView(t: Translator['t'], live: State, projectId: Id, filter: FlowFilter, today: IsoDate, fmtDay: (d: IsoDate) => string): LineageView {
  const rows = lineRows(t, live, flowTimeline(live, projectId, filter, today), fmtDay);
  return { rows, todayIndex: rows.findIndex((r) => r.kind === 'today'), empty: !rows.some((r) => r.kind === 'src') };
}

/** Where to scroll so a row at `rowTop` sits in the upper third of a viewport `height` tall. */
export function scrollForToday(rowTop: number, height: number): number {
  return Math.max(0, rowTop - height / 3);
}

/** Open cards per project, for the session. */
const OPEN = new Map<Id, Set<string>>();

export function isOpen(projectId: Id, key: string): boolean {
  return OPEN.get(projectId)?.has(key) ?? false;
}

export function setOpen(projectId: Id, key: string, open: boolean): void {
  const set = OPEN.get(projectId) ?? new Set<string>();
  if (open) set.add(key);
  else set.delete(key);
  OPEN.set(projectId, set);
}

/** The need, its ancestors and everything derived from it: the family a need's 脉络 follows. */
export function needFamily(live: State, needId: Id): Set<Id> {
  const out = new Set<Id>();
  const down = (id: Id) => {
    if (out.has(id) || !live.needs[id]) return;
    out.add(id);
    for (const k of childrenOf(live, id)) down(k.id);
  };
  down(needId);
  for (let p = live.needs[needId]?.parentId ?? null; p && live.needs[p] && !out.has(p); p = live.needs[p]!.parentId) out.add(p);
  return out;
}

const itemNeed = (it: FlowItem): Id | null => (it.kind === 'need' || it.kind === 'rev' || it.kind === 'decision' ? it.needId : null);

/**
 * Whether a source concerns `family`: it produced a need, a revision or a decision on one, or (an
 * input) it holds a revision of one still waiting in To confirm.
 */
export function touches(node: FlowNode, family: ReadonlySet<Id>, live?: State): boolean {
  if (node.items.some((it) => family.has(itemNeed(it) ?? ''))) return true;
  const input = live && node.key.startsWith('in:') ? live.inputs[node.key.slice(3)] : undefined;
  return !!input?.extracts.some((x) => x.state === null && x.needId !== null && family.has(x.needId));
}

/** The source with the family's own items first, so its collapsed preview names the need, not a sibling. */
function focusItems(node: FlowNode, family: ReadonlySet<Id>): FlowNode {
  const mine = node.items.filter((it) => family.has(itemNeed(it) ?? ''));
  return mine.length === 0 ? node : { ...node, items: [...mine, ...node.items.filter((it) => !family.has(itemNeed(it) ?? ''))] };
}

/** A need's own history beyond its sources: revisions, handoffs and their answers, reported work. */
function needEvents(t: Translator['t'], live: State, projectId: Id, needId: Id): { date: IsoDate; seq: number; key: string; text: string; target: Target }[] {
  const n = live.needs[needId];
  if (!n) return [];
  const who = (id: Id) => noDots(live.users[id]?.displayName ?? id);
  const target: Target = { kind: 'need', projectId, needId };
  const out: { date: IsoDate; seq: number; key: string; text: string; target: Target }[] = [];
  n.revisions.forEach((r, i) => out.push({ date: r.date, seq: r.seq, key: `rev-${r.id}`, text: `${n.code} ${t('lnv.ev.rev', { v: i + 2, text: noDots(r.text) })}`, target }));
  for (const h of Object.values(live.handoffs)) {
    if (h.needId !== needId) continue;
    h.history.forEach((x, i) => {
      const text = i === 0 ? t('lnv.ev.handoff', { from: who(h.fromId), to: who(h.toId) }) : t('lnv.ev.state', { who: who(x.by), state: t(`ho.st.${x.state}` as MessageKey) });
      out.push({ date: x.at.slice(0, 10), seq: x.seq, key: `ho-${h.id}-${i}`, text: `${n.code} ${text}`, target });
    });
  }
  for (const w of Object.values(live.work)) {
    if (w.needId !== needId || w.capture) continue;
    out.push({ date: w.date, seq: (w as { seq?: number }).seq ?? 0, key: `wk-${w.id}`, text: `${n.code} ${t('lnv.ev.work', { who: who(w.by), text: noDots(w.text) })}`, target });
  }
  return out.sort((a, b) => (a.date === b.date ? a.seq - b.seq : a.date < b.date ? -1 : 1));
}

/** `lineageView`, optionally narrowed to one need's family: its sources (its items first) plus its own history (DDLs and today stay). */
export function needLineageView(t: Translator['t'], live: State, projectId: Id, filter: FlowFilter, today: IsoDate, fmtDay: (d: IsoDate) => string, needId: Id | null): LineageView {
  const family = needId && live.needs[needId] ? needFamily(live, needId) : null;
  const entries = flowTimeline(live, projectId, filter, today)
    .filter((e) => !family || e.kind !== 'node' || touches(e.node, family, live))
    .map((e) => (family && e.kind === 'node' ? { ...e, node: focusItems(e.node, family) } : e));
  let rows = lineRows(t, live, entries, fmtDay);
  if (needId && family && filter === 'all') {
    // Merge the need's own events in by date: each goes before the first row dated after it.
    const dated = entries.map((e) => (e.kind === 'today' ? today : e.kind === 'ddl' ? e.date : (e.node.date ?? '9999-12-31')));
    const merged: LineRow[] = [];
    const evs = needEvents(t, live, projectId, needId);
    let j = 0;
    rows.forEach((r, i) => {
      while (j < evs.length && evs[j]!.date < dated[i]!) {
        const ev = evs[j++]!;
        merged.push({ kind: 'event', key: ev.key, date: fmtDay(ev.date), text: ev.text, target: ev.target });
      }
      merged.push(r);
    });
    for (; j < evs.length; j++) merged.push({ kind: 'event', key: evs[j]!.key, date: fmtDay(evs[j]!.date), text: evs[j]!.text, target: evs[j]!.target });
    rows = merged;
  }
  return { rows, todayIndex: rows.findIndex((r) => r.kind === 'today'), empty: !rows.some((r) => r.kind === 'src' || r.kind === 'event') };
}
