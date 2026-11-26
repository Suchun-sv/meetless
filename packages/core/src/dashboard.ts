import { currentRound, needVersion } from './reducer';
import { handoffStaleness, inputStatus, isOpen, openConflicts, openProposals, projectInputs, projectNeeds, projectWork, questionId, rolesOf, toConfirm } from './queries';
import { daysBetween } from './text';
import {
  CLOSED_STATUSES,
  DEFAULT_HOME_CARDS,
  DEFAULT_PROJECT_CARDS,
  HOME_CARDS,
  PROJECT_CARDS,
  dashboardKey,
  type CardId,
  type Handoff,
  type Id,
  type Need,
  type NeedStatus,
  type Round,
  type State,
  type WorkItem,
} from './types';

/**
 * Dashboard cards, computed live from the record (never stored). Project
 * cards exclude private items; Home's "owned by me" includes the viewer's own.
 * Card selection from a request is rule-based (keywords), labelled as such.
 */

export type RiskTone = 'amber' | 'violet' | 'gray' | 'red';
export interface Risk {
  tone: RiskTone;
  code: 'stale' | 'waitMe' | 'wait' | 'asked' | 'conflict' | 'inputs' | 'todo' | 'proposal';
  projectId: Id;
  needId?: Id;
  handoffId?: Id;
  userId?: Id;
  n?: number;
  v?: number;
  days?: number;
  /** What a click opens. */
  go?: 'confirm' | 'inputs' | 'need';
}

export interface ProgressCard {
  round: Round | null;
  daysLeft: number | null;
  ext: number;
  done: number;
  doing: number;
  todo: number;
  hypTesting: number;
}

export interface MemberRow {
  userId: Id;
  role: string | null;
  owns: number;
  last: WorkItem | null;
  handoffs: Handoff[];
}

const shared = (n: Need) => n.privateTo === null;
const sharedWork = (w: WorkItem) => w.privateTo === null && !w.capture && !w.ignored;

export function cardsFor(s: State, userId: Id, scope: Id): { cards: CardId[]; refreshed: Record<string, string> } {
  const d = s.dashboards[dashboardKey(userId, scope)];
  // The timeline came later: a set saved before it gets it once, at the top, unless it was removed (its stamp stays then).
  if (d && !d.cards.includes('timeline') && !Object.hasOwn(d.refreshed, 'timeline')) return { cards: ['timeline', ...d.cards], refreshed: d.refreshed };
  if (d) return { cards: d.cards, refreshed: d.refreshed };
  return { cards: [...(scope === 'home' ? DEFAULT_HOME_CARDS : DEFAULT_PROJECT_CARDS)], refreshed: {} };
}

export function progressCard(s: State, projectId: Id, today: string): ProgressCard {
  const r = currentRound(s, projectId);
  const needs = projectNeeds(s, projectId).filter((n) => shared(n) && r && n.roundId === r.id);
  const ext = needs.filter((n) => n.kind === 'ext' && n.status !== 'dropped');
  const done = ext.filter((n) => n.status === 'met').length;
  const doing = ext.filter((n) => n.status === 'doing' || n.status === 'partial').length;
  return {
    round: r,
    daysLeft: r ? daysBetween(today, r.due) : null,
    ext: ext.length,
    done,
    doing,
    todo: ext.length - done - doing,
    hypTesting: needs.filter((n) => n.kind === 'hyp' && (n.status === 'testing' || n.status === 'untested')).length,
  };
}

export function riskList(s: State, userId: Id, projectId: Id, today: string): Risk[] {
  const out: Risk[] = [];
  for (const h of Object.values(s.handoffs).filter((x) => x.projectId === projectId).sort((a, b) => a.createdSeq - b.createdSeq)) {
    const st = handoffStaleness(s, h);
    if (h.fromId === userId && st && !st.reminded) out.push({ tone: 'amber', code: 'stale', projectId, needId: h.needId, handoffId: h.id, userId: h.toId, v: st.fetched, go: 'need' });
    if (h.state === 'sent') {
      out.push(h.toId === userId ? { tone: 'violet', code: 'waitMe', projectId, needId: h.needId, handoffId: h.id, go: 'need' } : { tone: 'gray', code: 'wait', projectId, needId: h.needId, handoffId: h.id, userId: h.toId, go: 'need' });
    }
    if (h.state === 'asked' && h.fromId === userId) out.push({ tone: 'amber', code: 'asked', projectId, needId: h.needId, handoffId: h.id, userId: h.toId, go: 'need' });
  }
  const cf = openConflicts(s, projectId).length;
  if (cf) out.push({ tone: 'amber', code: 'conflict', projectId, n: cf, go: 'confirm' });
  const pr = openProposals(s, projectId).length;
  if (pr) out.push({ tone: 'violet', code: 'proposal', projectId, n: pr, go: 'confirm' });
  const inp = projectInputs(s, projectId).filter((i) => i.privateTo === null && inputStatus(i) === 'pending').length;
  if (inp) out.push({ tone: 'gray', code: 'inputs', projectId, n: inp, go: 'inputs' });
  const r = currentRound(s, projectId);
  if (r) {
    const left = daysBetween(today, r.due);
    if (left <= 5) {
      for (const n of projectNeeds(s, projectId)) {
        if (shared(n) && n.roundId === r.id && n.kind === 'ext' && n.status === 'todo') out.push({ tone: 'red', code: 'todo', projectId, needId: n.id, days: left, go: 'need' });
      }
    }
  }
  return out;
}

