import { describe, expect, it } from 'vitest';
import { DomainError, handoffForNeed, handoffStaleness, needVersion, refreshPending, type DomainErrorCode } from '../src/index';
import { atlas, P, U } from './log';

const rejects = (fn: () => unknown, code: DomainErrorCode) => {
  try {
    fn();
  } catch (e) {
    expect((e as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
};

function handed() {
  const log = atlas();
  log.emit('handoff.created', U.me, { handoffId: 'ho1', projectId: P, needId: 'n-filter', toId: U.zhou, ask: 'Add test cases for the date filter.', due: '2026-11-26' });
  return log;
}

describe('handoff state machine', () => {
  it('sent -> accepted -> doing -> returned -> done; only the sender confirms done', () => {
    const log = handed();
    expect(log.state.handoffs.ho1!.state).toBe('sent');
    rejects(() => log.emit('handoff.responded', U.me, { handoffId: 'ho1', response: 'accepted' }), 'NOT_AUTHORISED');
    log.emit('handoff.responded', U.zhou, { handoffId: 'ho1', response: 'accepted' });
    expect(log.state.needs['n-filter']!.ownerId).toBe(U.zhou);
    log.emit('handoff.started', U.zhou, { handoffId: 'ho1' });
    rejects(() => log.emit('handoff.confirmed', U.me, { handoffId: 'ho1' }), 'INVALID_STATE_TRANSITION');
    log.emit('handoff.returned', U.zhou, { handoffId: 'ho1', note: '6 tests, all green' });
    rejects(() => log.emit('handoff.confirmed', U.zhou, { handoffId: 'ho1' }), 'NOT_AUTHORISED');
    rejects(() => log.emit('handoff.confirmed', U.ben, { handoffId: 'ho1' }), 'NOT_AUTHORISED');
    log.emit('handoff.confirmed', U.me, { handoffId: 'ho1' });
    expect(log.state.handoffs.ho1!.history.map((h) => h.state)).toEqual(['sent', 'accepted', 'doing', 'returned', 'done']);
  });

  it('asked and declined; the sender may reopen a returned handoff with a reason', () => {
    const log = handed();
    log.emit('handoff.responded', U.zhou, { handoffId: 'ho1', response: 'asked', note: 'Which date field?' });
    rejects(() => log.emit('handoff.responded', U.zhou, { handoffId: 'ho1', response: 'asked' }), 'INVALID_STATE_TRANSITION');
    log.emit('handoff.responded', U.zhou, { handoffId: 'ho1', response: 'accepted' });
    log.emit('handoff.returned', U.zhou, { handoffId: 'ho1' });
    rejects(() => log.emit('handoff.reopened', U.me, { handoffId: 'ho1', note: '' }), 'REASON_REQUIRED');
    log.emit('handoff.reopened', U.me, { handoffId: 'ho1', note: 'Two tests still fail' });
    expect(log.state.handoffs.ho1!.state).toBe('doing');

    log.emit('handoff.created', U.me, { handoffId: 'ho2', projectId: P, needId: 'n-export', toId: U.ben, ask: 'x', due: null });
    log.emit('handoff.responded', U.ben, { handoffId: 'ho2', response: 'declined' });
    expect(handoffForNeed(log.state, 'n-export')).toBeNull();
    rejects(() => log.emit('handoff.started', U.ben, { handoffId: 'ho2' }), 'INVALID_STATE_TRANSITION');
  });

  it('only members, never to oneself, never a private need', () => {
    const log = handed();
    rejects(() => log.emit('handoff.created', U.me, { handoffId: 'x', projectId: P, needId: 'n-export', toId: U.eve, ask: 'x', due: null }), 'NOT_A_MEMBER');
    rejects(() => log.emit('handoff.created', U.me, { handoffId: 'x', projectId: P, needId: 'n-export', toId: U.me, ask: 'x', due: null }), 'INVALID_EVENT');
    log.emit('need.created', U.me, { needId: 'n-priv', projectId: P, kind: 'ext', title: 'mine', roundId: null, source: { src: 'doc', date: '2026-11-24', quote: '', ref: '' }, private: true });
    rejects(() => log.emit('handoff.created', U.me, { handoffId: 'x', projectId: P, needId: 'n-priv', toId: U.ben, ask: 'x', due: null }), 'PRIVATE_ITEM');
  });

  it('a progress report from the recipient (e.g. over MCP) moves accepted -> doing; a capture does not', () => {
    const log = handed();
    log.emit('handoff.responded', U.zhou, { handoffId: 'ho1', response: 'accepted' });
    log.emit('work.recorded', U.me, { workId: 'cap', projectId: P, needId: 'n-filter', src: 'commit', text: 'captured', date: '2026-11-24', capture: true });
    expect(log.state.handoffs.ho1!.state).toBe('accepted');
    log.emit('work.recorded', U.zhou, { workId: 'w1', projectId: P, needId: 'n-filter', src: 'agent', text: '6 filter tests added, 2 failing', effect: 'advance', date: '2026-11-24', via: { client: 'claude-code', tokenId: 't1' } });
    expect(log.state.handoffs.ho1!.state).toBe('doing');
    expect(log.state.work.w1!.via).toEqual({ client: 'claude-code', tokenId: 't1' });
  });
});

describe('stale handoff context', () => {
  it('records the fetched version; a later revision makes it stale until the recipient fetches again', () => {
    const log = handed();
    log.emit('handoff.responded', U.zhou, { handoffId: 'ho1', response: 'accepted' });
    expect(handoffStaleness(log.state, log.state.handoffs.ho1!)).toBeNull();
    log.emit('handoff.context_fetched', U.zhou, { handoffId: 'ho1', version: 1, client: 'claude-code' });
    rejects(() => log.emit('handoff.context_fetched', U.ben, { handoffId: 'ho1', version: 1, client: null }), 'NOT_AUTHORISED');
    rejects(() => log.emit('handoff.context_fetched', U.zhou, { handoffId: 'ho1', version: 5, client: null }), 'INVALID_EVENT');
    expect(handoffStaleness(log.state, log.state.handoffs.ho1!)).toBeNull();
    rejects(() => log.emit('handoff.refresh_requested', U.me, { handoffId: 'ho1' }), 'INVALID_STATE_TRANSITION');

    log.emit('need.revised', U.lin, { needId: 'n-filter', revisionId: 'rv', text: 'Add a “last 7 days” shortcut', why: 'Client email', date: '2026-11-22' });
    expect(needVersion(log.state.needs['n-filter']!)).toBe(2);
    expect(handoffStaleness(log.state, log.state.handoffs.ho1!)).toEqual({ fetched: 1, current: 2, reminded: false });

    rejects(() => log.emit('handoff.refresh_requested', U.zhou, { handoffId: 'ho1' }), 'NOT_AUTHORISED');
    log.emit('handoff.refresh_requested', U.me, { handoffId: 'ho1' });
    expect(handoffStaleness(log.state, log.state.handoffs.ho1!)).toEqual({ fetched: 1, current: 2, reminded: true });
    expect(refreshPending(log.state.handoffs.ho1!)).toBe(2);

    log.emit('handoff.context_fetched', U.zhou, { handoffId: 'ho1', version: 2, client: 'claude-code' });
    expect(handoffStaleness(log.state, log.state.handoffs.ho1!)).toBeNull();
    expect(refreshPending(log.state.handoffs.ho1!)).toBeNull();
  });
});
