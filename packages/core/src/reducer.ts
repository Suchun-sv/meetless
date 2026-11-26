import { produce } from 'immer';
import type { AgentReply } from './agent';
import { DomainError } from './errors';
import { isWebUrl, noDots } from './text';
import { isSystemActor, type DomainEvent, type EventEnvelope, type EventType, type ExtractInput } from './events';
import {
  ARTIFACT_KINDS,
  EXT_STATUSES,
  HYP_STATUSES,
  HOME_CARDS,
  INPUT_KINDS,
  SCENES,
  PROJECT_CARDS,
  SOURCE_KINDS,
  WORK_EFFECTS,
  dashboardKey,
  type ArtifactKind,
  type ChatMessage,
  type ChatThread,
  type Conflict,
  type Extract,
  type Handoff,
  type HandoffState,
  type Id,
  type Input,
  type IsoDate,
  type Need,
  type NeedKind,
  type NeedSource,
  type NeedStatus,
  type Project,
  type Requester,
  type Round,
  type SourceKind,
  type State,
  type WorkItem,
  type Scene,
} from './types';

// ---------------------------------------------------------------- helpers

function get<T>(rec: Record<Id, T>, id: Id | null | undefined, what: string): T {
  const v = id == null ? undefined : rec[id];
  if (v === undefined) throw new DomainError('NOT_FOUND', `${what} ${String(id)} not found`, { what, id });
  return v;
}

/** Private objects do not exist for anyone but their owner (and service actors). */
function visible<T extends { privateTo: Id | null }>(rec: Record<Id, T>, id: Id | null | undefined, what: string, actorId: Id): T {
  const v = get(rec, id, what);
  if (v.privateTo !== null && v.privateTo !== actorId && !isSystemActor(actorId)) {
    throw new DomainError('NOT_FOUND', `${what} ${String(id)} not found`, { what, id });
  }
  return v;
}

function absent(rec: Record<Id, unknown>, id: Id, what: string): void {
  if (typeof id !== 'string' || id.length === 0) throw new DomainError('INVALID_EVENT', `${what} id missing`, { what });
  if (rec[id] !== undefined) throw new DomainError('ALREADY_EXISTS', `${what} ${id} already exists`, { what, id });
}

function text(v: unknown, field: string, code: 'INVALID_EVENT' | 'REASON_REQUIRED' = 'INVALID_EVENT'): string {
  if (typeof v !== 'string' || v.trim().length === 0) throw new DomainError(code, `${field} must be a non-empty string`, { field });
  return v;
}

function optText(v: unknown, field: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new DomainError('INVALID_EVENT', `${field} must be a string`, { field });
  return v;
}

/**
 * An artifact or version URL: empty, or an http(s) URL. An Overleaf artifact may instead name a
 * local clone (an absolute path or `file://`), which only the dev-bridge host ever clones; the
 * desktop never opens one. Every client gets the same rule because the server applies it.
 */
