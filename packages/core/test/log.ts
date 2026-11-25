import { randomUUID } from 'node:crypto';
import {
  applyEvent,
  emptyState,
  eventScope,
  type DomainEvent,
  type EventEnvelope,
  type EventPayloads,
  type EventType,
  type Id,
  type State,
} from '../src/index';

/**
 * Minimal stand-in for the sync service: assigns seq + recordedAt, validates
 * by applying to its current state, records each event's scope (project,
 * privateTo) and only appends accepted events.
 */
export class TestLog {
  events: DomainEvent[] = [];
  scopes: { projectId: Id | null; privateTo: Id | null }[] = [];
  state: State = emptyState();
  private seq = 0;
  private clock: number;

  constructor(start = '2026-11-20T09:00:00Z') {
    this.clock = Date.parse(start);
  }

  now(): string {
    return new Date(this.clock).toISOString();
  }

  emit<K extends EventType>(type: K, actorId: string, payload: EventPayloads[K], opts: { id?: string } = {}): EventEnvelope<K> {
    const e = { seq: this.seq + 1, id: opts.id ?? randomUUID(), type, actorId, recordedAt: this.now(), payload } as EventEnvelope<K>;
    const next = applyEvent(this.state, e as unknown as DomainEvent);
    if (next !== this.state) {
      this.state = next;
      this.seq += 1;
      this.events.push(e as unknown as DomainEvent);
      this.scopes.push(eventScope(next, e as unknown as DomainEvent));
    }
    this.clock += 60_000;
    return e;
  }

  /** The events a given user would receive from the service (membership + privacy filter). */
  streamFor(userId: Id): DomainEvent[] {
    return this.events.filter((_e, i) => {
      const sc = this.scopes[i]!;
      if (sc.privateTo !== null && sc.privateTo !== userId) return false;
      if (sc.projectId === null) return true;
      return this.state.projects[sc.projectId]?.memberIds.includes(userId) ?? false;
    });
  }
}

export const U = { me: 'u-alex', lin: 'u-lin', ben: 'u-ben', zhou: 'u-zhou', eve: 'u-eve' } as const;
export const P = 'p-atlas';
export const R = { r1: 'r1', r2: 'r2', r3: 'r3', r4: 'r4' } as const;

const src = (quote: string, date = '2026-11-02') => ({ src: 'meeting' as const, date, quote, ref: 'notes' });

/** A small team project: 4 members, 2 roles, 3 rounds (round 1 current), a few needs. */
export function atlas(): TestLog {
  const log = new TestLog();
  for (const [id, name] of Object.entries({ [U.me]: 'Alex', [U.lin]: 'Lin An', [U.ben]: 'Ben', [U.zhou]: 'Zhou Yu', [U.eve]: 'Eve' })) {
    log.emit('user.registered', 'system', { userId: id, displayName: name, locale: 'en' });
  }
  log.emit('project.created', U.me, { projectId: P, name: 'Atlas export' });
  for (const u of [U.lin, U.ben, U.zhou]) log.emit('project.member_added', U.me, { projectId: P, userId: u });
  log.emit('role.created', U.me, { roleId: 'role-pm', projectId: P, name: 'Product' });
  log.emit('role.created', U.me, { roleId: 'role-dev', projectId: P, name: 'Engineering' });
  log.emit('role.member_assigned', U.me, { roleId: 'role-pm', userId: U.lin });
  log.emit('role.member_assigned', U.me, { roleId: 'role-dev', userId: U.me });
  log.emit('role.member_assigned', U.me, { roleId: 'role-dev', userId: U.ben });
  log.emit('round.created', U.me, { roundId: R.r1, projectId: P, title: 'Client delivery', kind: 'hard', start: '2026-11-18', due: '2026-11-28' });
  log.emit('round.created', U.me, { roundId: R.r2, projectId: P, title: 'Phase 2', kind: 'cadence', start: '2026-11-28', due: '2026-12-12' });
  log.emit('need.created', U.me, {
    needId: 'n-export',
    projectId: P,
    kind: 'ext',
    title: 'Data export (12 core fields)',
    roundId: R.r1,
    requester: { name: 'Mr Wang (Client A)' },
    accept: 'CSV export; 12 core fields in v1',
    source: src('We export customer data monthly; core fields are enough for v1.'),
  });
  log.emit('need.created', U.me, {
    needId: 'n-filter',
    projectId: P,
    kind: 'ext',
    title: 'Export filters by date',
    roundId: R.r1,
    ownerId: U.zhou,
    requester: { name: 'Mr Wang (Client A)' },
    accept: 'Only the chosen range is exported',
    source: src('Export should filter by date.', '2026-11-09'),
  });
  log.emit('need.created', U.ben, {
    needId: 'h-cache',
    projectId: P,
    kind: 'hyp',
    title: 'A cache table speeds export up',
    roundId: R.r1,
    expect: 'Halve the time',
    verify: 'Load test with 10k rows',
    source: { src: 'commit', date: '2026-11-07', quote: 'a13c add export cache table', ref: 'Repo atlas-export' },
  });
  return log;
}