export function membersCard(s: State, projectId: Id): MemberRow[] {
  const needs = projectNeeds(s, projectId).filter(shared);
  const work = projectWork(s, projectId).filter(sharedWork);
  const rows: MemberRow[] = [];
  for (const ro of rolesOf(s, projectId)) {
    for (const m of ro.memberIds) {
      rows.push({
        userId: m,
        role: ro.name,
        owns: needs.filter((n) => n.ownerId === m && isOpen(n)).length,
        last: work.filter((w) => w.by === m && w.src !== 'meeting').at(-1) ?? null,
        handoffs: Object.values(s.handoffs).filter((h) => h.projectId === projectId && (h.toId === m || h.fromId === m) && h.state !== 'done' && h.state !== 'declined'),
      });
    }
  }
  return rows;
}

/** Delivery readiness: the current round's shared external needs with their status. */
export function deliveryCard(s: State, projectId: Id): { round: Round | null; lines: { needId: Id; status: NeedStatus }[] } {
  const r = currentRound(s, projectId);
  if (!r) return { round: null, lines: [] };
  return { round: r, lines: projectNeeds(s, projectId).filter((n) => shared(n) && n.roundId === r.id && n.kind === 'ext').map((n) => ({ needId: n.id, status: n.status })) };
}

export function hypothesesCard(s: State, projectId: Id): { counts: Record<'held' | 'refuted' | 'testing' | 'untested', number>; recent: Id[] } {
  const hs = projectNeeds(s, projectId).filter((n) => shared(n) && n.kind === 'hyp');
  const c = (x: NeedStatus) => hs.filter((n) => n.status === x).length;
  return { counts: { held: c('held'), refuted: c('refuted'), testing: c('testing'), untested: c('untested') }, recent: hs.slice(-4).reverse().map((n) => n.id) };
}

export function activityCard(s: State, projectId: Id, n = 6): WorkItem[] {
  return projectWork(s, projectId).filter(sharedWork).slice(-n).reverse();
}

