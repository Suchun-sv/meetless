import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DomainEvent, Id, Seq } from '@meetless/core';
import type { OutboxItem } from './bridge';

/**
 * Local persistent cache of one account (server + user), stored with
 * `node:sqlite` (built into Node >= 22.13 and into Electron 45's Node 24, so no
 * native module has to be rebuilt per Electron ABI). It is a cache, never the
 * source of truth: it holds server-accepted events, the resume cursor, the
 * outbox of commands not yet accepted, and per-user settings.
 */
export class LocalCache {
  readonly kind = 'sqlite';
  private db: DatabaseSync;

  constructor(readonly file: string) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      pragma journal_mode = wal;
      pragma synchronous = normal;
      create table if not exists meta (key text primary key, value text not null);
      create table if not exists events (seq integer primary key, id text not null unique, json text not null);
      create table if not exists outbox (pos integer primary key autoincrement, id text not null unique, json text not null);
      create table if not exists settings (key text primary key, value text not null);
    `);
  }

  private meta(key: string): string | null {
    const row = this.db.prepare('select value from meta where key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string | null): void {
    if (value === null) this.db.prepare('delete from meta where key = ?').run(key);
    else this.db.prepare('insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value').run(key, value);
  }

  get cursor(): Seq {
    return Number(this.meta('cursor') ?? 0);
  }

  get epoch(): Id | null {
    return this.meta('epoch');
  }

  events(): DomainEvent[] {
    return (this.db.prepare('select json from events order by seq').all() as { json: string }[]).map((r) => JSON.parse(r.json) as DomainEvent);
  }

  private tx(fn: () => void): void {
    this.db.exec('begin immediate');
    try {
      fn();
      this.db.exec('commit');
    } catch (e) {
      this.db.exec('rollback');
      throw e;
    }
  }

  /** Atomically stores new events and advances the cursor. Returns the events that were actually new. */
  append(events: DomainEvent[], cursor: Seq, epoch: Id | null): DomainEvent[] {
    const fresh: DomainEvent[] = [];
    this.tx(() => {
      const ins = this.db.prepare('insert or ignore into events (seq, id, json) values (?, ?, ?)');
      for (const e of events) {
        if (ins.run(e.seq, e.id, JSON.stringify(e)).changes > 0) fresh.push(e);
      }
      if (cursor > this.cursor) this.setMeta('cursor', String(cursor));
      if (epoch !== null || this.epoch === null) this.setMeta('epoch', epoch);
    });
    return fresh;
  }

  /** Replaces the whole cache (access changed / different server log). */
  replace(events: DomainEvent[], cursor: Seq, epoch: Id | null): void {
    this.tx(() => {
      this.db.exec('delete from events');
      const ins = this.db.prepare('insert into events (seq, id, json) values (?, ?, ?)');
      for (const e of events) ins.run(e.seq, e.id, JSON.stringify(e));
      this.setMeta('cursor', String(cursor));
      this.setMeta('epoch', epoch);
    });
  }

  outbox(): OutboxItem[] {
    return (this.db.prepare('select json from outbox order by pos').all() as { json: string }[]).map((r) => JSON.parse(r.json) as OutboxItem);
  }

  putOutbox(item: OutboxItem): void {
    this.db
      .prepare('insert into outbox (id, json) values (?, ?) on conflict(id) do update set json = excluded.json')
      .run(item.id, JSON.stringify(item));
  }

  removeOutbox(id: Id): void {
    this.db.prepare('delete from outbox where id = ?').run(id);
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare('select value from settings where key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare('insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value').run(key, value);
  }

  close(): void {
    this.db.close();
  }
}
