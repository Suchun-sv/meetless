import { describe, expect, it } from 'vitest';
import { DomainError, needVersion, replay, type DomainErrorCode } from '../src/index';
import { atlas, P, R, U } from './log';

const rejects = (fn: () => unknown, code: DomainErrorCode) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
};

describe('need lifecycles', () => {
  it('external needs move through todo / doing / met / partial / moved / dropped; hypothesis statuses are refused', () => {
    const log = atlas();
    for (const s of ['doing', 'partial', 'met', 'moved', 'dropped', 'todo'] as const) {
      log.emit('need.status_set', U.ben, { needId: 'n-export', status: s });
      expect(log.state.needs['n-export']!.status).toBe(s);
    }
    rejects(() => log.emit('need.status_set', U.ben, { needId: 'n-export', status: 'held' }), 'INVALID_STATUS');
    rejects(() => log.emit('need.status_set', U.ben, { needId: 'n-export', status: 'refuted', verdict: 'x' }), 'INVALID_STATUS');
  });

  it('hypotheses go untested / testing / held / refuted / parked with a verdict; refuted stays visible', () => {
    const log = atlas();
    expect(log.state.needs['h-cache']!.status).toBe('untested');
    log.emit('need.status_set', U.ben, { needId: 'h-cache', status: 'testing' });
    log.emit('need.status_set', U.ben, { needId: 'h-cache', status: 'refuted', verdict: 'Refuted: 48 → 47 s, reverted' });
    const h = log.state.needs['h-cache']!;
    expect(h.status).toBe('refuted');
    expect(h.verdict).toContain('reverted');
    rejects(() => log.emit('need.status_set', U.ben, { needId: 'h-cache', status: 'met' }), 'INVALID_STATUS');
    rejects(() => log.emit('need.status_set', U.ben, { needId: 'n-export', status: 'doing', verdict: 'x' }), 'INVALID_EVENT');
    // Still in the record; nothing is deleted.
    expect(Object.keys(log.state.needs)).toContain('h-cache');
  });

  it('numbers shared needs per kind and project: N1, N2, H1', () => {
    const s = atlas().state;
    expect([s.needs['n-export']!.code, s.needs['n-filter']!.code, s.needs['h-cache']!.code]).toEqual(['N1', 'N2', 'H1']);
  });

  it('rejects non-members, unknown rounds and needs from another project', () => {
    const log = atlas();
    rejects(() => log.emit('need.created', U.eve, { needId: 'x', projectId: P, kind: 'ext', title: 't', roundId: null, source: { src: 'chat', date: '2026-11-20', quote: '', ref: '' } }), 'NOT_A_MEMBER');
    rejects(() => log.emit('need.created', U.me, { needId: 'x', projectId: P, kind: 'ext', title: 't', roundId: 'nope', source: { src: 'chat', date: '2026-11-20', quote: '', ref: '' } }), 'NOT_FOUND');
    rejects(() => log.emit('need.updated', U.me, { needId: 'n-export', parentId: 'n-export' }), 'INVALID_EVENT');
  });

  it('a revision bumps the context version, keeps history and updates the criteria; a reason is required', () => {
    const log = atlas();
    const n0 = log.state.needs['n-filter']!;
    expect(needVersion(n0)).toBe(1);
    log.emit('need.revised', U.lin, { needId: 'n-filter', revisionId: 'rv1', text: 'Add a “last 7 days” shortcut', why: 'Mr Wang’s email, 11-22', date: '2026-11-22' });
    const n1 = log.state.needs['n-filter']!;
    expect(needVersion(n1)).toBe(2);
    expect(n1.revisions[0]).toMatchObject({ version: 2, by: U.lin, why: 'Mr Wang’s email, 11-22' });
    expect(n1.accept).toBe('Add a “last 7 days” shortcut');
    // Changing owner or round is not a revision.
    log.emit('need.updated', U.lin, { needId: 'n-filter', ownerId: U.ben, roundId: R.r2 });
    expect(needVersion(log.state.needs['n-filter']!)).toBe(2);
    rejects(() => log.emit('need.revised', U.lin, { needId: 'n-filter', revisionId: 'rv2', text: 'x', why: ' ', date: '2026-11-23' }), 'REASON_REQUIRED');
  });

  it('is idempotent on event ids and replays to the same state', () => {
    const log = atlas();
    const e = log.emit('need.status_set', U.ben, { needId: 'n-export', status: 'doing' }, { id: 'same-id' });
    const before = log.state;
    log.emit('need.status_set', U.ben, { needId: 'n-export', status: 'met' }, { id: e.id });
    expect(log.state).toBe(before);
    expect(replay(log.events)).toEqual(log.state);
  });

  it('rounds: the first is current, delivering moves on to the next and freezes the account', () => {
    const log = atlas();
    expect(log.state.rounds[R.r1]!.status).toBe('current');
    expect(log.state.rounds[R.r2]!.status).toBe('planned');
    log.emit('need.status_set', U.me, { needId: 'n-export', status: 'met' });
    log.emit('round.delivered', U.me, { roundId: R.r1, date: '2026-11-28', items: ['Export v1'] });
    const r1 = log.state.rounds[R.r1]!;
    expect(r1.status).toBe('delivered');
    expect(r1.delivery!.account).toEqual([
      { needId: 'n-export', status: 'met', note: '' },
      { needId: 'n-filter', status: 'todo', note: '' },
    ]);
    expect(log.state.rounds[R.r2]!.status).toBe('current');
    log.emit('need.status_set', U.me, { needId: 'n-filter', status: 'met' });
    expect(log.state.rounds[R.r1]!.delivery!.account[1]!.status).toBe('todo');
    rejects(() => log.emit('round.delivered', U.me, { roundId: R.r1, date: '2026-11-29' }), 'INVALID_STATE_TRANSITION');
    rejects(() => log.emit('round.created', U.me, { roundId: 'bad', projectId: P, title: 'x', kind: 'hard', start: '2026-12-10', due: '2026-12-01' }), 'INVALID_EVENT');
  });
});
