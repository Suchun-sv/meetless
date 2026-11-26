import { projectInputs, projectNeeds, projectRounds, type Id, type Input, type IsoDate, type Need, type Requester, type Round, type Scene, type SourceKind, type State } from '@meetless/core';

/*
 * The Lineage tab as a time flow of where needs came from (no React, no i18n): sections by round,
 * newest first, each a list of source nodes (an input, a delivery's feedback, an agent proposal, the
 * needs added by hand on one day), each with the items it produced. Built from the viewer's own
 * state, so another user's private items never appear.
 */

export type NodeType = Scene | 'delivery' | 'proposal' | 'manual';
/** The type filter at the top: every node, or one family of them. */
export type FlowFilter = 'all' | 'meeting' | 'mail' | 'chat' | 'agent' | 'doc' | 'delivery';

export const FLOW_FILTERS: readonly FlowFilter[] = ['all', 'meeting', 'mail', 'chat', 'agent', 'doc', 'delivery'];

export function inFilter(f: FlowFilter, t: NodeType): boolean {
  if (f === 'all') return true;
  if (f === 'agent') return t === 'agent' || t === 'proposal';
  if (f === 'doc') return t === 'doc' || t === 'handwritten';
  return t === f;
}

/** One thing a source produced. `needId` rows open the need drawer; pending ones open To confirm. */
export type FlowItem =
  | { kind: 'need'; needId: Id }
  | { kind: 'rev'; needId: Id; text: string }
  | { kind: 'action'; text: string }
  | { kind: 'decision'; needId: Id; resolution: 'revise' | 'park' | 'handoff' }
  | { kind: 'pending'; type: 'new' | 'hyp' | 'rev' | 'action'; text: string };

export interface FlowNode {
  key: string;
  type: NodeType;
  date: IsoDate | null;
  /** A member id or an outside name; null when nobody is named. */
  from: Requester | null;
  title: string;
  items: FlowItem[];
  /** What clicking the node shows: the input's paragraphs, or the delivery's notes. */
  original: string[];
  /** What tells this source apart, under its title: a summary, else its first meaningful paragraph. */
  gist: string | null;
  /** Produced by AI: an agent proposal, or extracts DeepSeek found. */
  ai: boolean;
  seq: number;
}

export interface FlowSection {
  round: Round | null;
  nodes: FlowNode[];
}

/** The scene an input shows as: its own, else what its file kind suggests (inputs from before scenes). */
export function sceneOf(i: Input): Scene {
  if (i.scene) return i.scene;
  return i.kind === 'md' ? 'meeting' : i.kind === 'txt' ? 'chat' : 'doc';
}

const HEADER = /^(发件人|收件人|抄送|主题|发送时间|日期|from|to|cc|subject|date|sent)\s*[:：]/i;

/** The first paragraph that says something: not a mail header, not the title again, not a stub. */
export function firstMeaningful(paras: readonly string[], title = ''): string | null {
  for (const p of paras) {
    const t = p.trim();
    if ([...t].length < 6 || HEADER.test(t) || t === title.trim()) continue;
    return t;
  }
  return null;
}

/** The scene a need's own source kind reads as, for needs with no input behind them. */
const SRC_TYPE: Partial<Record<SourceKind, NodeType>> = { meeting: 'meeting', mail: 'mail', chat: 'chat', doc: 'doc', file: 'doc', commit: 'doc', exp: 'doc' };

/** A need shown under its parent ("衍生") rather than on its own. */
const nested = (s: State, n: Need) => n.parentId !== null && s.needs[n.parentId] !== undefined;

function inputNode(s: State, i: Input): FlowNode {
  const items: FlowItem[] = [];
  for (const x of i.extracts) {
    if (x.state === null) items.push({ kind: 'pending', type: x.type, text: x.text });
    else if (x.state === 'accepted' && x.type === 'rev' && x.resultNeedId) items.push({ kind: 'rev', needId: x.resultNeedId, text: x.text });
    else if (x.state === 'accepted' && x.resultNeedId && s.needs[x.resultNeedId] && !nested(s, s.needs[x.resultNeedId]!)) items.push({ kind: 'need', needId: x.resultNeedId });
    else if (x.state === 'accepted' && x.type === 'action') items.push({ kind: 'action', text: x.text });
  }
  for (const c of Object.values(s.conflicts)) {
    if (c.inputId === i.id && c.resolution) items.push({ kind: 'decision', needId: c.needId, resolution: c.resolution.kind });
  }
  return {
    key: `in:${i.id}`,
    type: sceneOf(i),
    date: i.date,
    from: i.from ?? { userId: i.importedBy },
    title: i.title,
    items,
    original: i.body.map((p) => p.text),
    gist: i.summary ?? firstMeaningful(i.body.map((p) => p.text), i.title),
    ai: i.detector.startsWith('deepseek'),
    seq: i.seq,
  };
}

