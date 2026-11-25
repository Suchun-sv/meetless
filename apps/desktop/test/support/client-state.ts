import type { DomainEvent, EventScope, Id, State } from '@meetless/core';
import { safeReplay, type Replayed } from '../../src/renderer/model/state';

/**
 * An accepted log with each event's stored read scope: `Log` (log.ts), core's test logs and
 * `sample(locale)` all have this shape. `scopes[i]` belongs to `events[i]`; `state` is the full
 * service state after the last event.
 */
export interface ScopedLog {
  events: readonly DomainEvent[];
  scopes: readonly EventScope[];
  state: State;
}

/** The events the service streams to `userId`: current membership of the event's project, and only the owner's private events. */
export function streamFor(log: ScopedLog, userId: Id): DomainEvent[] {
  return log.events.filter((_e, i) => {
    const sc = log.scopes[i]!;
    if (sc.privateTo !== null && sc.privateTo !== userId) return false;
    return sc.projectId === null || (log.state.projects[sc.projectId]?.memberIds.includes(userId) ?? false);
  });
}

/** What `userId`'s desktop client holds: its stream replayed with the renderer's own `safeReplay`, skipped events included. */
export function clientReplay(log: ScopedLog, userId: Id): Replayed {
  return safeReplay(streamFor(log, userId));
}

/**
 * The state `userId`'s client renders (`live`). Throws when the client could not apply an event of
 * its own stream: that is a bug in core or in the scope rules, never something to render around.
 */
export function clientState(log: ScopedLog, userId: Id): State {
  const { state, skipped } = clientReplay(log, userId);
  if (skipped.length > 0) {
    throw new Error(`the client of ${userId} skipped ${skipped.length} event(s): ${skipped.map((e) => `${e.seq} ${e.type}`).join(', ')}`);
  }
  return state;
}
