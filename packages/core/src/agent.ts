import { cardFromText, homeItems, weeklyCard } from './dashboard';
import { currentRound } from './reducer';
import { handoffStaleness, membersOf, needByCode, projectNeeds, questionId, questions, toConfirm } from './queries';
import { looksLikeAdd, looksLikeQuestion } from './detect';
import { groupByNeed, materialHits, search, type SearchHit } from './search';
import { codesIn, daysBetween, tokens } from './text';
import type { CardId, ExtractType, Id, NeedStatus, State } from './types';

/**
 * The project agent. There is one per project, shared by the team.
 *
 * SIMULATED: no model is called. Answers are keyword retrieval over the
 * project record with citations (rules/1); intents ("what first today",
 * "deadlines", "this week", "delivery note") are matched by keywords and
 * answered from live state. Every reply carries `simulated: true` and the
 * provider id, and the UI labels it. A real model can be plugged in behind
 * `ProjectAgentProvider` later (see the inert Claude adapter in the server).
 */
export const RULES_PROVIDER_ID = 'rules/1';

export type AgentScope = { kind: 'home' } | { kind: 'project'; projectId: Id };

export interface AgentRequest {
  userId: Id;
  scope: AgentScope;
  text: string;
  /** YYYY-MM-DD */
  today: string;
}

export type AgentAnswer =
  /** `materials`: matching inputs and artifacts linked to no need (at the page for artifact text); empty when none. */
  /** `text`: a generated answer (DeepSeek, server side); the needs and materials are then the ones it cited. */
  | { intent: 'retrieval'; needs: { needId: Id; hits: SearchHit[] }[]; materials: MaterialCite[]; cites: Id[]; text?: string }
  | { intent: 'summary'; projectId: Id | null; round: { roundId: Id; daysLeft: number } | null; counts: Record<'doing' | 'todo' | 'met', number>; projects: number; cites: Id[] }
  /** 'confirm' covers extracts and questions; its id is the To confirm id (HomeItems.confirm). */
  | { intent: 'today'; items: { kind: 'conflict' | 'toMe' | 'mine' | 'stale' | 'proposal' | 'confirm'; projectId: Id; id: Id; needId: Id | null; daysLeft: number | null }[]; cites: Id[] }
  | { intent: 'deadlines'; items: { projectId: Id; roundId: Id; daysLeft: number }[]; cites: Id[] }
  | { intent: 'weekly'; projectId: Id; people: { userId: Id; count: number; text: string; needId: Id | null }[]; cites: Id[] }
  | { intent: 'delivery'; projectId: Id; roundId: Id | null; lines: { needId: Id; status: NeedStatus }[]; cites: Id[] }
  | { intent: 'addCard'; card: CardId; cites: Id[] }
  | { intent: 'asInput'; cites: Id[] }
  /**
   * Text given to add, imported by the server (`agent.ask`) as the input `inputId`, whose extracts
   * wait in To confirm. `items` are those extracts as they were proposed; `private` is the input's.
   */
  | { intent: 'added'; projectId: Id; inputId: Id; private: boolean; items: { extractId: Id; type: ExtractType; text: string; needId: Id | null }[]; cites: Id[] }
  /** An actionable handoff: the need and the member named in the text (either may be missing). Project scope only. */
  | { intent: 'handoff'; projectId: Id; needId: Id | null; toId: Id | null; cites: Id[] }
  /** The user's handoffs whose recipient's agent holds an older context version. */
  | { intent: 'stale'; items: { projectId: Id; handoffId: Id; needId: Id; fetched: number; current: number; reminded: boolean }[]; cites: Id[] };

/**
 * An input or artifact the answer cites. `versionId` and `page` (zero-based) are set when the text came from an
 * artifact version's `derived.texts`; `paraId` when it came from one paragraph of an input. `text` is a window of
 * at most 240 characters around the first match, with an ellipsis on each side that was cut.
 */
export interface MaterialCite {
  kind: 'input' | 'artifact';
  id: Id;
  projectId: Id;
  versionId: Id | null;
  page: number | null;
  paraId?: Id | null;
  text: string;
  title: string;
}

/** Why a free question got the rule answer instead of a generated one. */
export type AgentFallback = 'not_configured' | 'error' | 'timeout' | 'budget' | 'rate' | 'offline';

export interface AgentReply {
  answer: AgentAnswer;
  provider: string;
  simulated: boolean;
  /** Set by `POST /v1/agent/ask`: who wrote the answer. Absent on replies built in the client. */
  source?: 'deepseek' | 'rules';
  /** Set when a free question fell back to the rule answer. */
  fallback?: AgentFallback;
}

/** A free question (retrieval or summary): the only kind the server sends to the model. Every other intent stays rule-based. */
export function isFreeQuestion(a: AgentAnswer): boolean {
  return a.intent === 'retrieval' || a.intent === 'summary';
}

