import { applyEvent, emptyState, eventScope, type DomainEvent, type EventPayloads, type EventScope, type EventType, type Id, type State } from '@meetless/core';

/**
 * A core-validated event builder for component tests: each `emit` is applied through core
 * (the same validation the service runs) and only accepted events are kept, with their
 * privacy scope. `streamFor(userId)` is what the service would send that user.
 */
export class Log {
  events: DomainEvent[] = [];
  scopes: EventScope[] = [];
  state: State;
  private clock: number;

  constructor(opts: { start?: string; initial?: State } = {}) {
    this.state = opts.initial ?? emptyState();
    this.clock = Date.parse(opts.start ?? '2026-11-24T09:00:00Z');
  }

  /** Applies one event as `actorId`; throws the core DomainError when core refuses it. */
  emit<K extends EventType>(type: K, actorId: Id, payload: EventPayloads[K], opts: { id?: string } = {}): DomainEvent {
    const seq = this.state.lastSeq + 1;
    const e = { seq, id: opts.id ?? `e${seq}`, type, actorId, recordedAt: new Date(this.clock).toISOString(), payload } as unknown as DomainEvent;
    const next = applyEvent(this.state, e);
    this.clock += 60_000;
    if (next === this.state) return e;
    this.state = next;
    this.events.push(e);
    this.scopes.push(eventScope(next, e));
    return e;
  }

  /** The events the service would send `userId`: current membership and the privacy filter. */
  streamFor(userId: Id): DomainEvent[] {
    return this.events.filter((_e, i) => {
      const sc = this.scopes[i]!;
      if (sc.privateTo !== null && sc.privateTo !== userId) return false;
      if (sc.projectId === null) return true;
      return this.state.projects[sc.projectId]?.memberIds.includes(userId) ?? false;
    });
  }
}
