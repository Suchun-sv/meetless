import { applyEvent, emptyState, eventScope, type DomainEvent, type EventScope, type State } from '@meetless/core';
import { buildSample, type SampleAction, type SampleOptions } from './build';
import { loadPrototype } from './prototype';

export interface SampleReplay {
  state: State;
  events: DomainEvent[];
  scopes: EventScope[];
}

/**
 * Replays sample actions through the core on top of `initial`, the way the
 * service would accept them: seq continues from `initial.lastSeq`, and
 * recordedAt starts at `clockStart` (ms) and advances one second per event.
 * Ids already in `initial` are skipped (as the core skips duplicates).
 * Throws naming the first command that does not replay; `initial` is never changed.
 */
export function replayActions(actions: readonly SampleAction[], initial: State = emptyState(), clockStart = Date.now()): SampleReplay {
  let state = initial;
  const events: DomainEvent[] = [];
  const scopes: EventScope[] = [];
  for (const { actorId, cmd } of actions) {
    const e = {
      seq: state.lastSeq + 1,
      id: cmd.id,
      type: cmd.type,
      actorId,
      recordedAt: new Date(clockStart + events.length * 1000).toISOString(),
      ...(cmd.occurredAt ? { occurredAt: cmd.occurredAt } : {}),
      payload: cmd.payload,
    } as DomainEvent;
    let next: State;
    try {
      next = applyEvent(state, e);
    } catch (err) {
      throw new Error(`sample command ${cmd.id} (${cmd.type}) does not replay: ${(err as Error).message}`, { cause: err });
    }
    if (next === state) continue; // a duplicate id
    state = next;
    events.push(e);
    scopes.push(eventScope(state, e));
  }
  return { state, events, scopes };
}

/**
 * The sample replayed through the core with its own seq and clock (one second
 * per event from 08:00 UTC on `today`), as the service would have accepted it.
 * `scopes[i]` is the privacy scope of `events[i]`. For tests and fixtures.
 */
export function sampleState(opts: SampleOptions & { repoRoot: string }): SampleReplay {
  return replayActions(buildSample(loadPrototype(opts.repoRoot), opts), emptyState(), Date.parse(`${opts.today}T08:00:00.000Z`));
}
