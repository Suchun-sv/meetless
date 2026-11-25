/**
 * The client side of the `/v1/ws` sync protocol, shared by `ClientNode` (SQLite cache, Node) and
 * the web bridge (in memory, browser). Renderer-safe: no Node imports.
 */
import type { DomainEvent, Id, Seq } from '@meetless/core';

/** Server -> client WebSocket messages (mirror of apps/server/src/http.ts). */
export type ServerMessage =
  | { type: 'hello'; head: Seq; epoch: Id | null; userId: Id }
  | { type: 'events'; events: DomainEvent[]; cursor: Seq; head: Seq; epoch: Id | null }
  | { type: 'synced'; cursor: Seq; head: Seq; epoch: Id | null }
  | { type: 'reset'; reason: string }
  | { type: 'error'; code: string }
  | { type: 'build'; hash: string };

/** Where a client keeps the visible log: `LocalCache` (SQLite) or `MemorySyncStore`. */
export interface SyncStore {
  readonly cursor: Seq;
  readonly epoch: Id | null;
  /** Stores new events and advances the cursor (never back). Returns the events that were actually new. */
  append(events: DomainEvent[], cursor: Seq, epoch: Id | null): DomainEvent[];
  /** Replaces everything (access changed / different server log). */
  replace(events: DomainEvent[], cursor: Seq, epoch: Id | null): void;
}

/** The `subscribe` message that resumes from the store's cursor. */
export function subscribeMessage(store: Pick<SyncStore, 'cursor' | 'epoch'>): string {
  return JSON.stringify({ type: 'subscribe', after: store.cursor, epoch: store.epoch });
}

export interface EventsPage {
  events: DomainEvent[];
  cursor: Seq;
  head: Seq;
  epoch: Id | null;
}

/** Full refetch from seq 0: pages `GET /v1/events` until the cursor reaches the head (or stops moving). */
export async function fetchAllEvents(fetchPage: (after: Seq) => Promise<EventsPage>): Promise<{ events: DomainEvent[]; cursor: Seq; epoch: Id | null }> {
  let after = 0;
  let epoch: Id | null = null;
  const events: DomainEvent[] = [];
  for (;;) {
    const page = await fetchPage(after);
    events.push(...page.events);
    epoch = page.epoch;
    const done = page.cursor >= page.head || page.cursor === after;
    after = page.cursor;
    if (done) break;
  }
  return { events, cursor: after, epoch };
}

/** The web's store: the visible log in memory, refetched on every page load. Same rules as `LocalCache`. */
export class MemorySyncStore implements SyncStore {
  private bySeq = new Map<Seq, DomainEvent>();
  private _cursor: Seq = 0;
  private _epoch: Id | null = null;

  get cursor(): Seq {
    return this._cursor;
  }

  get epoch(): Id | null {
    return this._epoch;
  }

  events(): DomainEvent[] {
    return [...this.bySeq.values()].sort((a, b) => a.seq - b.seq);
  }

  append(events: DomainEvent[], cursor: Seq, epoch: Id | null): DomainEvent[] {
    const fresh: DomainEvent[] = [];
    for (const e of events) {
      if (this.bySeq.has(e.seq)) continue;
      this.bySeq.set(e.seq, e);
      fresh.push(e);
    }
    if (cursor > this._cursor) this._cursor = cursor;
    if (epoch !== null || this._epoch === null) this._epoch = epoch;
    return fresh;
  }

  replace(events: DomainEvent[], cursor: Seq, epoch: Id | null): void {
    this.bySeq = new Map(events.map((e) => [e.seq, e]));
    this._cursor = cursor;
    this._epoch = epoch;
  }
}
