import { describe, expect, it } from 'vitest';
import { deliverySections, draftItems } from '../../src/renderer/deliveries/model';
import { Log } from '../support/log';

const TODAY = '2026-11-24';
const PROJECT = 'p1';

/**
 * A project with three rounds: r1 (n1) delivered — its only shared need (n1) is frozen into the
 * delivery account, and a feedback need (n4, logged by Zhou) carries its lineage; r2 (n2),
 * current after r1's delivery — a shared need (n2) sits in its draft account, alongside a
 * private need (np1) and a hypothesis (h1) that must never reach the draft; r3 (n3), planned.
 */
function fixture(): Log {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale: 'en' });
  log.emit('user.registered', 'system', { userId: 'u-zhou', displayName: 'Zhou', locale: 'en' });
  log.emit('project.created', 'u-alex', { projectId: PROJECT, name: 'P1' });
  log.emit('project.member_added', 'u-alex', { projectId: PROJECT, userId: 'u-zhou' });

  log.emit('round.created', 'u-alex', { roundId: 'r1', projectId: PROJECT, title: 'Round one', kind: 'cadence', start: '2026-11-01', due: '2026-11-10' });
  log.emit('round.created', 'u-alex', { roundId: 'r2', projectId: PROJECT, title: 'Round two', kind: 'cadence', start: '2026-11-11', due: '2026-11-20' });
  log.emit('round.created', 'u-alex', { roundId: 'r3', projectId: PROJECT, title: 'Round three', kind: 'hard', start: '2026-11-21', due: '2026-11-30' });

  log.emit('need.created', 'u-alex', { needId: 'n1', projectId: PROJECT, kind: 'ext', title: 'Need one', roundId: 'r1', source: { src: 'doc', date: TODAY, quote: 'q1', ref: 'r' } });

  // r1 was current when delivered; delivering it hands "current" to the next planned round (r2).
  log.emit('round.delivered', 'u-alex', { roundId: 'r1', date: '2026-11-10', items: ['Shipped x'] });

  // Feedback from the r1 delivery: a new shared need whose lineage points back at r1. It is left
  // unassigned to any round (roundId null), so it never also shows up in r2's draft account.
  log.emit('need.created', 'u-zhou', { needId: 'n4', projectId: PROJECT, kind: 'ext', title: 'Feedback need', roundId: null, fromRoundId: 'r1', source: { src: 'meeting', date: '2026-11-10', quote: 'please also do y', ref: 'review' } });

  log.emit('need.created', 'u-alex', { needId: 'n2', projectId: PROJECT, kind: 'ext', title: 'Need two', roundId: 'r2', source: { src: 'doc', date: TODAY, quote: 'q2', ref: 'r' } });
  log.emit('need.created', 'u-alex', { needId: 'np1', projectId: PROJECT, kind: 'ext', title: 'Secret need', roundId: 'r2', source: { src: 'doc', date: TODAY, quote: 'q3', ref: 'r' }, private: true });
  log.emit('need.created', 'u-alex', { needId: 'h1', projectId: PROJECT, kind: 'hyp', title: 'A hypothesis', roundId: 'r2', source: { src: 'doc', date: TODAY, quote: 'q4', ref: 'r' } });

  return log;
}

describe('deliverySections', () => {
  it('sections run newest round first; the delivered round has a frozen account and feedback needs', () => {
    const log = fixture();
    const secs = deliverySections(log.state, PROJECT, null);
    expect(secs.map((s) => s.round.n)).toEqual([3, 2, 1]);
    expect(secs[0]!.round.n).toBeGreaterThan(secs.at(-1)!.round.n);

    const delivered = secs.find((s) => s.round.status === 'delivered')!;
    expect(delivered.delivered!.account.length).toBeGreaterThan(0);
    expect(delivered.delivered!.account.map((a) => a.needId)).toEqual(['n1']);
    expect(delivered.feedback.map((n) => n.id)).toEqual(['n4']);
  });

  it('only the current round has a draft, built from shared external needs in the round', () => {
    const log = fixture();
    const live = log.state;
    const secs = deliverySections(live, PROJECT, null);

    const cur = secs.find((s) => s.round.status === 'current')!;
    expect(cur.round.n).toBe(2);
    expect(cur.draft).not.toBeNull();
    expect(cur.draft!.account.map((a) => a.needId)).toEqual(['n2']);
    expect(cur.draft!.account.every((a) => live.needs[a.needId]!.privateTo === null && live.needs[a.needId]!.kind === 'ext')).toBe(true);

    // Neither the private need (np1) nor the hypothesis (h1), both also filed under r2, leak in.
    expect(cur.draft!.account.some((a) => a.needId === 'np1' || a.needId === 'h1')).toBe(false);
    // Only the current round has a draft.
    expect(secs.filter((s) => s.round.status !== 'current').every((s) => s.draft === null)).toBe(true);
  });

  it('selected keeps one round; draftItems drops blank lines', () => {
    const log = fixture();
    const secs = deliverySections(log.state, PROJECT, 2);
    expect(secs.length).toBe(1);
    expect(secs[0]!.round.n).toBe(2);

    expect(draftItems(' a \n\n b\r\n')).toEqual(['a', 'b']);
    expect(draftItems('')).toEqual([]);
  });

  it('delivering freezes the account: a later status change does not alter it', () => {
    const log = fixture();
    expect(log.state.needs.n1!.status).toBe('todo');

    log.emit('need.status_set', 'u-alex', { needId: 'n1', status: 'met' });
    expect(log.state.needs.n1!.status).toBe('met');

    const secs = deliverySections(log.state, PROJECT, 1);
    expect(secs[0]!.delivered!.account.find((a) => a.needId === 'n1')!.status).toBe('todo');
  });
});