/** Every source node of the project, unsorted. */
export function flowNodes(s: State, projectId: Id): FlowNode[] {
  const nodes: FlowNode[] = projectInputs(s, projectId).map((i) => inputNode(s, i));
  const needs = projectNeeds(s, projectId);
  for (const r of projectRounds(s, projectId)) {
    if (!r.delivery) continue;
    const fed = needs.filter((n) => n.fromRoundId === r.id && !nested(s, n));
    nodes.push({
      key: `dl:${r.id}`,
      type: 'delivery',
      date: r.delivery.date,
      from: { userId: r.delivery.by },
      title: r.title,
      items: fed.map((n) => ({ kind: 'need', needId: n.id })),
      original: [...r.delivery.items, ...fed.map((n) => n.source.quote)],
      gist: firstMeaningful([...r.delivery.items, ...fed.map((n) => n.source.quote)]),
      ai: false,
      seq: r.delivery.seq,
    });
  }
  for (const p of Object.values(s.proposals)) {
    if (p.projectId !== projectId || p.status === 'rejected') continue;
    const need = p.needId ? s.needs[p.needId] : undefined;
    nodes.push({
      key: `pr:${p.id}`,
      type: 'proposal',
      date: need?.source.date ?? null,
      from: { userId: p.by },
      title: p.title,
      items: need ? (nested(s, need) ? [] : [{ kind: 'need', needId: need.id }]) : [{ kind: 'pending', type: p.kind === 'hyp' ? 'hyp' : 'new', text: p.title }],
      original: [p.why ?? p.accept ?? p.expect ?? p.title],
      gist: p.why ?? null,
      ai: true,
      seq: p.seq,
    });
  }
  // Needs with no input behind them but a named source (「ICML 2027 审稿邀请邮件」): one scene per
  // (kind, source, day), or the project's input of that title when there is one, so its summary and
  // original text apply. Only needs with no source name stay as 「手动添加」, one node per day.
  const inputByTitle = new Map<string, FlowNode>();
  for (const node of nodes) if (node.key.startsWith('in:')) inputByTitle.set(node.title.trim(), node);
  const named = new Map<string, FlowNode>();
  const manual = new Map<IsoDate, Need[]>();
  for (const n of needs) {
    if (n.source.inputId || n.source.proposalId || n.fromRoundId || nested(s, n)) continue;
    const ref = n.source.ref.trim();
    if (ref && n.source.src !== 'agent') {
      const own = inputByTitle.get(ref);
      if (own) {
        own.items.push({ kind: 'need', needId: n.id });
        continue;
      }
      const key = `src:${n.source.src}|${ref}|${n.source.date}`;
      const node =
        named.get(key) ??
        ({ key, type: SRC_TYPE[n.source.src] ?? 'doc', date: n.source.date, from: n.requester, title: ref, items: [], original: [], gist: null, ai: false, seq: n.createdSeq } satisfies FlowNode);
      node.items.push({ kind: 'need', needId: n.id });
      node.original.push(n.source.quote);
      node.seq = Math.max(node.seq, n.createdSeq);
      named.set(key, node);
      continue;
    }
    manual.set(n.source.date, [...(manual.get(n.source.date) ?? []), n]);
  }
  for (const node of named.values()) nodes.push({ ...node, gist: firstMeaningful(node.original) });
  for (const [date, ns] of manual) {
    nodes.push({
      key: `mn:${date}`,
      type: 'manual',
      date,
      from: null,
      title: '',
      items: ns.map((n) => ({ kind: 'need', needId: n.id })),
      original: ns.map((n) => n.source.quote),
      gist: null,
      ai: false,
      seq: Math.max(...ns.map((n) => n.createdSeq)),
    });
  }
  return nodes;
}

/**
 * Sections newest first: one per round holding the nodes dated inside it (start to due), then
 * 「其他」 for the rest; nodes newest first. A node with no date (an open proposal) is newest.
 */
export function flowSections(s: State, projectId: Id, filter: FlowFilter = 'all'): FlowSection[] {
  const rounds = projectRounds(s, projectId).sort((a, b) => b.n - a.n);
  const by = new Map<Id | null, FlowNode[]>();
  const today = new Date().toISOString().slice(0, 10);
  for (const node of flowNodes(s, projectId)) {
    if (!inFilter(filter, node.type)) continue;
    const d = node.date ?? today;
    const r = rounds.find((x) => x.start <= d && d <= x.due) ?? null;
    by.set(r?.id ?? null, [...(by.get(r?.id ?? null) ?? []), node]);
  }
  const newest = (a: FlowNode, b: FlowNode) => (b.date ?? '9999').localeCompare(a.date ?? '9999') || b.seq - a.seq;
  const out: FlowSection[] = [];
  for (const r of rounds) {
    const ns = by.get(r.id);
    if (ns?.length) out.push({ round: r, nodes: ns.sort(newest) });
  }
  const rest = by.get(null);
  if (rest?.length) out.push({ round: null, nodes: rest.sort(newest) });
  return out;
}

/** One entry on the vertical lineage line: a source, a DDL's due date, or today. */
export type FlowEntry = { kind: 'node'; date: IsoDate; node: FlowNode } | { kind: 'ddl'; date: IsoDate; round: Round } | { kind: 'today'; date: IsoDate };

/**
 * The lineage as one line, oldest first so it reads downward in time: the sources (filtered), each
 * DDL's due date, and today (future DDLs below it). A source with no date (an open agent proposal)
 * counts as today. On one day the sources come first, then today, then the DDL (due at day's end).
 */
export function flowTimeline(s: State, projectId: Id, filter: FlowFilter, today: IsoDate): FlowEntry[] {
  const out: FlowEntry[] = [];
  for (const node of flowNodes(s, projectId)) if (inFilter(filter, node.type)) out.push({ kind: 'node', date: node.date ?? today, node });
  for (const r of projectRounds(s, projectId)) out.push({ kind: 'ddl', date: r.due, round: r });
  out.push({ kind: 'today', date: today });
  const order = { node: 0, today: 1, ddl: 2 } as const;
  return out.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind] || (a.kind === 'node' && b.kind === 'node' ? a.node.seq - b.node.seq : 0));
}
