import { describe, expect, it } from 'vitest';
import {
  DomainError,
  activityCard,
  isProgress,
  matchNeed,
  nextRound,
  roundFeedback,
  type DomainErrorCode,
} from '../src/index';
import { atlas, P, R, U } from './log';

const rejects = (fn: () => unknown, code: DomainErrorCode) => {
  try {
    fn();
  } catch (e) {
    expect((e as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
};

describe('work linking', () => {
  it('a member links an unlinked work item; linking clears autoLinked and keeps capture', () => {
    const log = atlas();
    log.emit('work.recorded', U.me, {
      workId: 'w-free',
      projectId: P,
      src: 'commit',
      text: 'bugfix: date handling',
      date: '2026-11-21',
      capture: true,
      needId: 'n-export',
      autoLinked: true,
    });
    expect(log.state.work['w-free']).toMatchObject({ needId: 'n-export', autoLinked: true, capture: true });
    log.emit('work.linked', U.lin, { workId: 'w-free', needId: 'n-filter', effect: 'advance' });
    const w = log.state.work['w-free']!;
    expect(w.needId).toBe('n-filter');
    expect(w.autoLinked).toBe(false);
    expect(w.capture).toBe(true);
    expect(w.effect).toBe('advance');
  });

  it('ignored work is not progress and leaves the activity card; ignoring twice is ALREADY_DECIDED', () => {
    const log = atlas();
    log.emit('work.recorded', U.me, { workId: 'w-free', projectId: P, src: 'commit', text: 'noise commit', date: '2026-11-21' });
    expect(isProgress(log.state.work['w-free']!)).toBe(true);
    expect(activityCard(log.state, P).map((x) => x.id)).toContain('w-free');
    log.emit('work.ignored', U.lin, { workId: 'w-free' });
    const w = log.state.work['w-free']!;
    expect(w.ignored).toBe(true);
    expect(isProgress(w)).toBe(false);
    expect(activityCard(log.state, P).map((x) => x.id)).not.toContain('w-free');
    rejects(() => log.emit('work.ignored', U.me, { workId: 'w-free' }), 'ALREADY_DECIDED');
  });

  it('linking an ignored work item clears ignored, so it counts as progress again', () => {
    const log = atlas();
    log.emit('work.recorded', U.me, { workId: 'w-free', projectId: P, src: 'commit', text: 'noise commit', date: '2026-11-21' });
    log.emit('work.ignored', U.lin, { workId: 'w-free' });
    log.emit('work.linked', U.me, { workId: 'w-free', needId: 'n-filter' });
    expect(log.state.work['w-free']).toMatchObject({ needId: 'n-filter', ignored: false });
    expect(isProgress(log.state.work['w-free']!)).toBe(true);
  });

  it('shared work cannot be linked to a private need', () => {
    const log = atlas();
    log.emit('need.created', U.me, {
      needId: 'h-priv',
      projectId: P,
      kind: 'hyp',
      title: 'private hypothesis',
      roundId: R.r1,
      expect: 'x',
      source: { src: 'doc', date: '2026-11-20', quote: '', ref: '' },
      private: true,
    });
    log.emit('work.recorded', U.me, { workId: 'w-free', projectId: P, src: 'commit', text: 'noise', date: '2026-11-21' });
    rejects(() => log.emit('work.linked', U.me, { workId: 'w-free', needId: 'h-priv' }), 'PRIVATE_ITEM');
  });

  it('autoLinked without a need is rejected', () => {
    const log = atlas();
    rejects(
      () => log.emit('work.recorded', U.me, { workId: 'w-bad', projectId: P, src: 'commit', text: 'x', date: '2026-11-21', autoLinked: true }),
      'INVALID_EVENT',
    );
  });

  it('matchNeed prefers a named code, then keywords, else null', () => {
    const log = atlas();
    const needs = Object.values(log.state.needs);
    const idOf = (code: string) => needs.find((n) => n.code === code)!.id;
    expect(matchNeed('c91a N2 tweak', needs)).toEqual({ needId: idOf('N2'), by: 'code' });
    expect(matchNeed('date range filter for export', needs)?.by).toBe('keywords');
    expect(matchNeed('bump eslint', needs)).toBeNull();
  });

  it('nextRound and roundFeedback', () => {
    const log = atlas();
    expect(nextRound(log.state, P)).toMatchObject({ id: R.r2 });
    log.emit('need.status_set', U.me, { needId: 'n-export', status: 'met' });
    log.emit('round.delivered', U.me, { roundId: R.r1, date: '2026-11-28' });
    expect(log.state.rounds[R.r2]!.status).toBe('current');
    expect(nextRound(log.state, P)).toBeNull();
    log.emit('need.created', U.me, {
      needId: 'n-feedback',
      projectId: P,
      kind: 'ext',
      title: 'Follow-up ask',
      roundId: null,
      fromRoundId: R.r1,
      requester: { name: 'Mr Wang (Client A)' },
      accept: 'x',
      source: { src: 'meeting', date: '2026-11-28', quote: '', ref: '' },
    });
    expect(roundFeedback(log.state, R.r1).map((n) => n.id)).toEqual(['n-feedback']);
  });
});