export interface ProjectAgentProvider {
  readonly id: string;
  readonly simulated: boolean;
  answer(view: State, req: AgentRequest): Promise<AgentReply>;
}

const TODAY = /先做|先干|今天|优先|first|today|priorit|waiting on me|等我/i;
const DEADLINE = /截止|到期|期限|deadline|due date|\bdue\b/i;
const WEEKLY = /本周|这周|周报|this week|weekly|by person|各岗位|by role/i;
const DELIVERY = /交付说明|交付草稿|delivery note|release note/i;
// 交给我 / 转给我 is about what was handed to the asker, not a handoff to make.
const HANDOFF = /交给(?!我)|转给(?!我)|\bhand(?:\s+(?:it|this))?\s+(?:off|over)\s+to\b|\bhand\s+(?:\S+\s+)?(?:over\s+)?to\b|\bassign\s+to\b/i;
const STALE = /过时|旧版本|stale|out of date|outdated/i;

/** Whether `name` occurs in `t` (both lower-cased). ASCII names must stand as whole words ("An" is not in "hand"). */
function mentions(t: string, name: string): boolean {
  if (!/^[\x20-\x7e]+$/.test(name)) return t.includes(name);
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`).test(t);
}

/** The project member named in the text (case-insensitive; the longest name wins), never the asker. */
function memberIn(view: State, projectId: Id, userId: Id, text: string): Id | null {
  const t = text.toLowerCase();
  let best: { id: Id; len: number } | null = null;
  for (const m of membersOf(view, projectId)) {
    const name = view.users[m]?.displayName.trim().toLowerCase();
    if (m === userId || !name || !mentions(t, name)) continue;
    if (!best || name.length > best.len) best = { id: m, len: name.length };
  }
  return best?.id ?? null;
}

const memberProjects = (view: State, userId: Id) => Object.values(view.projects).filter((p) => p.memberIds.includes(userId)).map((p) => p.id);

/**
 * Text in a project that looks like content to add rather than a question: several lines, more
 * than 80 characters, or the shape of an add (`looksLikeAdd`: 需要：..., a numbered list).
 */
export function looksLikeInput(text: string): boolean {
  const t = text.trim();
  return /\n/.test(t) || (t.length > 80 && !looksLikeQuestion(t)) || looksLikeAdd(t);
}

/** Code-point offset in `t` of the first word or Chinese bigram that is one of the question's tokens (0 if none). */
function firstMatch(t: string, q: ReadonlySet<string>): number {
  let at = -1; // UTF-16 index
  for (const m of t.matchAll(/[a-z0-9_][a-z0-9_.-]*/gi)) {
    if (tokens(m[0]).some((x) => q.has(x))) {
      at = m.index;
      break;
    }
  }
  for (const m of t.matchAll(/\p{Script=Han}+/gu)) {
    if (at !== -1 && m.index >= at) break;
    const run = [...m[0]];
    let off = m.index;
    let found = run.length === 1 && q.has(run[0]!);
    for (let i = 0; !found && i + 1 < run.length; i++) {
      if (q.has(run[i]! + run[i + 1]!)) found = true;
      else off += run[i]!.length;
    }
    if (found) {
      at = off;
      break;
    }
  }
  return at <= 0 ? 0 : [...t.slice(0, at)].length;
}

/**
 * At most `n` characters (code points, so a CJK or astral character is never split) of `text`, centred on the
 * first match of the question, with an ellipsis on each side that was cut.
 */
export function snippet(text: string, q: ReadonlySet<string>, n: number): string {
  const t = text.trim();
  const cps = [...t];
  if (cps.length <= n) return t;
  const at = firstMatch(t, q);
  const half = Math.floor((n - 2) / 2);
  if (at - half <= 0) return `${cps.slice(0, n - 1).join('').trimEnd()}…`;
  if (at - half + (n - 1) >= cps.length) return `…${cps.slice(cps.length - (n - 1)).join('').trimStart()}`;
  return `…${cps.slice(at - half, at - half + (n - 2)).join('').trim()}…`;
}

export function answer(view: State, req: AgentRequest): AgentReply {
  const reply = (a: AgentAnswer): AgentReply => ({ answer: a, provider: RULES_PROVIDER_ID, simulated: true });
  const { userId, scope, text, today } = req;
  const projectId = scope.kind === 'project' ? scope.projectId : null;

  const card = cardFromText(text, scope.kind === 'home' ? 'home' : 'project');
  if (card) return reply({ intent: 'addCard', card, cites: [] });
  if (projectId && looksLikeInput(text)) return reply({ intent: 'asInput', cites: [] });

  if (HANDOFF.test(text) && projectId) {
    // Only shared needs can be handed off.
    const need = codesIn(text).map((c) => needByCode(view, projectId, c)).find((n) => n !== null && n.privateTo === null) ?? null;
    const toId = memberIn(view, projectId, userId, text);
    return reply({ intent: 'handoff', projectId, needId: need?.id ?? null, toId, cites: need ? [need.id] : [] });
  }
  if (STALE.test(text)) {
    const pids = new Set(projectId ? [projectId] : memberProjects(view, userId));
    const items: Extract<AgentAnswer, { intent: 'stale' }>['items'] = [];
    for (const h of Object.values(view.handoffs).sort((a, b) => a.createdSeq - b.createdSeq)) {
      if (h.fromId !== userId || !pids.has(h.projectId)) continue;
      const st = handoffStaleness(view, h);
      if (st) items.push({ projectId: h.projectId, handoffId: h.id, needId: h.needId, ...st });
    }
    return reply({ intent: 'stale', items, cites: [...new Set(items.map((i) => i.needId))] });
  }

  if (DELIVERY.test(text) && projectId) {
    const r = currentRound(view, projectId);
    const lines = projectNeeds(view, projectId)
      .filter((n) => n.privateTo === null && n.kind === 'ext' && r && n.roundId === r.id)
      .map((n) => ({ needId: n.id, status: n.status }));
    return reply({ intent: 'delivery', projectId, roundId: r?.id ?? null, lines, cites: lines.map((l) => l.needId) });
  }
  if (WEEKLY.test(text) && projectId) {
    const people = weeklyCard(view, projectId, today).map((w) => ({ userId: w.userId, count: w.count, text: w.last.text, needId: w.last.needId }));
    return reply({ intent: 'weekly', projectId, people, cites: people.flatMap((p) => (p.needId ? [p.needId] : [])) });
  }
  if (TODAY.test(text)) {
    const h = homeItems(view, userId, today);
    const items: Extract<AgentAnswer, { intent: 'today' }>['items'] = [];
    const inScope = (pid: Id) => !projectId || pid === projectId;
    const stale = new Map(questions(view, userId, projectId, today).flatMap((q) => (q.kind === 'stale' ? [[questionId(q), q] as const] : [])));
    for (const c of h.confirm.filter((x) => inScope(x.projectId))) {
      if (c.kind === 'conflict') items.push({ kind: 'conflict', projectId: c.projectId, id: c.id, needId: view.conflicts[c.id]?.needId ?? null, daysLeft: null });
      else if (c.kind === 'proposal') items.push({ kind: 'proposal', projectId: c.projectId, id: c.id, needId: null, daysLeft: null });
      else {
        const q = stale.get(c.id);
        items.push({ kind: 'confirm', projectId: c.projectId, id: c.id, needId: q?.needId ?? null, daysLeft: q?.daysLeft ?? null });
      }
    }
    for (const t of h.toMe.filter((x) => inScope(x.projectId))) {
      const ho = view.handoffs[t.handoffId]!;
      items.push({ kind: 'toMe', projectId: t.projectId, id: t.handoffId, needId: t.needId, daysLeft: ho.due ? daysBetween(today, ho.due) : null });
    }
    for (const b of h.byMe.filter((x) => inScope(x.projectId) && x.stale)) items.push({ kind: 'stale', projectId: b.projectId, id: b.handoffId, needId: b.needId, daysLeft: null });
    for (const m of h.mine.filter((x) => inScope(x.projectId))) {
      if (items.some((i) => i.needId === m.needId)) continue;
      const n = view.needs[m.needId]!;
      const r = n.roundId ? view.rounds[n.roundId] : null;
      items.push({ kind: 'mine', projectId: m.projectId, id: m.needId, needId: m.needId, daysLeft: r ? daysBetween(today, r.due) : null });
    }
    const rank = { conflict: 0, toMe: 1, stale: 2, proposal: 3, confirm: 3, mine: 4 } as const;
    items.sort((a, b) => rank[a.kind] - rank[b.kind] || (a.daysLeft ?? 99) - (b.daysLeft ?? 99));
    return reply({ intent: 'today', items: items.slice(0, 6), cites: items.slice(0, 6).flatMap((i) => (i.needId ? [i.needId] : [])) });
  }
  if (DEADLINE.test(text)) {
    const items = homeItems(view, userId, today).due.filter((d) => !projectId || d.projectId === projectId);
    return reply({ intent: 'deadlines', items, cites: [] });
  }

  const hits = search(view, { text, projectId, limit: 30 });
  const groups = groupByNeed(hits);
  const asked = new Set(tokens(text));
  const materials: MaterialCite[] = materialHits(hits).map((h) => ({
    kind: h.kind as MaterialCite['kind'],
    id: h.id,
    projectId: h.projectId,
    versionId: h.versionId ?? null,
    page: h.page ?? null,
    ...(h.paraId ? { paraId: h.paraId } : {}),
    text: snippet(h.text, asked, 240),
    title: (h.kind === 'input' ? view.inputs[h.id]?.title : view.artifacts[h.id]?.title) ?? '',
  }));
  if (groups.length > 0 || materials.length > 0) {
    // Need ids only, as in every other intent; materials carry their own ids.
    const cites = groups.map((g) => g.needId);
    return reply({ intent: 'retrieval', needs: groups.map((g) => ({ needId: g.needId, hits: g.hits })), materials, cites });
  }

  // Nothing matched: a short summary of where things stand.
  const pids = projectId ? [projectId] : memberProjects(view, userId);
  const counts = { doing: 0, todo: 0, met: 0 };
  let round: { roundId: Id; daysLeft: number } | null = null;
  for (const pid of pids) {
    const r = currentRound(view, pid);
    if (projectId && r) round = { roundId: r.id, daysLeft: daysBetween(today, r.due) };
    for (const n of projectNeeds(view, pid)) {
      if (n.privateTo !== null || (r && n.roundId !== r.id)) continue;
      if (n.status === 'doing' || n.status === 'partial' || n.status === 'testing') counts.doing++;
      else if (n.status === 'todo' || n.status === 'untested') counts.todo++;
      else if (n.status === 'met' || n.status === 'held') counts.met++;
    }
  }
  return reply({ intent: 'summary', projectId, round, counts, projects: pids.length, cites: [] });
}

export const rulesProvider: ProjectAgentProvider = {
  id: RULES_PROVIDER_ID,
  simulated: true,
  answer: async (view, req) => answer(view, req),
};

// ---------------------------------------------------------------- suggestion chips

export type Suggestion =
  | { id: string; kind: 'stale'; hot: true; projectId: Id; handoffId: Id; needId: Id; userId: Id }
  | { id: string; kind: 'toMe'; hot: true; projectId: Id; handoffId: Id; needId: Id; userId: Id }
  | { id: string; kind: 'conflict'; hot: true; projectId: Id; n: number }
  | { id: string; kind: 'proposal'; hot: true; projectId: Id; n: number }
  | { id: string; kind: 'addCard'; hot: false; card: CardId }
  | { id: string; kind: 'ask'; hot: false; prompt: 'today' | 'deadlines' | 'weekly' | 'delivery' };

/** Dynamic chips above the composer, computed from the record (rule-based). */
export function suggestions(view: State, userId: Id, scope: AgentScope, today: string, opts: { dashboardCards?: CardId[] | null; pool?: readonly CardId[] } = {}): Suggestion[] {
  const out: Suggestion[] = [];
  const pids = scope.kind === 'project' ? [scope.projectId] : memberProjects(view, userId);
  const hot: Suggestion[] = [];
  for (const pid of pids) {
    for (const h of Object.values(view.handoffs).filter((x) => x.projectId === pid).sort((a, b) => a.createdSeq - b.createdSeq)) {
      const st = handoffStaleness(view, h);
      if (h.fromId === userId && st && !st.reminded) hot.push({ id: `stale-${h.id}`, kind: 'stale', hot: true, projectId: pid, handoffId: h.id, needId: h.needId, userId: h.toId });
      if (h.toId === userId && h.state === 'sent') hot.push({ id: `tome-${h.id}`, kind: 'toMe', hot: true, projectId: pid, handoffId: h.id, needId: h.needId, userId: h.fromId });
    }
    const tc = toConfirm(view, userId, pid, today);
    const cf = tc.conflicts.length;
    if (cf) hot.push({ id: `cf-${pid}`, kind: 'conflict', hot: true, projectId: pid, n: cf });
    const pr = tc.proposals.length;
    if (pr) hot.push({ id: `pr-${pid}`, kind: 'proposal', hot: true, projectId: pid, n: pr });
  }
  const onDash = opts.dashboardCards != null;
  out.push(...(onDash || scope.kind === 'home' ? hot.slice(0, 2) : hot));
  if (onDash && opts.pool) for (const c of opts.pool) if (!opts.dashboardCards!.includes(c)) out.push({ id: `add-${c}`, kind: 'addCard', hot: false, card: c });
  if (scope.kind === 'home') out.push({ id: 'ask-today', kind: 'ask', hot: false, prompt: 'today' }, { id: 'ask-deadlines', kind: 'ask', hot: false, prompt: 'deadlines' });
  else if (!onDash) out.push({ id: 'ask-delivery', kind: 'ask', hot: false, prompt: 'delivery' }, { id: 'ask-weekly', kind: 'ask', hot: false, prompt: 'weekly' });
  return out;
}