function linkUrl(v: unknown, field: string, kind: ArtifactKind): string | null {
  const u = optText(v, field);
  if (u === null || u.trim() === '' || isWebUrl(u)) return u;
  if (kind === 'overleaf' && (u.startsWith('/') || u.startsWith('file:///'))) return u;
  throw new DomainError('INVALID_EVENT', `${field} must be an http(s) URL`, { field });
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function date(v: unknown, field: string): IsoDate {
  if (typeof v !== 'string' || !DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    throw new DomainError('INVALID_EVENT', `${field} must be YYYY-MM-DD`, { field });
  }
  return v;
}

const BLOB = /^sha256:[0-9a-f]{64}$/;

/** Longest project name `project.renamed` takes, in code points (CJK and astral characters count once). */
const PROJECT_NAME_MAX = 80;

/** A rename's name: dot symbols cleaned (`noDots`), trimmed, 1 to `PROJECT_NAME_MAX` code points. */
function projectName(v: unknown): string {
  if (typeof v !== 'string') throw new DomainError('INVALID_EVENT', 'name must be a string', { field: 'name' });
  const name = noDots(v).trim();
  if (name.length === 0) throw new DomainError('INVALID_EVENT', 'name must be a non-empty string', { field: 'name' });
  if ([...name].length > PROJECT_NAME_MAX) {
    throw new DomainError('INVALID_EVENT', `name must be at most ${PROJECT_NAME_MAX} characters`, { field: 'name', max: PROJECT_NAME_MAX });
  }
  return name;
}

function requireMember(s: State, projectId: Id, userId: Id): Project {
  const p = get(s.projects, projectId, 'project');
  if (!p.memberIds.includes(userId) && !isSystemActor(userId)) {
    throw new DomainError('NOT_A_MEMBER', `${userId} is not a member of project ${projectId}`, { projectId, userId });
  }
  return p;
}

/** 'home' needs only a registered user; any other scope is a project id and needs membership. */
function requireScope(s: State, scope: Id, userId: Id): void {
  if (scope === 'home') get(s.users, userId, 'user');
  else requireMember(s, scope, userId);
}

function checkReply(v: unknown): AgentReply {
  if (!v || typeof v !== 'object') throw new DomainError('INVALID_EVENT', 'reply must be an object');
  const r = v as Record<string, unknown>;
  if (typeof r.provider !== 'string' || r.provider.length === 0) throw new DomainError('INVALID_EVENT', 'reply.provider must be a non-empty string');
  if (typeof r.simulated !== 'boolean') throw new DomainError('INVALID_EVENT', 'reply.simulated must be a boolean');
  const a = r.answer;
  if (!a || typeof a !== 'object' || typeof (a as Record<string, unknown>).intent !== 'string') {
    throw new DomainError('INVALID_EVENT', 'reply.answer.intent must be a string');
  }
  return v as AgentReply;
}

function requireActor(ok: boolean, actorId: Id, action: string): void {
  if (!ok) throw new DomainError('NOT_AUTHORISED', `${actorId} may not ${action}`, { actorId, action });
}

function statusFor(kind: NeedKind, status: unknown): NeedStatus {
  const allowed: readonly string[] = kind === 'ext' ? EXT_STATUSES : HYP_STATUSES;
  if (typeof status !== 'string' || !allowed.includes(status)) {
    throw new DomainError('INVALID_STATUS', `${String(status)} is not a status of a ${kind} need`, { kind, status });
  }
  return status as NeedStatus;
}

function kindOf(v: unknown): NeedKind {
  if (v !== 'ext' && v !== 'hyp') throw new DomainError('INVALID_EVENT', `bad need kind ${String(v)}`);
  return v;
}

function srcOf(v: unknown): SourceKind {
  if (typeof v !== 'string' || !(SOURCE_KINDS as readonly string[]).includes(v)) throw new DomainError('INVALID_EVENT', `bad source kind ${String(v)}`);
  return v as SourceKind;
}

function requesterOf(s: State, r: Requester | null | undefined): Requester | null {
  if (!r) return null;
  if (r.userId !== undefined) {
    get(s.users, r.userId, 'user');
    return { userId: r.userId };
  }
  return { name: text(r.name, 'requester.name') };
}

function roundIn(s: State, projectId: Id, roundId: Id | null | undefined): Id | null {
  if (roundId === null || roundId === undefined) return null;
  const r = get(s.rounds, roundId, 'round');
  if (r.projectId !== projectId) throw new DomainError('INVALID_EVENT', 'round belongs to another project');
  return r.id;
}

/** Current round of a project (null if none). */
export function currentRound(s: State, projectId: Id): Round | null {
  let best: Round | null = null;
  for (const r of Object.values(s.rounds)) if (r.projectId === projectId && r.status === 'current' && (!best || r.n < best.n)) best = r;
  return best;
}

/** Context version of a need: 1, plus one per revision. */
export function needVersion(n: Pick<Need, 'revisions'>): number {
  return 1 + n.revisions.length;
}

function assignCode(s: State, need: Pick<Need, 'projectId' | 'kind' | 'privateTo'>): string {
  const letter = need.kind === 'ext' ? 'N' : 'H';
  if (need.privateTo === null) {
    const p = s.projects[need.projectId]!;
    const n = p.nextCode[need.kind];
    p.nextCode[need.kind] = n + 1;
    return `${letter}${n}`;
  }
  const key = `${need.projectId}|${need.privateTo}|${need.kind}`;
  const n = s.privateCodes[key] ?? 1;
  s.privateCodes[key] = n + 1;
  return `${letter}p${n}`;
}

function checkSource(s: State, v: NeedSource, projectId: Id, actorId: Id, privateTo: Id | null): NeedSource {
  if (!v || typeof v !== 'object') throw new DomainError('INVALID_EVENT', 'source missing');
  if (v.inputId) {
    // An input the author cannot see, or one of another project, does not exist for them: the same
    // NOT_FOUND as a missing id, so ids cannot be probed (across users or projects).
    const input = visible(s.inputs, v.inputId, 'input', actorId);
    if (input.projectId !== projectId) throw new DomainError('NOT_FOUND', `input ${v.inputId} not found`, { what: 'input', id: v.inputId });
    // A shared need carries its source input's words (as need.shared): share the input first.
    if (privateTo === null && input.privateTo !== null) throw new DomainError('PRIVATE_SOURCE', 'share the source input first');
  }
  return {
    src: srcOf(v.src),
    date: date(v.date, 'source.date'),
    quote: typeof v.quote === 'string' ? v.quote : '',
    ref: typeof v.ref === 'string' ? v.ref : '',
    ...(v.inputId ? { inputId: v.inputId } : {}),
    ...(v.extractId ? { extractId: v.extractId } : {}),
    ...(v.proposalId ? { proposalId: v.proposalId } : {}),
  };
}

function checkParent(s: State, projectId: Id, parentId: Id | null | undefined, actorId: Id, privateTo: Id | null): Id | null {
  if (parentId === null || parentId === undefined) return null;
  const p = visible(s.needs, parentId, 'need', actorId);
  if (p.projectId !== projectId) throw new DomainError('INVALID_EVENT', 'parent need belongs to another project');
  if (p.privateTo !== null && privateTo === null) throw new DomainError('PRIVATE_ITEM', 'a shared need cannot derive from a private one');
  return p.id;
}

function createNeed(
  s: State,
  e: { seq: number; actorId: Id },
  f: Omit<Need, 'code' | 'createdBy' | 'createdSeq' | 'updatedSeq' | 'revisions'> & { revisions?: Need['revisions'] },
): Need {
  absent(s.needs, f.id, 'need');
  const need: Need = { ...f, revisions: f.revisions ?? [], code: '', createdBy: e.actorId, createdSeq: e.seq, updatedSeq: e.seq };
  need.code = assignCode(s, need);
  s.needs[need.id] = need;
  return need;
}

function revise(_s: State, need: Need, e: { seq: number; actorId: Id }, r: { id: Id; text: string; why: string; date: IsoDate; inputId?: Id }): void {
  if (need.revisions.some((x) => x.id === r.id)) throw new DomainError('ALREADY_EXISTS', `revision ${r.id} exists`);
  const version = needVersion(need) + 1;
  need.revisions.push({ id: r.id, date: r.date, text: r.text, why: r.why, by: e.actorId, seq: e.seq, version, ...(r.inputId ? { inputId: r.inputId } : {}) });
  if (need.kind === 'ext') need.accept = r.text;
  else need.expect = r.text;
  need.updatedSeq = e.seq;
}

function pushHandoff(h: Handoff, state: HandoffState, by: Id, e: { seq: number; recordedAt: string }, note: string | null = null): void {
  h.state = state;
  h.history.push({ state, by, seq: e.seq, at: e.recordedAt, note });
}

function transition(h: Handoff, from: readonly HandoffState[], to: HandoffState): void {
  if (!from.includes(h.state)) {
    throw new DomainError('INVALID_STATE_TRANSITION', `handoff ${h.id}: ${h.state} -> ${to}`, { from: h.state, to });
  }
}

/** Latest fetch version, or null if the recipient's agent never fetched. */
export function lastFetchedVersion(h: Handoff): number | null {
  return h.fetches.length ? h.fetches[h.fetches.length - 1]!.version : null;
}

function openConflictsFor(s: State, input: Input, e: { seq: number }): void {
  if (input.privateTo !== null) return;
  for (const x of input.extracts) {
    if (!x.conflict || x.state !== null || x.type !== 'rev' || !x.needId) continue;
    const id = `${input.id}:${x.id}`;
    if (s.conflicts[id]) continue;
    const need = s.needs[x.needId];
    if (!need || need.privateTo !== null) continue;
    const para = input.body.find((b) => b.id === x.paraId);
    const c: Conflict = {
      id,
      projectId: input.projectId,
      needId: need.id,
      inputId: input.id,
      extractId: x.id,
      old: need.accept ?? need.expect ?? need.title,
      neu: para?.text ?? x.text,
      src: input.title,
      status: 'open',
      deciderId: input.importedBy,
      resolution: null,
      openedSeq: e.seq,
    };
    s.conflicts[id] = c;
  }
}

function srcForInput(input: Input): SourceKind {
  if (input.scene) return input.scene === 'handwritten' ? 'file' : input.scene;
  return input.kind === 'md' ? 'meeting' : input.kind === 'txt' ? 'chat' : 'file';
}

function sceneOf(v: unknown): Scene {
  if (typeof v !== 'string' || !(SCENES as readonly string[]).includes(v)) throw new DomainError('INVALID_EVENT', `bad scene ${String(v)}`);
  return v as Scene;
}

function checkExtracts(s: State, projectId: Id, body: { id: Id }[], xs: ExtractInput[], actorId: Id, privateTo: Id | null): Extract[] {
  if (!Array.isArray(xs)) throw new DomainError('INVALID_EVENT', 'extracts must be a list');
  const paras = new Set(body.map((b) => b.id));
  const ids = new Set<Id>();
  return xs.map((x) => {
    text(x.id, 'extract.id');
    if (ids.has(x.id)) throw new DomainError('INVALID_EVENT', `duplicate extract ${x.id}`);
    ids.add(x.id);
    if (!['new', 'hyp', 'rev', 'action'].includes(x.type)) throw new DomainError('INVALID_EVENT', `bad extract type ${String(x.type)}`);
    if (x.paraId !== null && !paras.has(x.paraId)) throw new DomainError('INVALID_EVENT', `extract ${x.id} points at a missing paragraph`);
    let needId: Id | null = null;
    if (x.type === 'rev') {
      const n = visible(s.needs, x.needId, 'need', actorId);
      if (n.projectId !== projectId) throw new DomainError('INVALID_EVENT', 'revision target belongs to another project');
      // A shared input reaches every member: its revision may not name a need only the importer can see.
      if (n.privateTo !== null && privateTo === null) throw new DomainError('PRIVATE_ITEM', 'a shared input cannot revise a private need');
      needId = n.id;
    }
    return {
      id: x.id,
      type: x.type,
      text: text(x.text, 'extract.text'),
      paraId: x.paraId,
      needId,
      accept: optText(x.accept, 'accept'),
      expect: optText(x.expect, 'expect'),
      verify: optText(x.verify, 'verify'),
      conflict: x.type === 'rev' && x.conflict === true,
      state: null,
      decidedBy: null,
      resultNeedId: null,
    };
  });
}

// ---------------------------------------------------------------- handlers

type Handler<K extends EventType> = (s: State, e: EventEnvelope<K>) => void;
type Handlers = { [K in EventType]: Handler<K> };

const handlers: Handlers = {
  'user.registered': (s, e) => {
    requireActor(isSystemActor(e.actorId), e.actorId, 'register users');
    const p = e.payload;
    absent(s.users, p.userId, 'user');
    s.users[p.userId] = { id: p.userId, displayName: text(p.displayName, 'displayName'), locale: text(p.locale, 'locale') };
  },
  'user.locale_changed': (s, e) => {
    const u = get(s.users, e.payload.userId, 'user');
    requireActor(e.actorId === u.id, e.actorId, 'change another user’s locale');
    u.locale = text(e.payload.locale, 'locale');
  },

  'project.created': (s, e) => {
    const p = e.payload;
    absent(s.projects, p.projectId, 'project');
    get(s.users, e.actorId, 'user');
    s.projects[p.projectId] = {
      id: p.projectId,
      name: text(p.name, 'name'),
      description: p.description ?? '',
      createdBy: e.actorId,
      createdSeq: e.seq,
      memberIds: [e.actorId],
      sample: p.sample === true,
      nextCode: { ext: 1, hyp: 1 },
      renames: [],
    };
  },
  'project.member_added': (s, e) => {
    const p = requireMember(s, e.payload.projectId, e.actorId);
    get(s.users, e.payload.userId, 'user');
    if (p.memberIds.includes(e.payload.userId)) throw new DomainError('ALREADY_EXISTS', 'already a member');
    p.memberIds.push(e.payload.userId);
  },
  'project.renamed': (s, e) => {
    const p = requireMember(s, e.payload.projectId, e.actorId);
    const name = projectName(e.payload.name);
    p.renames.push({ from: p.name, to: name, by: e.actorId, at: e.recordedAt, seq: e.seq });
    p.name = name;
  },
  'role.created': (s, e) => {
    const p = e.payload;
    requireMember(s, p.projectId, e.actorId);
    absent(s.roles, p.roleId, 'role');
    s.roles[p.roleId] = { id: p.roleId, projectId: p.projectId, name: text(p.name, 'name'), memberIds: [], createdSeq: e.seq };
  },
  'role.member_assigned': (s, e) => {
    const r = get(s.roles, e.payload.roleId, 'role');
    const p = requireMember(s, r.projectId, e.actorId);
    if (!p.memberIds.includes(e.payload.userId)) throw new DomainError('NOT_A_MEMBER', 'only project members can hold a role');
    if (r.memberIds.includes(e.payload.userId)) throw new DomainError('ALREADY_EXISTS', 'already in role');
    r.memberIds.push(e.payload.userId);
  },
  'role.member_removed': (s, e) => {
    const r = get(s.roles, e.payload.roleId, 'role');
    requireMember(s, r.projectId, e.actorId);
    if (!r.memberIds.includes(e.payload.userId)) throw new DomainError('NOT_FOUND', 'not in role');
    r.memberIds = r.memberIds.filter((m) => m !== e.payload.userId);
  },

  'round.created': (s, e) => {
    const p = e.payload;
    requireMember(s, p.projectId, e.actorId);
    absent(s.rounds, p.roundId, 'round');
    if (p.kind !== 'hard' && p.kind !== 'cadence') throw new DomainError('INVALID_EVENT', 'round kind must be hard or cadence');
    const start = date(p.start, 'start');
    const due = date(p.due, 'due');
    if (due < start) throw new DomainError('INVALID_EVENT', 'due date before start');
    const n = Object.values(s.rounds).filter((r) => r.projectId === p.projectId).length + 1;
    s.rounds[p.roundId] = {
      id: p.roundId,
      projectId: p.projectId,
      n,
      title: text(p.title, 'title'),
      kind: p.kind,
      start,
      due,
      status: currentRound(s, p.projectId) ? 'planned' : 'current',
      items: (p.items ?? []).map((x) => text(x, 'item')),
      delivery: null,
    };
  },
  'round.updated': (s, e) => {
    const p = e.payload;
    const r = get(s.rounds, p.roundId, 'round');
    requireMember(s, r.projectId, e.actorId);
    if (p.title !== undefined) r.title = text(p.title, 'title');
    if (p.kind !== undefined) {
      if (p.kind !== 'hard' && p.kind !== 'cadence') throw new DomainError('INVALID_EVENT', 'bad round kind');
      r.kind = p.kind;
    }
    if (p.start !== undefined) r.start = date(p.start, 'start');
    if (p.due !== undefined) r.due = date(p.due, 'due');
    if (r.due < r.start) throw new DomainError('INVALID_EVENT', 'due date before start');
    if (p.items !== undefined) {
      if (r.status === 'delivered') throw new DomainError('INVALID_STATE_TRANSITION', 'delivered rounds are frozen');
      r.items = p.items.map((x) => text(x, 'item'));
    }
  },
  'round.started': (s, e) => {
    const r = get(s.rounds, e.payload.roundId, 'round');
    requireMember(s, r.projectId, e.actorId);
    if (r.status !== 'planned') throw new DomainError('INVALID_STATE_TRANSITION', `round is ${r.status}`);
    const cur = currentRound(s, r.projectId);
    if (cur) cur.status = 'planned';
    r.status = 'current';
  },
  'round.delivered': (s, e) => {
    const p = e.payload;
    const r = get(s.rounds, p.roundId, 'round');
    requireMember(s, r.projectId, e.actorId);
    if (r.status === 'delivered') throw new DomainError('INVALID_STATE_TRANSITION', 'already delivered');
    const wasCurrent = r.status === 'current';
    const account =
      p.account ??
      Object.values(s.needs)
        .filter((n) => n.roundId === r.id && n.kind === 'ext' && n.privateTo === null)
        .sort((a, b) => a.createdSeq - b.createdSeq)
        .map((n) => ({ needId: n.id, status: n.status, note: '' }));
    for (const a of account) {
      const n = visible(s.needs, a.needId, 'need', e.actorId);
      if (n.privateTo !== null) throw new DomainError('PRIVATE_ITEM', 'deliveries list shared needs only');
      statusFor(n.kind, a.status);
    }
    r.status = 'delivered';
    r.delivery = { items: (p.items ?? r.items).map((x) => text(x, 'item')), account, date: date(p.date, 'date'), by: e.actorId, seq: e.seq };
    if (wasCurrent) {
      const next = Object.values(s.rounds)
        .filter((x) => x.projectId === r.projectId && x.status === 'planned' && x.n > r.n)
        .sort((a, b) => a.n - b.n)[0];
      if (next) next.status = 'current';
    }
  },

  'need.created': (s, e) => {
    const p = e.payload;
    requireMember(s, p.projectId, e.actorId);
    const kind = kindOf(p.kind);
    const privateTo = p.private === true ? e.actorId : null;
    if (p.ownerId) requireMember(s, p.projectId, p.ownerId);
    const roundId = roundIn(s, p.projectId, p.roundId);
    const fromRoundId = roundIn(s, p.projectId, p.fromRoundId);
    createNeed(s, e, {
      id: p.needId,
      projectId: p.projectId,
      kind,
      title: text(p.title, 'title'),
      status: p.status === undefined ? (kind === 'ext' ? 'todo' : 'untested') : statusFor(kind, p.status),
      roundId,
      parentId: checkParent(s, p.projectId, p.parentId, e.actorId, privateTo),
      fromRoundId,
      ownerId: p.ownerId ?? null,
      requester: requesterOf(s, p.requester),
      accept: kind === 'ext' ? optText(p.accept, 'accept') : null,
      expect: kind === 'hyp' ? optText(p.expect, 'expect') : null,
      verify: kind === 'hyp' ? optText(p.verify, 'verify') : null,
      verdict: kind === 'hyp' ? optText(p.verdict, 'verdict') : null,
      source: checkSource(s, p.source, p.projectId, e.actorId, privateTo),
      privateTo,
      autoRound: false,
    });
  },
  'need.revised': (s, e) => {
    const p = e.payload;
    const n = visible(s.needs, p.needId, 'need', e.actorId);
    requireMember(s, n.projectId, e.actorId);
    revise(s, n, e, { id: text(p.revisionId, 'revisionId'), text: text(p.text, 'text'), why: text(p.why, 'why', 'REASON_REQUIRED'), date: date(p.date, 'date') });
  },
  'need.updated': (s, e) => {
    const p = e.payload;
    const n = visible(s.needs, p.needId, 'need', e.actorId);
    requireMember(s, n.projectId, e.actorId);
    if (p.title !== undefined) n.title = text(p.title, 'title');
    if (p.roundId !== undefined) {
      n.roundId = roundIn(s, n.projectId, p.roundId);
      n.autoRound = false;
    }
    if (p.fromRoundId !== undefined) n.fromRoundId = roundIn(s, n.projectId, p.fromRoundId);
    if (p.ownerId !== undefined) {
      if (p.ownerId !== null) requireMember(s, n.projectId, p.ownerId);
      n.ownerId = p.ownerId;
    }
    if (p.parentId !== undefined) {
      const parent = checkParent(s, n.projectId, p.parentId, e.actorId, n.privateTo);
      for (let cur = parent; cur; cur = s.needs[cur]?.parentId ?? null) {
        if (cur === n.id) throw new DomainError('INVALID_EVENT', 'a need cannot derive from itself');
      }
      n.parentId = parent;
    }
    n.updatedSeq = e.seq;
  },
  'need.status_set': (s, e) => {
    const p = e.payload;
    const n = visible(s.needs, p.needId, 'need', e.actorId);
    requireMember(s, n.projectId, e.actorId);
    n.status = statusFor(n.kind, p.status);
    if (p.verdict !== undefined) {
      if (n.kind !== 'hyp') throw new DomainError('INVALID_EVENT', 'only hypotheses have a verdict');
      n.verdict = optText(p.verdict, 'verdict');
    }
    n.updatedSeq = e.seq;
  },
  'need.shared': (s, e) => {
    const p = e.payload;
    const existing = s.needs[p.needId];
    if (existing) {
      if (existing.privateTo === null) throw new DomainError('INVALID_STATE_TRANSITION', 'already shared');
      if (existing.privateTo !== e.actorId) throw new DomainError('NOT_FOUND', `need ${p.needId} not found`, { what: 'need', id: p.needId });
      requireMember(s, existing.projectId, e.actorId);
      if (existing.parentId && s.needs[existing.parentId]?.privateTo) throw new DomainError('PRIVATE_ITEM', 'share the parent first');
      // The need carries its source input's words (quote, title, revision reasons): share the input first.
      const inputIds = [existing.source.inputId, ...existing.revisions.map((r) => r.inputId)];
      if (inputIds.some((id) => id !== undefined && (s.inputs[id]?.privateTo ?? null) !== null)) {
        throw new DomainError('PRIVATE_SOURCE', 'share the source input first');
      }
      existing.privateTo = null;
      existing.code = assignCode(s, existing);
      existing.updatedSeq = e.seq;
      for (const w of Object.values(s.work)) if (w.needId === existing.id && w.privateTo === e.actorId) w.privateTo = null;
      return;
    }
    // A member who never saw the private need: create it from the service-provided snapshot.
    const snap = p.snapshot;
    if (!snap || snap.need.id !== p.needId) throw new DomainError('NOT_FOUND', `need ${p.needId} not found`, { what: 'need', id: p.needId });
    requireMember(s, snap.need.projectId, e.actorId);
    const need: Need = { ...snap.need, privateTo: null, code: '', updatedSeq: e.seq };
    need.code = assignCode(s, need);
    s.needs[need.id] = need;
    for (const w of snap.work) if (!s.work[w.id]) s.work[w.id] = { ...w, privateTo: null };
  },

  'work.recorded': (s, e) => {
    const p = e.payload;
    requireMember(s, p.projectId, e.actorId);
    absent(s.work, p.workId, 'work item');
    const need = p.needId ? visible(s.needs, p.needId, 'need', e.actorId) : null;
    const also = p.alsoNeedId ? visible(s.needs, p.alsoNeedId, 'need', e.actorId) : null;
    for (const n of [need, also]) if (n && n.projectId !== p.projectId) throw new DomainError('INVALID_EVENT', 'need belongs to another project');
    const privateTo = p.private === true ? e.actorId : (need?.privateTo ?? null);
    if (also && also.privateTo !== null && also.privateTo !== privateTo) throw new DomainError('PRIVATE_ITEM', 'cannot link shared work to a private need');
    if (p.effect != null && !(WORK_EFFECTS as readonly string[]).includes(p.effect)) throw new DomainError('INVALID_EVENT', `bad effect ${p.effect}`);
    if (p.result != null && p.result !== 'keep' && p.result !== 'revert') throw new DomainError('INVALID_EVENT', 'bad result');
    if (p.autoLinked === true && !need) throw new DomainError('INVALID_EVENT', 'autoLinked requires a need');
    const w: WorkItem = {
      id: p.workId,
      projectId: p.projectId,
      needId: need?.id ?? null,
      alsoNeedId: also?.id ?? null,
      src: srcOf(p.src),
      text: text(p.text, 'text'),
      why: optText(p.why, 'why'),
      effect: p.effect ?? null,
      result: p.result ?? null,
      date: date(p.date, 'date'),
      by: e.actorId,
      via: p.via ? { client: text(p.via.client, 'via.client'), tokenId: text(p.via.tokenId, 'via.tokenId') } : null,
      capture: p.capture === true,
      ignored: false,
      autoLinked: p.autoLinked === true,
      privateTo,
      seq: e.seq,
      recordedAt: e.recordedAt,
    };
    s.work[w.id] = w;
    // Progress from the recipient moves an accepted handoff to "doing". Captures are reference only.
    if (need && !w.capture) {
      for (const h of Object.values(s.handoffs)) {
        if (h.needId === need.id && h.toId === e.actorId && h.state === 'accepted') pushHandoff(h, 'doing', e.actorId, e);
      }
    }
  },

  'work.linked': (s, e) => {
    const p = e.payload;
    const w = visible(s.work, p.workId, 'work item', e.actorId);
    requireMember(s, w.projectId, e.actorId);
    const need = visible(s.needs, p.needId, 'need', e.actorId);
    if (need.projectId !== w.projectId) throw new DomainError('INVALID_EVENT', 'need belongs to another project');
    if (w.privateTo === null && need.privateTo !== null) throw new DomainError('PRIVATE_ITEM', 'cannot link shared work to a private need');
    if (p.effect != null && !(WORK_EFFECTS as readonly string[]).includes(p.effect)) throw new DomainError('INVALID_EVENT', `bad effect ${p.effect}`);
    w.needId = need.id;
    if (p.effect !== undefined) w.effect = p.effect ?? null;
    w.autoLinked = false;
    w.ignored = false;
  },
  'work.ignored': (s, e) => {
    const p = e.payload;
    const w = visible(s.work, p.workId, 'work item', e.actorId);
    requireMember(s, w.projectId, e.actorId);
    if (w.ignored) throw new DomainError('ALREADY_DECIDED', `work item ${w.id} already ignored`);
    w.ignored = true;
  },

  'input.imported': (s, e) => {
    const p = e.payload;
    requireMember(s, p.projectId, e.actorId);
    absent(s.inputs, p.inputId, 'input');
    if (!(INPUT_KINDS as readonly string[]).includes(p.kind)) throw new DomainError('INVALID_EVENT', `bad input kind ${p.kind}`);
    if (p.blobHash != null && !BLOB.test(p.blobHash)) throw new DomainError('INVALID_EVENT', 'bad blob hash');
    if (!Array.isArray(p.body)) throw new DomainError('INVALID_EVENT', 'body must be a list');
    const ids = new Set<Id>();
    const body = p.body.map((b) => {
      text(b.id, 'para.id');
      if (ids.has(b.id)) throw new DomainError('INVALID_EVENT', `duplicate paragraph ${b.id}`);
      ids.add(b.id);
      if (typeof b.text !== 'string') throw new DomainError('INVALID_EVENT', 'paragraph text must be a string');
      return { id: b.id, text: b.text };
    });
    const privateTo = p.private === true ? e.actorId : null;
    const input: Input = {
      id: p.inputId,
      projectId: p.projectId,
      kind: p.kind,
      scene: p.scene === undefined ? null : sceneOf(p.scene),
      title: text(p.title, 'title'),
      from: requesterOf(s, p.from),
      date: date(p.date, 'date'),
      blobHash: p.blobHash ?? null,
      body,
      extracts: checkExtracts(s, p.projectId, body, p.extracts, e.actorId, privateTo),
      detector: text(p.detector, 'detector'),
      importedBy: e.actorId,
      privateTo,
      seq: e.seq,
    };
    s.inputs[input.id] = input;
    openConflictsFor(s, input, e);
  },
  'input.scene_set': (s, e) => {
    const input = visible(s.inputs, e.payload.inputId, 'input', e.actorId);
    requireMember(s, input.projectId, e.actorId);
    input.scene = sceneOf(e.payload.scene);
  },
  'input.shared': (s, e) => {
    const p = e.payload;
    const existing = s.inputs[p.inputId];
    let input: Input;
    if (existing) {
      if (existing.privateTo === null) throw new DomainError('INVALID_STATE_TRANSITION', 'already shared');
      if (existing.privateTo !== e.actorId) throw new DomainError('NOT_FOUND', `input ${p.inputId} not found`, { what: 'input', id: p.inputId });
      requireMember(s, existing.projectId, e.actorId);
      // An undecided revision of a still-private need would put that need's id in front of every member.
      const privateTargets = [
        ...new Set(existing.extracts.flatMap((x) => (x.state === null && x.type === 'rev' && x.needId && (s.needs[x.needId]?.privateTo ?? null) !== null ? [x.needId] : []))),
      ];
      if (privateTargets.length > 0) throw new DomainError('PRIVATE_ITEM', 'share the need first, or decide its extract', { needIds: privateTargets });
      existing.privateTo = null;
      input = existing;
    } else {
      const snap = p.snapshot;
      if (!snap || snap.input.id !== p.inputId) throw new DomainError('NOT_FOUND', `input ${p.inputId} not found`, { what: 'input', id: p.inputId });
      requireMember(s, snap.input.projectId, e.actorId);
      input = { ...snap.input, privateTo: null };
      s.inputs[input.id] = input;
    }
    openConflictsFor(s, input, e);
  },
  'extract.accepted': (s, e) => {
    const p = e.payload;
    const input = visible(s.inputs, p.inputId, 'input', e.actorId);
    requireMember(s, input.projectId, e.actorId);
    const x = input.extracts.find((y) => y.id === p.extractId);
    if (!x) throw new DomainError('NOT_FOUND', `extract ${p.extractId}`, { what: 'extract', id: p.extractId });
    if (x.state !== null) throw new DomainError('ALREADY_DECIDED', `extract ${x.id} is ${x.state}`);
    if (x.conflict && input.privateTo === null) throw new DomainError('CONFLICT_OPEN', 'this revision conflicts with the need; decide it in To confirm');
    const para = input.body.find((b) => b.id === x.paraId);
    const source: NeedSource = { src: srcForInput(input), date: input.date, quote: para?.text ?? x.text, ref: input.title, inputId: input.id, extractId: x.id };
    let resultNeedId: Id | null = null;
    if (x.type === 'new' || x.type === 'hyp') {
      const kind: NeedKind = x.type === 'hyp' ? 'hyp' : 'ext';
      const explicitRound = p.roundId !== undefined;
      const roundId = explicitRound ? roundIn(s, input.projectId, p.roundId) : (currentRound(s, input.projectId)?.id ?? null);
      const need = createNeed(s, e, {
        id: text(p.needId, 'needId'),
        projectId: input.projectId,
        kind,
        title: x.text,
        status: kind === 'ext' ? 'todo' : 'untested',
        roundId,
        parentId: null,
        fromRoundId: null,
        ownerId: null,
        requester: kind === 'ext' ? input.from : null,
        accept: kind === 'ext' ? (x.accept ?? x.text) : null,
        expect: kind === 'hyp' ? (x.expect ?? x.text) : null,
        verify: kind === 'hyp' ? (x.verify ?? null) : null,
        verdict: null,
        source,
        privateTo: input.privateTo,
        autoRound: !explicitRound && roundId !== null,
      });
      resultNeedId = need.id;
    } else if (x.type === 'rev') {
      const need = visible(s.needs, x.needId, 'need', e.actorId);
      if (input.privateTo !== null && need.privateTo === null) throw new DomainError('PRIVATE_SOURCE', 'share the input before it revises a shared need');
      revise(s, need, e, { id: `${input.id}:${x.id}`, text: x.text, why: input.title, date: input.date, inputId: input.id });
      resultNeedId = need.id;
    }
    x.state = 'accepted';
    x.decidedBy = e.actorId;
    x.resultNeedId = resultNeedId;
    if (resultNeedId) {
      const wid = `${input.id}:${x.id}`;
      if (!s.work[wid]) {
        s.work[wid] = {
          id: wid,
          projectId: input.projectId,
          needId: resultNeedId,
          alsoNeedId: null,
          src: source.src,
          text: input.title,
          why: x.text,
          effect: x.type === 'rev' ? 'revise' : x.type === 'hyp' ? 'spawn' : 'extract',
          result: null,
          date: input.date,
          by: e.actorId,
          via: null,
          capture: false,
          ignored: false,
          autoLinked: false,
          // Never less private than the need it is linked to.
          privateTo: s.needs[resultNeedId]?.privateTo ?? input.privateTo,
          seq: e.seq,
          recordedAt: e.recordedAt,
        };
      }
    }
  },
  'extract.ignored': (s, e) => {
    const p = e.payload;
    const input = visible(s.inputs, p.inputId, 'input', e.actorId);
    requireMember(s, input.projectId, e.actorId);
    const x = input.extracts.find((y) => y.id === p.extractId);
    if (!x) throw new DomainError('NOT_FOUND', `extract ${p.extractId}`, { what: 'extract', id: p.extractId });
    if (x.state !== null) throw new DomainError('ALREADY_DECIDED', `extract ${x.id} is ${x.state}`);
    if (x.conflict && input.privateTo === null) throw new DomainError('CONFLICT_OPEN', 'decide this conflict in To confirm');
    x.state = 'ignored';
    x.decidedBy = e.actorId;
  },

  'conflict.resolved': (s, e) => {
    const p = e.payload;
    const c = get(s.conflicts, p.conflictId, 'conflict');
    requireMember(s, c.projectId, e.actorId);
    if (c.status === 'resolved') throw new DomainError('ALREADY_DECIDED', 'conflict already resolved');
    const need = get(s.needs, c.needId, 'need');
    const isOwner = c.status === 'open' && need.ownerId === e.actorId;
    requireActor(c.deciderId === e.actorId || isOwner, e.actorId, 'decide this conflict');
    const input = get(s.inputs, c.inputId, 'input');
    const x = input.extracts.find((y) => y.id === c.extractId)!;
    // The delegate's decision completes the handoff that delegated it.
    const closeDelegation = () => {
      const h = c.resolution?.kind === 'handoff' ? s.handoffs[c.resolution.handoffId] : undefined;
      if (h && h.toId === e.actorId && h.state !== 'done' && h.state !== 'declined') pushHandoff(h, 'done', e.actorId, e);
    };
    if (p.resolution === 'revise') {
      revise(s, need, e, { id: `${c.id}:rev`, text: c.neu, why: c.src, date: input.date, inputId: input.id });
      x.state = 'accepted';
      x.decidedBy = e.actorId;
      x.resultNeedId = need.id;
      closeDelegation();
      c.status = 'resolved';
      c.resolution = { kind: 'revise', by: e.actorId, seq: e.seq };
      return;
    }
    if (p.resolution === 'park') {
      const roundId = roundIn(s, c.projectId, p.roundId);
      const parked = createNeed(s, e, {
        id: text(p.needId, 'needId'),
        projectId: c.projectId,
        kind: 'ext',
        title: c.neu,
        status: roundId ? 'todo' : 'moved',
        roundId,
        parentId: null,
        fromRoundId: null,
        ownerId: null,
        requester: input.from,
        accept: c.neu,
        expect: null,
        verify: null,
        verdict: null,
        source: { src: srcForInput(input), date: input.date, quote: c.neu, ref: c.src, inputId: input.id, extractId: x.id },
        privateTo: null,
        autoRound: false,
      });
      x.state = 'accepted';
      x.decidedBy = e.actorId;
      x.resultNeedId = parked.id;
      closeDelegation();
      c.status = 'resolved';
      c.resolution = { kind: 'park', by: e.actorId, seq: e.seq, needId: parked.id };
      return;
    }
    if (p.resolution === 'handoff') {
      requireMember(s, c.projectId, p.toId);
      if (p.toId === e.actorId) throw new DomainError('INVALID_EVENT', 'hand the decision to someone else');
      absent(s.handoffs, p.handoffId, 'handoff');
      s.handoffs[p.handoffId] = {
        id: p.handoffId,
        projectId: c.projectId,
        needId: need.id,
        fromId: e.actorId,
        toId: p.toId,
        ask: text(p.ask, 'ask'),
        due: p.due === null ? null : date(p.due, 'due'),
        state: 'sent',
        history: [{ state: 'sent', by: e.actorId, seq: e.seq, at: e.recordedAt, note: null }],
        fetches: [],
        refreshRequested: null,
        conflictId: c.id,
        createdSeq: e.seq,
      };
      c.status = 'delegated';
      c.deciderId = p.toId;
      c.resolution = { kind: 'handoff', by: e.actorId, seq: e.seq, handoffId: p.handoffId, toId: p.toId };
      return;
    }
    throw new DomainError('INVALID_EVENT', 'unknown resolution');
  },

  'handoff.created': (s, e) => {
    const p = e.payload;
    requireMember(s, p.projectId, e.actorId);
    absent(s.handoffs, p.handoffId, 'handoff');
    const need = visible(s.needs, p.needId, 'need', e.actorId);
    if (need.projectId !== p.projectId) throw new DomainError('INVALID_EVENT', 'need belongs to another project');
    if (need.privateTo !== null) throw new DomainError('PRIVATE_ITEM', 'share the need before handing it off');
    requireMember(s, p.projectId, p.toId);
    if (p.toId === e.actorId) throw new DomainError('INVALID_EVENT', 'hand off to someone else');
    s.handoffs[p.handoffId] = {
      id: p.handoffId,
      projectId: p.projectId,
      needId: need.id,
      fromId: e.actorId,
      toId: p.toId,
      ask: text(p.ask, 'ask'),
      due: p.due === null ? null : date(p.due, 'due'),
      state: 'sent',
      history: [{ state: 'sent', by: e.actorId, seq: e.seq, at: e.recordedAt, note: null }],
      fetches: [],
      refreshRequested: null,
      conflictId: null,
      createdSeq: e.seq,
    };
  },
  'handoff.responded': (s, e) => {
    const h = get(s.handoffs, e.payload.handoffId, 'handoff');
    requireActor(h.toId === e.actorId, e.actorId, 'answer a handoff sent to someone else');
    const r = e.payload.response;
    if (r !== 'accepted' && r !== 'asked' && r !== 'declined') throw new DomainError('INVALID_EVENT', 'bad response');
    transition(h, r === 'asked' ? ['sent'] : ['sent', 'asked'], r);
    pushHandoff(h, r, e.actorId, e, optText(e.payload.note, 'note'));
    if (r === 'accepted') {
      const n = s.needs[h.needId];
      if (n) n.ownerId = h.toId;
    }
  },
  'handoff.started': (s, e) => {
    const h = get(s.handoffs, e.payload.handoffId, 'handoff');
    requireActor(h.toId === e.actorId, e.actorId, 'start a handoff sent to someone else');
    transition(h, ['accepted'], 'doing');
    pushHandoff(h, 'doing', e.actorId, e);
  },
  'handoff.returned': (s, e) => {
    const h = get(s.handoffs, e.payload.handoffId, 'handoff');
    requireActor(h.toId === e.actorId, e.actorId, 'return a handoff sent to someone else');
    transition(h, ['accepted', 'doing'], 'returned');
    pushHandoff(h, 'returned', e.actorId, e, optText(e.payload.note, 'note'));
  },
  'handoff.confirmed': (s, e) => {
    const h = get(s.handoffs, e.payload.handoffId, 'handoff');
    requireActor(h.fromId === e.actorId, e.actorId, 'confirm a handoff they did not send');
    transition(h, ['returned'], 'done');
    pushHandoff(h, 'done', e.actorId, e);
  },
  'handoff.reopened': (s, e) => {
    const h = get(s.handoffs, e.payload.handoffId, 'handoff');
    requireActor(h.fromId === e.actorId, e.actorId, 'reopen a handoff they did not send');
    transition(h, ['returned'], 'doing');
    pushHandoff(h, 'doing', e.actorId, e, text(e.payload.note, 'note', 'REASON_REQUIRED'));
  },
  'handoff.refresh_requested': (s, e) => {
    const h = get(s.handoffs, e.payload.handoffId, 'handoff');
    requireActor(h.fromId === e.actorId, e.actorId, 'ask for a refresh on a handoff they did not send');
    const v = needVersion(get(s.needs, h.needId, 'need'));
    const fetched = lastFetchedVersion(h);
    if (fetched === null || fetched >= v) throw new DomainError('INVALID_STATE_TRANSITION', 'the recipient already has the latest context');
    if (h.state === 'done' || h.state === 'declined') throw new DomainError('INVALID_STATE_TRANSITION', `handoff is ${h.state}`);
    h.refreshRequested = { version: v, seq: e.seq };
  },
  'handoff.context_fetched': (s, e) => {
    const h = get(s.handoffs, e.payload.handoffId, 'handoff');
    requireActor(h.toId === e.actorId, e.actorId, 'record a fetch for someone else');
    const v = needVersion(get(s.needs, h.needId, 'need'));
    if (!Number.isInteger(e.payload.version) || e.payload.version < 1 || e.payload.version > v) throw new DomainError('INVALID_EVENT', 'bad context version');
    h.fetches.push({ version: e.payload.version, seq: e.seq, at: e.recordedAt, client: e.payload.client ?? null });
  },

  'proposal.created': (s, e) => {
    const p = e.payload;
    requireMember(s, p.projectId, e.actorId);
    absent(s.proposals, p.proposalId, 'proposal');
    const kind = kindOf(p.kind);
    s.proposals[p.proposalId] = {
      id: p.proposalId,
      projectId: p.projectId,
      kind,
      title: text(p.title, 'title'),
      accept: optText(p.accept, 'accept'),
      expect: optText(p.expect, 'expect'),
      verify: optText(p.verify, 'verify'),
      why: optText(p.why, 'why'),
      parentId: checkParent(s, p.projectId, p.parentId, e.actorId, null),
      by: e.actorId,
      via: p.via ?? null,
      status: 'open',
      needId: null,
      decidedBy: null,
      seq: e.seq,
    };
  },
  'proposal.accepted': (s, e) => {
    const p = e.payload;
    const pr = get(s.proposals, p.proposalId, 'proposal');
    requireMember(s, pr.projectId, e.actorId);
    if (pr.status !== 'open') throw new DomainError('ALREADY_DECIDED', `proposal is ${pr.status}`);
    const need = createNeed(s, e, {
      id: text(p.needId, 'needId'),
      projectId: pr.projectId,
      kind: pr.kind,
      title: pr.title,
      status: pr.kind === 'ext' ? 'todo' : 'untested',
      roundId: roundIn(s, pr.projectId, p.roundId),
      parentId: pr.parentId,
      fromRoundId: null,
      ownerId: pr.by,
      requester: pr.kind === 'ext' ? { userId: pr.by } : null,
      accept: pr.kind === 'ext' ? (pr.accept ?? pr.title) : null,
      expect: pr.kind === 'hyp' ? (pr.expect ?? pr.title) : null,
      verify: pr.kind === 'hyp' ? pr.verify : null,
      verdict: null,
      source: { src: 'agent', date: e.recordedAt.slice(0, 10), quote: pr.why ?? pr.title, ref: pr.via?.client ?? 'agent', proposalId: pr.id },
      privateTo: null,
      autoRound: false,
    });
    pr.status = 'accepted';
    pr.needId = need.id;
    pr.decidedBy = e.actorId;
  },
  'proposal.rejected': (s, e) => {
    const pr = get(s.proposals, e.payload.proposalId, 'proposal');
    requireMember(s, pr.projectId, e.actorId);
    if (pr.status !== 'open') throw new DomainError('ALREADY_DECIDED', `proposal is ${pr.status}`);
    pr.status = 'rejected';
    pr.decidedBy = e.actorId;
  },

  'artifact.created': (s, e) => {
    const p = e.payload;
    requireMember(s, p.projectId, e.actorId);
    absent(s.artifacts, p.artifactId, 'artifact');
    if (!(ARTIFACT_KINDS as readonly string[]).includes(p.kind)) throw new DomainError('INVALID_EVENT', `bad artifact kind ${p.kind}`);
    const privateTo = p.private === true ? e.actorId : null;
    s.artifacts[p.artifactId] = {
      id: p.artifactId,
      projectId: p.projectId,
      kind: p.kind,
      title: text(p.title, 'title'),
      where: text(p.where, 'where'),
      url: linkUrl(p.url, 'url', p.kind),
      needIds: linkNeeds(s, p.projectId, p.needIds, e.actorId, privateTo),
      versions: [],
      privateTo,
      createdBy: e.actorId,
      seq: e.seq,
    };
  },
  'artifact.version_added': (s, e) => {
    const p = e.payload;
    const a = visible(s.artifacts, p.artifactId, 'artifact', e.actorId);
    requireMember(s, a.projectId, e.actorId);
    if (Object.values(s.artifacts).some((x) => x.versions.some((v) => v.id === p.versionId))) throw new DomainError('ALREADY_EXISTS', `version ${p.versionId}`);
    if (p.blobHash != null && !BLOB.test(p.blobHash)) throw new DomainError('INVALID_EVENT', 'bad blob hash');
    a.versions.unshift({
      id: text(p.versionId, 'versionId'),
      label: text(p.label, 'label'),
      date: date(p.date, 'date'),
      roundId: roundIn(s, a.projectId, p.roundId),
      note: typeof p.note === 'string' ? p.note : '',
      blobHash: p.blobHash ?? null,
      mediaType: optText(p.mediaType, 'mediaType'),
      url: linkUrl(p.url, 'url', a.kind),
      by: e.actorId,
      seq: e.seq,
      derived: null,
    });
  },
  'artifact.linked': (s, e) => {
    const a = visible(s.artifacts, e.payload.artifactId, 'artifact', e.actorId);
    requireMember(s, a.projectId, e.actorId);
    a.needIds = linkNeeds(s, a.projectId, e.payload.needIds, e.actorId, a.privateTo);
  },
  'artifact.shared': (s, e) => {
    const p = e.payload;
    const existing = s.artifacts[p.artifactId];
    if (existing) {
      if (existing.privateTo === null) throw new DomainError('INVALID_STATE_TRANSITION', 'already shared');
      if (existing.privateTo !== e.actorId) throw new DomainError('NOT_FOUND', `artifact ${p.artifactId} not found`, { what: 'artifact', id: p.artifactId });
      requireMember(s, existing.projectId, e.actorId);
      requireActor(existing.createdBy === e.actorId, e.actorId, 'share this artifact');
      if (existing.needIds.some((id) => (s.needs[id]?.privateTo ?? null) !== null)) throw new DomainError('PRIVATE_ITEM', 'share the linked need first');
      existing.privateTo = null;
      return;
    }
    // A member who never saw the private artifact: create it from the service-provided snapshot.
    const snap = p.snapshot;
    if (!snap || snap.artifact.id !== p.artifactId) throw new DomainError('NOT_FOUND', `artifact ${p.artifactId} not found`, { what: 'artifact', id: p.artifactId });
    requireMember(s, snap.artifact.projectId, e.actorId);
    s.artifacts[p.artifactId] = { ...snap.artifact, privateTo: null };
  },
  'artifactVersion.derived': (s, e) => {
    requireActor(isSystemActor(e.actorId), e.actorId, 'record derived previews');
    const p = e.payload;
    const a = get(s.artifacts, p.artifactId, 'artifact');
    const v = a.versions.find((x) => x.id === p.versionId);
    if (!v) throw new DomainError('NOT_FOUND', `version ${p.versionId}`);
    if (!['ready', 'partial', 'failed'].includes(p.status)) throw new DomainError('INVALID_EVENT', 'bad status');
    for (const h of p.pageHashes) if (!BLOB.test(h)) throw new DomainError('INVALID_EVENT', 'bad page hash');
    v.derived = { status: p.status, pageHashes: [...p.pageHashes], texts: [...p.texts], error: p.error, converter: p.converter };
  },

  'dashboard.set': (s, e) => {
    const p = e.payload;
    const scope = text(p.scope, 'scope');
    if (scope !== 'home') requireMember(s, scope, e.actorId);
    else get(s.users, e.actorId, 'user');
    const allowed: readonly string[] = scope === 'home' ? HOME_CARDS : PROJECT_CARDS;
    const seen = new Set<string>();
    for (const c of p.cards) {
      if (!allowed.includes(c)) throw new DomainError('INVALID_EVENT', `card ${c} does not belong on this dashboard`);
      if (seen.has(c)) throw new DomainError('INVALID_EVENT', `duplicate card ${c}`);
      seen.add(c);
    }
    for (const [k, v] of Object.entries(p.refreshed ?? {})) {
      if (!allowed.includes(k) || Number.isNaN(Date.parse(v))) throw new DomainError('INVALID_EVENT', `bad refresh stamp for ${k}`);
    }
    s.dashboards[dashboardKey(e.actorId, scope)] = { userId: e.actorId, scope, cards: [...p.cards], refreshed: { ...(p.refreshed ?? {}) }, seq: e.seq };
  },

  'chat.asked': (s, e) => {
    const p = e.payload;
    const scope = text(p.scope, 'scope');
    requireScope(s, scope, e.actorId);
    const key = dashboardKey(e.actorId, scope);
    const thread: ChatThread = s.chats[key] ?? { userId: e.actorId, scope, messages: [], clearedSeq: 0 };
    const messageId = text(p.messageId, 'messageId');
    if (thread.messages.some((m) => m.id === messageId)) throw new DomainError('ALREADY_EXISTS', `message ${messageId} already exists`, { messageId });
    const msg: ChatMessage = { id: messageId, text: text(p.text, 'text'), reply: checkReply(p.reply), at: e.recordedAt, seq: e.seq };
    thread.messages.push(msg);
    s.chats[key] = thread;
  },
  'chat.cleared': (s, e) => {
    const p = e.payload;
    const scope = text(p.scope, 'scope');
    requireScope(s, scope, e.actorId);
    const key = dashboardKey(e.actorId, scope);
    const thread = s.chats[key];
    if (thread) thread.clearedSeq = e.seq;
    else s.chats[key] = { userId: e.actorId, scope, messages: [], clearedSeq: e.seq };
  },
};

function linkNeeds(s: State, projectId: Id, ids: Id[], actorId: Id, privateTo: Id | null): Id[] {
  if (!Array.isArray(ids)) throw new DomainError('INVALID_EVENT', 'needIds must be a list');
  const out: Id[] = [];
  for (const id of ids) {
    const n = visible(s.needs, id, 'need', actorId);
    if (n.projectId !== projectId) throw new DomainError('INVALID_EVENT', 'need belongs to another project');
    if (n.privateTo !== null && privateTo === null) throw new DomainError('PRIVATE_ITEM', 'a shared artifact cannot link a private need');
    if (!out.includes(n.id)) out.push(n.id);
  }
  return out;
}

export const EVENT_TYPES = Object.keys(handlers) as EventType[];

function validateEnvelope(s: State, e: DomainEvent): void {
  if (typeof e.id !== 'string' || e.id.length === 0) throw new DomainError('INVALID_EVENT', 'event id missing');
  if (typeof e.actorId !== 'string' || e.actorId.length === 0) throw new DomainError('INVALID_EVENT', 'actorId missing');
  if (!Number.isInteger(e.seq) || e.seq <= s.lastSeq) {
    throw new DomainError('SEQ_NOT_MONOTONIC', `seq ${e.seq} after ${s.lastSeq}`, { seq: e.seq, lastSeq: s.lastSeq });
  }
  const t = Date.parse(e.recordedAt);
  if (Number.isNaN(t)) throw new DomainError('INVALID_EVENT', `recordedAt ${e.recordedAt} is not ISO time`);
  if (s.lastRecordedAt !== null && t < Date.parse(s.lastRecordedAt)) {
    throw new DomainError('SEQ_NOT_MONOTONIC', 'recordedAt must not go backwards in seq order');
  }
  if (e.occurredAt !== undefined && Number.isNaN(Date.parse(e.occurredAt))) throw new DomainError('INVALID_EVENT', 'occurredAt is not ISO time');
  if (!Object.prototype.hasOwnProperty.call(handlers, e.type)) throw new DomainError('UNKNOWN_EVENT_TYPE', `unknown event type ${String(e.type)}`, { type: e.type });
  if (!e.payload || typeof e.payload !== 'object') throw new DomainError('INVALID_EVENT', 'payload must be an object');
}

/**
 * Pure: returns a new (deeply frozen) state, or throws `DomainError` leaving
 * the input untouched. Duplicate event ids are ignored.
 */
export function applyEvent(state: State, event: DomainEvent): State {
  if (state.seenEventIds[event.id] !== undefined) return state;
  validateEnvelope(state, event);
  const ev = JSON.parse(JSON.stringify(event)) as DomainEvent;
  const handler = handlers[ev.type as EventType] as Handler<EventType>;
  return produce(state, (draft) => {
    const s = draft as State;
    handler(s, ev as EventEnvelope<EventType>);
    s.lastSeq = ev.seq;
    s.lastRecordedAt = ev.recordedAt;
    s.seenEventIds[ev.id] = ev.seq;
  });
}

