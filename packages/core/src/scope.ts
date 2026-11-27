import type { DomainEvent } from './events';
import type { Id, State } from './types';

export interface EventScope {
  /** Project the event belongs to; null for team-level events (user directory, home dashboard). */
  projectId: Id | null;
  /** Only this user may receive the event (private items, personal dashboards). */
  privateTo: Id | null;
}

/**
 * Scope of an accepted event, computed by the service on the state AFTER the
 * event was applied. The service stores it with the event and filters every
 * read path with it: membership by `projectId`, privacy by `privateTo`.
 *
 * The switch is exhaustive: a new event type without a scope rule fails typecheck.
 */
export function eventScope(s: State, e: DomainEvent): EventScope {
  const open = (projectId: Id | null): EventScope => ({ projectId, privateTo: null });
  const need = (id: Id): EventScope => {
    const n = s.needs[id];
    return { projectId: n?.projectId ?? null, privateTo: n?.privateTo ?? null };
  };
  const input = (id: Id): EventScope => {
    const i = s.inputs[id];
    return { projectId: i?.projectId ?? null, privateTo: i?.privateTo ?? null };
  };
  const art = (id: Id): EventScope => {
    const a = s.artifacts[id];
    return { projectId: a?.projectId ?? null, privateTo: a?.privateTo ?? null };
  };
  const handoff = (id: Id) => open(s.handoffs[id]?.projectId ?? null);
  switch (e.type) {
    case 'user.registered':
    case 'user.locale_changed':
      return open(null);
    case 'project.created':
    case 'project.member_added':
    case 'project.renamed':
    case 'project.archived':
    case 'project.unarchived':
    case 'role.created':
    case 'round.created':
    case 'handoff.created':
    case 'proposal.created':
      return open(e.payload.projectId);
    case 'role.member_assigned':
    case 'role.member_removed':
      return open(s.roles[e.payload.roleId]?.projectId ?? null);
    case 'round.updated':
    case 'round.started':
    case 'round.delivered':
      return open(s.rounds[e.payload.roundId]?.projectId ?? null);
    case 'need.created':
    case 'need.revised':
    case 'need.updated':
    case 'need.status_set':
      return need(e.payload.needId);
    case 'need.shared':
      return open(s.needs[e.payload.needId]?.projectId ?? null);
    case 'work.recorded': {
      const w = s.work[e.payload.workId];
      return { projectId: e.payload.projectId, privateTo: w?.privateTo ?? null };
    }
    case 'work.linked':
    case 'work.ignored': {
      const w = s.work[e.payload.workId];
      return { projectId: w?.projectId ?? null, privateTo: w?.privateTo ?? null };
    }
    case 'input.imported':
    case 'input.scene_set':
    case 'extract.accepted':
    case 'extract.ignored':
      return input(e.payload.inputId);
    case 'input.shared':
      return open(s.inputs[e.payload.inputId]?.projectId ?? null);
    case 'conflict.resolved':
      return open(s.conflicts[e.payload.conflictId]?.projectId ?? null);
    case 'handoff.responded':
    case 'handoff.started':
    case 'handoff.returned':
    case 'handoff.confirmed':
    case 'handoff.reopened':
    case 'handoff.refresh_requested':
    case 'handoff.context_fetched':
      return handoff(e.payload.handoffId);
    case 'proposal.accepted':
    case 'proposal.rejected':
      return open(s.proposals[e.payload.proposalId]?.projectId ?? null);
    case 'artifact.created':
    case 'artifact.version_added':
    case 'artifact.linked':
    case 'artifactVersion.derived':
      return art(e.payload.artifactId);
    case 'artifact.shared':
      return open(s.artifacts[e.payload.artifactId]?.projectId ?? null);
    case 'dashboard.set':
    case 'chat.asked':
    case 'chat.cleared':
      return { projectId: e.payload.scope === 'home' ? null : e.payload.scope, privateTo: e.actorId };
    default: {
      const never: never = e;
      throw new Error(`no scope rule for ${(never as DomainEvent).type}`);
    }
  }
}

/** Projects the user may read: current membership. */
export function readableProjectIds(s: State, userId: Id): Set<Id> {
  const out = new Set<Id>();
  for (const p of Object.values(s.projects)) if (p.memberIds.includes(userId)) out.add(p.id);
  return out;
}

const keep = <T extends { projectId: Id; privateTo?: Id | null }>(rec: Record<Id, T>, ok: (x: T) => boolean): Record<Id, T> => {
  const out: Record<Id, T> = {};
  for (const [k, v] of Object.entries(rec)) if (ok(v)) out[k] = v;
  return out;
};

/**
 * What one user may see: projects they belong to, minus items private to
 * someone else, minus other users' dashboards. The service builds MCP
 * context, search and answers from this view; clients already hold exactly
 * this (the service filters their event stream the same way).
 */
export function viewFor(s: State, userId: Id): State {
  const readable = readableProjectIds(s, userId);
  const inP = (x: { projectId: Id }) => readable.has(x.projectId);
  const mine = (x: { projectId: Id; privateTo: Id | null }) => inP(x) && (x.privateTo === null || x.privateTo === userId);
  const projects: State['projects'] = {};
  for (const [k, p] of Object.entries(s.projects)) if (readable.has(p.id)) projects[k] = p;
  const dashboards: State['dashboards'] = {};
  for (const [k, d] of Object.entries(s.dashboards)) if (d.userId === userId) dashboards[k] = d;
  const chats: State['chats'] = {};
  for (const [k, c] of Object.entries(s.chats)) if (c.userId === userId) chats[k] = c;
  const privateCodes: State['privateCodes'] = {};
  for (const [k, v] of Object.entries(s.privateCodes)) if (k.split('|')[1] === userId) privateCodes[k] = v;
  return {
    ...s,
    // Event ids and seqs of everyone's events (private ones too) are bookkeeping for applyEvent, not the record.
    seenEventIds: {},
    privateCodes,
    projects,
    roles: keep(s.roles, inP),
    rounds: keep(s.rounds, inP),
    needs: keep(s.needs, mine),
    work: keep(s.work, mine),
    inputs: keep(s.inputs, mine),
    conflicts: keep(s.conflicts, inP),
    handoffs: keep(s.handoffs, inP),
    proposals: keep(s.proposals, inP),
    artifacts: keep(s.artifacts, mine),
    dashboards,
    chats,
  };
}

/** Removes every private item (also the viewer's own): what may be put into a link or handed to someone else. */
export function shareableView(s: State): State {
  const pub = <T extends { privateTo: Id | null; projectId: Id }>(rec: Record<Id, T>) => keep(rec, (x) => x.privateTo === null);
  return { ...s, seenEventIds: {}, needs: pub(s.needs), work: pub(s.work), inputs: pub(s.inputs), artifacts: pub(s.artifacts), dashboards: {}, chats: {} };
}
