import type { DomainEvent } from './events';
import { applyEvent } from './reducer';
import { emptyState, type IsoTime, type Seq, type State } from './types';

/** Order of record: server seq. Never occurredAt. */
export function orderBySeq(events: readonly DomainEvent[]): DomainEvent[] {
  return [...events].sort((a, b) => a.seq - b.seq);
}

export function replay(events: readonly DomainEvent[], initial: State = emptyState()): State {
  let s = initial;
  for (const e of orderBySeq(events)) s = applyEvent(s, e);
  return s;
}

/** State as of (and including) `cutoffSeq`. */
export function stateAt(events: readonly DomainEvent[], cutoffSeq: Seq): State {
  return replay(events.filter((e) => e.seq <= cutoffSeq));
}

/**
 * State as known at time T: every event the service had ACCEPTED by T
 * (recordedAt <= T), in seq order. Information imported later stays out of
 * earlier cut-offs even if its business time (occurredAt) is earlier.
 */
export function stateAtTime(events: readonly DomainEvent[], at: IsoTime): State {
  return stateAt(events, cutoffSeqAtTime(events, at));
}

/** Highest seq recorded at or before T (0 if none). Used as an agent-run context cut-off. */
export function cutoffSeqAtTime(events: readonly DomainEvent[], at: IsoTime): Seq {
  const t = Date.parse(at);
  if (Number.isNaN(t)) throw new Error(`invalid time ${at}`);
  let max = 0;
  for (const e of events) if (Date.parse(e.recordedAt) <= t && e.seq > max) max = e.seq;
  return max;
}