/** Where needs come from: requester (member id or outside name), with counts. */
export function sourcesCard(s: State, projectId: Id): { key: string; userId: Id | null; name: string | null; count: number }[] {
  const by = new Map<string, { key: string; userId: Id | null; name: string | null; count: number }>();
  for (const n of projectNeeds(s, projectId).filter(shared)) {
    const userId = n.requester?.userId ?? (n.requester?.name ? null : n.createdBy);
    const name = n.requester?.name ?? null;
    const key = userId ? `u:${userId}` : `n:${name}`;
    const row = by.get(key) ?? { key, userId, name, count: 0 };
    row.count++;
    by.set(key, row);
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

export function weeklyCard(s: State, projectId: Id, today: string): { userId: Id; count: number; last: WorkItem }[] {
  const by = new Map<Id, WorkItem[]>();
  for (const w of projectWork(s, projectId).filter(sharedWork)) {
    if (w.src === 'meeting' || daysBetween(w.date, today) > 7) continue;
    by.set(w.by, [...(by.get(w.by) ?? []), w]);
  }
  return [...by.entries()].map(([userId, ws]) => ({ userId, count: ws.length, last: ws[ws.length - 1]! }));
}

// ---------------------------------------------------------------- Home (cross-project)

export interface HomeItems {
  /** Ids: the conflict id, the proposal id, `${inputId}:${extractId}`, or questionId(q). */
  confirm: { projectId: Id; kind: 'conflict' | 'proposal' | 'extract' | 'question'; id: Id }[];
  toMe: { projectId: Id; handoffId: Id; needId: Id }[];
  byMe: { projectId: Id; handoffId: Id; needId: Id; stale: number | null; last: WorkItem | null }[];
  mine: { projectId: Id; needId: Id }[];
  due: { projectId: Id; roundId: Id; daysLeft: number }[];
}

export function myProjectIds(s: State, userId: Id): Id[] {
  return Object.values(s.projects)
    .filter((p) => p.memberIds.includes(userId))
    .sort((a, b) => a.createdSeq - b.createdSeq)
    .map((p) => p.id);
}

export function homeItems(s: State, userId: Id, today: string): HomeItems {
  const out: HomeItems = { confirm: [], toMe: [], byMe: [], mine: [], due: [] };
  for (const pid of myProjectIds(s, userId)) {
    const tc = toConfirm(s, userId, pid, today);
    for (const c of tc.conflicts) out.confirm.push({ projectId: pid, kind: 'conflict', id: c.id });
    for (const p of tc.proposals) out.confirm.push({ projectId: pid, kind: 'proposal', id: p.id });
    for (const x of tc.extracts) out.confirm.push({ projectId: pid, kind: 'extract', id: `${x.inputId}:${x.extractId}` });
    for (const q of tc.questions) out.confirm.push({ projectId: pid, kind: 'question', id: questionId(q) });
    for (const h of Object.values(s.handoffs).filter((x) => x.projectId === pid).sort((a, b) => a.createdSeq - b.createdSeq)) {
      if (h.toId === userId && h.state !== 'declined' && h.state !== 'done') out.toMe.push({ projectId: pid, handoffId: h.id, needId: h.needId });
      if (h.fromId === userId && h.state !== 'done') {
        const st = handoffStaleness(s, h);
        const last = Object.values(s.work).filter((w) => w.needId === h.needId && w.by === h.toId && sharedWork(w)).sort((a, b) => a.seq - b.seq).at(-1) ?? null;
        out.byMe.push({ projectId: pid, handoffId: h.id, needId: h.needId, stale: st && !st.reminded ? st.current : null, last });
      }
    }
    for (const n of projectNeeds(s, pid)) if (n.ownerId === userId && !CLOSED_STATUSES.has(n.status)) out.mine.push({ projectId: pid, needId: n.id });
    const r = currentRound(s, pid);
    if (r) out.due.push({ projectId: pid, roundId: r.id, daysLeft: daysBetween(today, r.due) });
  }
  out.due.sort((a, b) => a.daysLeft - b.daysLeft);
  return out;
}

/** Things waiting for the user (the Home headline): To confirm + handoffs sent to them not yet answered. A conflict-decision handoff counts once, in To confirm. */
export function waitingCount(s: State, userId: Id, today: string): number {
  const h = homeItems(s, userId, today);
  return h.confirm.length + h.toMe.filter((x) => s.handoffs[x.handoffId]?.state === 'sent' && s.handoffs[x.handoffId]?.conflictId === null).length;
}

export function projectsCard(s: State, userId: Id, today: string): { projectId: Id; round: Round | null; daysLeft: number | null; done: number; ext: number }[] {
  return myProjectIds(s, userId).map((pid) => {
    const p = progressCard(s, pid, today);
    return { projectId: pid, round: p.round, daysLeft: p.daysLeft, done: p.done, ext: p.ext };
  });
}

export function allRisks(s: State, userId: Id, today: string): Risk[] {
  return myProjectIds(s, userId).flatMap((pid) => riskList(s, userId, pid, today));
}

// ---------------------------------------------------------------- rule-based card selection

const CARD_WORDS: [CardId, RegExp][] = [
  ['timeline', /时间线|甘特|排期|timeline|gantt|schedule/i],
  ['sources', /来源|从哪|source|where.*come/i],
  ['weekly', /本周|这周|谁做|week/i],
  ['members', /成员|岗位|角色|member|role|people/i],
  ['risks', /风险|待办|risk|follow/i],
  ['allRisks', /风险|risk/i],
  ['hyps', /假设|hypo/i],
  ['delivery', /交付|deliver/i],
  ['progress', /进度|本轮|progress|this round/i],
  ['activity', /动态|最近|activity|recent/i],
  ['mine', /我负责|我的需求|owned|mine/i],
  ['toMe', /交给我|handed to me|to me/i],
  ['byMe', /我交出|i handed|by me/i],
  ['due', /截止|到期|due|deadline/i],
  ['confirm', /待确认|to confirm/i],
  ['projects', /各项目|所有项目|projects/i],
];

/** Which card a request asks for on this dashboard, or null. Rule-based (keywords). */
export function cardFromText(text: string, scope: 'home' | 'project'): CardId | null {
  const pool: readonly string[] = scope === 'home' ? HOME_CARDS : PROJECT_CARDS;
  const looksLikeAdd = /加|添加|显示|看看|放|生成|add|show|card|卡片|看板/i.test(text);
  if (!looksLikeAdd) return null;
  for (const [card, re] of CARD_WORDS) if (pool.includes(card) && re.test(text)) return card;
  return null;
}

export function contextVersionOf(n: Need): number {
  return needVersion(n);
}

