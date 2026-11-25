import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DomainEvent } from '@meetless/core';
import { LocalCache } from '../src/index';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const file = () => {
  const d = mkdtempSync(join(tmpdir(), 'meetless-cache-'));
  dirs.push(d);
  return join(d, 'nested', 'cache.sqlite');
};
const ev = (seq: number): DomainEvent =>
  ({ seq, id: `e${seq}`, type: 'user.registered', actorId: 'system', recordedAt: '2026-11-24T09:00:00Z', payload: { userId: `u${seq}`, displayName: 'x', locale: 'en' } }) as DomainEvent;

describe('LocalCache (node:sqlite)', () => {
  it('stores events idempotently, advances the cursor, and survives reopening', () => {
    const f = file();
    const c = new LocalCache(f);
    expect(c.append([ev(1), ev(2)], 2, 'e1').map((e) => e.seq)).toEqual([1, 2]);
    expect(c.append([ev(2), ev(4)], 5, 'e1').map((e) => e.seq)).toEqual([4]); // gap at 3 = filtered by server
    expect(c.cursor).toBe(5);
    c.putOutbox({ id: 'o1', type: 'work.recorded', payload: {}, queuedAt: 'now', status: 'queued', error: null });
    c.putOutbox({ id: 'o2', type: 'work.recorded', payload: {}, queuedAt: 'now', status: 'queued', error: null });
    c.putOutbox({ id: 'o1', type: 'work.recorded', payload: {}, queuedAt: 'now', status: 'rejected', error: { code: 'X' } });
    c.setSetting('locale', 'zh-CN');
    c.close();

    const d = new LocalCache(f);
    expect(d.events().map((e) => e.seq)).toEqual([1, 2, 4]);
    expect([d.cursor, d.epoch]).toEqual([5, 'e1']);
    expect(d.outbox().map((o) => [o.id, o.status])).toEqual([['o1', 'rejected'], ['o2', 'queued']]);
    expect(d.getSetting('locale')).toBe('zh-CN');
    d.replace([ev(9)], 9, 'other');
    expect(d.events().map((e) => e.seq)).toEqual([9]);
    expect([d.cursor, d.epoch]).toEqual([9, 'other']);
    d.removeOutbox('o1');
    expect(d.outbox().map((o) => o.id)).toEqual(['o2']);
    d.close();
  });
});
