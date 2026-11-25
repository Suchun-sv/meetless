import { describe, expect, it } from 'vitest';
import {
  DETECTOR_ID,
  STALE_DUE_DAYS,
  STALE_IDLE_DAYS,
  detectExtracts,
  openConflicts,
  pendingExtractsFor,
  projectBadges,
  questionId,
  questions,
  toConfirm,
  toParagraphs,
  waitingCount,
} from '../src/index';
import { atlas, P, R, U } from './log';

const today = '2026-11-24';

const doc = [
  '# Client requirements v2',
  'Exports must include all customer fields.',
  'Excel export would be welcome, please support it.',
  'We suspect the date index might keep filtering under 30 s.',
  'N2 should also offer a “last 7 days” shortcut.',
].join('\n');

type Log = ReturnType<typeof atlas>;

function importDoc(log: Log, opts: { actor?: string; id?: string; private?: boolean } = {}) {
  const actor = opts.actor ?? U.me;
  const body = toParagraphs(doc);
  const visibleNeeds = Object.values(log.state.needs).filter((n) => n.privateTo === null || n.privateTo === actor);
  log.emit('input.imported', actor, {
    inputId: opts.id ?? 'in-1',
    projectId: P,
    kind: 'pdf',
    title: 'Client requirements v2.pdf',
    from: { name: 'Mr Wang (Client A)' },
    date: '2026-11-23',
    body,
    extracts: detectExtracts(body, visibleNeeds),
    detector: DETECTOR_ID,
    private: opts.private,
  });
}

/** A need of mine in round 1 (due 11-28), last touched 11-14: idle 10 days, 4 days left. */
function staleNeed(log: Log, needId = 'n-x', date = '2026-11-14') {
  log.emit('need.created', U.me, {
    needId,
    projectId: P,
    kind: 'ext',
    title: 'Audit log for exports',
    roundId: R.r1,
    source: { src: 'meeting', date, quote: 'We need an audit log.', ref: 'notes' },
  });
}

function full() {
  const log = atlas();
  // Settle the atlas needs so that only what this test adds is pending.
  log.emit('need.status_set', U.ben, { needId: 'h-cache', status: 'testing' });
  log.emit('need.status_set', U.zhou, { needId: 'n-filter', status: 'doing' });
  importDoc(log);
  log.emit('need.status_set', U.me, { needId: 'n-export', status: 'doing' });
  log.emit('work.recorded', U.me, { workId: 'w-free', projectId: P, src: 'commit', text: 'e41b retry on timeout', date: '2026-11-23' });
  log.emit('proposal.created', U.zhou, { proposalId: 'pr1', projectId: P, kind: 'hyp', title: 'A date index keeps filtering fast', via: { client: 'codex', tokenId: 't' } });
  staleNeed(log);
  return log;
}

describe('To confirm', () => {
  it('lists my pending extracts, conflicts I decide or own, open proposals and my questions, and counts them', () => {
    const s = full().state;
    const tc = toConfirm(s, U.me, P, today);
    expect(tc.conflicts.map((c) => c.needId)).toEqual(['n-export']);
    expect(tc.proposals.map((p) => p.id)).toEqual(['pr1']);
    // The conflict-flagged extract is a conflict, not an extract.
    const conflictExtract = tc.conflicts[0]!.extractId;
    expect(tc.extracts).toHaveLength(3);
    expect(tc.extracts.every((x) => x.projectId === P && x.inputId === 'in-1' && x.extractId !== conflictExtract)).toBe(true);
    expect(tc.questions.map(questionId)).toEqual(['unlinked:w-free', 'stale:n-x']);
    expect(tc.count).toBe(tc.conflicts.length + tc.proposals.length + tc.extracts.length + tc.questions.length);
    expect(tc.count).toBe(7);
    // null = all projects
    expect(toConfirm(s, U.me, null, today).count).toBe(7);

    // Ben imported nothing and decides nothing; he still sees the open proposal.
    const ben = toConfirm(s, U.ben, P, today);
    expect(ben).toMatchObject({ conflicts: [], extracts: [], questions: [], count: 1 });
  });

  it('the owner of the conflicting need sees the open conflict; once delegated only the new decider does', () => {
    const log = full();
    log.emit('need.updated', U.me, { needId: 'n-export', ownerId: U.ben });
    expect(toConfirm(log.state, U.ben, P, today).conflicts.map((c) => c.needId)).toEqual(['n-export']);
    const c = openConflicts(log.state, P)[0]!;
    log.emit('conflict.resolved', U.me, { conflictId: c.id, resolution: 'handoff', handoffId: 'ho-c', toId: U.lin, ask: 'Your call.', due: null });
    expect(toConfirm(log.state, U.ben, P, today).conflicts).toEqual([]);
    expect(toConfirm(log.state, U.me, P, today).conflicts).toEqual([]);
    expect(toConfirm(log.state, U.lin, P, today).conflicts.map((x) => x.id)).toEqual([c.id]);
  });

  it('pending extracts: only inputs I imported; conflict-flagged extracts of a private input stay extracts', () => {
    const log = atlas();
    importDoc(log, { actor: U.ben, id: 'in-ben', private: true });
    const xs = log.state.inputs['in-ben']!.extracts;
    expect(xs.some((x) => x.conflict)).toBe(true);
    expect(pendingExtractsFor(log.state, U.ben, P)).toEqual(xs.map((x) => ({ projectId: P, inputId: 'in-ben', extractId: x.id })));
    expect(pendingExtractsFor(log.state, U.me, P)).toEqual([]);
    log.emit('extract.ignored', U.ben, { inputId: 'in-ben', extractId: xs[0]!.id });
    expect(pendingExtractsFor(log.state, U.ben, null)).toHaveLength(xs.length - 1);
  });
});

describe('questions the system cannot settle', () => {
  it('an unlinked work item asks the person who recorded it, nobody else', () => {
    const log = atlas();
    log.emit('work.recorded', U.me, { workId: 'w-free', projectId: P, src: 'commit', text: 'e41b retry on timeout', date: '2026-11-23' });
    log.emit('work.recorded', U.me, { workId: 'w-linked', projectId: P, needId: 'n-export', src: 'commit', text: 'a1 export', date: '2026-11-23' });
    const unlinked = (u: string) => questions(log.state, u, P, today).filter((q) => q.kind === 'unlinked');
    expect(unlinked(U.me)).toEqual([{ kind: 'unlinked', projectId: P, workId: 'w-free' }]);
    expect(questionId(unlinked(U.me)[0]!)).toBe('unlinked:w-free');
    expect(unlinked(U.lin)).toEqual([]);
    log.emit('work.linked', U.lin, { workId: 'w-free', needId: 'n-filter' });
    expect(unlinked(U.me)).toEqual([]);

    log.emit('work.recorded', U.me, { workId: 'w-noise', projectId: P, src: 'commit', text: 'wip', date: '2026-11-23' });
    expect(unlinked(U.me).map((q) => (q.kind === 'unlinked' ? q.workId : ''))).toEqual(['w-noise']);
    log.emit('work.ignored', U.me, { workId: 'w-noise' });
    expect(unlinked(U.me)).toEqual([]);
  });

  it('a need of mine idle 10+ days in a round due within 7 days is a stale question; moving it to the next round removes it', () => {
    expect([STALE_IDLE_DAYS, STALE_DUE_DAYS]).toEqual([10, 7]);
    const log = atlas();
    staleNeed(log);
    staleNeed(log, 'n-fresh', '2026-11-15');
    const s = log.state;
    expect(questions(s, U.me, P, '2026-11-24')).toContainEqual(expect.objectContaining({ kind: 'stale', needId: 'n-x' }));
    expect(questions(s, U.me, P, today).find((q) => q.kind === 'stale' && q.needId === 'n-x')).toEqual({ kind: 'stale', projectId: P, needId: 'n-x', idleDays: 10, daysLeft: 4 });
    expect(questionId({ kind: 'stale', projectId: P, needId: 'n-x', idleDays: 10, daysLeft: 4 })).toBe('stale:n-x');
    // Idle 9 days: not yet.
    expect(questions(s, U.me, P, today).some((q) => q.kind === 'stale' && q.needId === 'n-fresh')).toBe(false);
    // Only the owner (or, without one, the creator) is asked.
    expect(questions(s, U.ben, P, today).some((q) => q.kind === 'stale' && q.needId === 'n-x')).toBe(false);
    // Overdue rounds are not asked about.
    expect(questions(s, U.me, P, '2026-11-29').some((q) => q.kind === 'stale' && q.needId === 'n-x')).toBe(false);

    // An owner takes over from the creator.
    log.emit('need.updated', U.me, { needId: 'n-x', ownerId: U.ben });
    expect(questions(log.state, U.ben, P, today).some((q) => q.kind === 'stale' && q.needId === 'n-x')).toBe(true);
    expect(questions(log.state, U.me, P, today).some((q) => q.kind === 'stale' && q.needId === 'n-x')).toBe(false);

    log.emit('need.updated', U.me, { needId: 'n-x', roundId: R.r2 });
    expect(questions(log.state, U.ben, P, today).some((q) => q.kind === 'stale' && q.needId === 'n-x')).toBe(false);
  });

  it('the due window is 7 days and the idle clock restarts with progress, not with captures or ignored work', () => {
    const log = atlas();
    staleNeed(log);
    const stale = () => questions(log.state, U.me, P, today).some((q) => q.kind === 'stale' && q.needId === 'n-x');
    log.emit('round.updated', U.me, { roundId: R.r1, due: '2026-12-02' });
    expect(stale()).toBe(false);
    log.emit('round.updated', U.me, { roundId: R.r1, due: '2026-12-01' });
    expect(stale()).toBe(true);
    log.emit('work.recorded', U.me, { workId: 'w-cap', projectId: P, needId: 'n-x', src: 'commit', text: 'captured', date: '2026-11-22', capture: true });
    log.emit('work.recorded', U.me, { workId: 'w-ign', projectId: P, needId: 'n-x', src: 'commit', text: 'noise', date: '2026-11-22' });
    log.emit('work.ignored', U.me, { workId: 'w-ign' });
    expect(stale()).toBe(true);
    log.emit('work.recorded', U.ben, { workId: 'w-real', projectId: P, needId: 'n-x', src: 'commit', text: 'audit table', date: '2026-11-20' });
    expect(stale()).toBe(false);
  });

  it('a need with an open handoff or status doing is never stale', () => {
    const log = atlas();
    staleNeed(log);
    const stale = () => questions(log.state, U.me, P, today).some((q) => q.kind === 'stale' && q.needId === 'n-x');
    expect(stale()).toBe(true);
    log.emit('handoff.created', U.me, { handoffId: 'ho-x', projectId: P, needId: 'n-x', toId: U.ben, ask: 'Take the audit log', due: null });
    expect(stale()).toBe(false);
    log.emit('handoff.responded', U.ben, { handoffId: 'ho-x', response: 'declined' });
    expect(stale()).toBe(true);
    log.emit('need.status_set', U.me, { needId: 'n-x', status: 'doing' });
    expect(stale()).toBe(false);
  });

  it('a conflict-decision handoff holds the need only until the conflict is resolved', () => {
    const log = atlas();
    importDoc(log);
    const stale = () => questions(log.state, U.me, P, today).some((q) => q.kind === 'stale' && q.needId === 'n-export');
    expect(stale()).toBe(true);
    const c = openConflicts(log.state, P)[0]!;
    log.emit('conflict.resolved', U.me, { conflictId: c.id, resolution: 'handoff', handoffId: 'ho-c', toId: U.lin, ask: 'Your call.', due: null });
    expect(stale()).toBe(false);
    log.emit('conflict.resolved', U.lin, { conflictId: c.id, resolution: 'park', needId: 'n-all', roundId: R.r2 });
    // The delegate's decision closes the handoff (I1), so it no longer holds the need either way.
    expect(log.state.handoffs['ho-c']!.state).toBe('done');
    expect(stale()).toBe(true);
  });

  it('setting a stale need aside clears its question: a hypothesis is parked, an external need dropped (I2)', () => {
    const log = atlas();
    staleNeed(log);
    log.emit('need.created', U.me, {
      needId: 'h-x',
      projectId: P,
      kind: 'hyp',
      title: 'An index keeps export fast',
      roundId: R.r1,
      expect: 'Under 30 s',
      verify: 'Load test',
      source: { src: 'meeting', date: '2026-11-14', quote: '', ref: '' },
    });
    const stale = (id: string) => questions(log.state, U.me, P, today).some((q) => q.kind === 'stale' && q.needId === id);
    expect([stale('n-x'), stale('h-x')]).toEqual([true, true]);
    log.emit('need.status_set', U.me, { needId: 'h-x', status: 'parked' });
    expect(stale('h-x')).toBe(false);
    // `parked` is not a status of an external need; `dropped` sets it aside.
    expect(() => log.emit('need.status_set', U.me, { needId: 'n-x', status: 'parked' })).toThrow(expect.objectContaining({ code: 'INVALID_STATUS' }));
    log.emit('need.status_set', U.me, { needId: 'n-x', status: 'dropped' });
    expect(stale('n-x')).toBe(false);
  });

  it('private needs are never asked about', () => {
    const log = atlas();
    log.emit('need.created', U.me, {
      needId: 'h-priv',
      projectId: P,
      kind: 'hyp',
      title: 'Private idea',
      roundId: R.r1,
      expect: 'x',
      verify: 'y',
      private: true,
      source: { src: 'meeting', date: '2026-11-01', quote: '', ref: '' },
    });
    expect(questions(log.state, U.me, P, today).some((q) => q.kind === 'stale' && q.needId === 'h-priv')).toBe(false);
  });
});

describe('sidebar badges', () => {
  it('badges: board = handed to me + To confirm; total = board; inputs = pending inputs', () => {
    const log = full();
    log.emit('handoff.created', U.lin, { handoffId: 'ho-lin', projectId: P, needId: 'n-filter', toId: U.me, ask: 'Review the filter', due: null });
    const s = log.state;
    const tc = toConfirm(s, U.me, P, today);
    expect(projectBadges(s, U.me, P, today)).toEqual({ inputs: 1, board: 1 + tc.count, total: 1 + tc.count });
    log.emit('handoff.responded', U.me, { handoffId: 'ho-lin', response: 'accepted' });
    expect(projectBadges(log.state, U.me, P, today)).toEqual({ inputs: 1, board: tc.count, total: tc.count });
  });

  it('a conflict handed to me for a decision counts once, not as a handoff and a conflict', () => {
    const log = atlas();
    importDoc(log);
    const c = openConflicts(log.state, P)[0]!;
    log.emit('conflict.resolved', U.me, { conflictId: c.id, resolution: 'handoff', handoffId: 'ho-c', toId: U.lin, ask: 'Your call.', due: null });
    expect(toConfirm(log.state, U.lin, P, today).count).toBe(1);
    expect(projectBadges(log.state, U.lin, P, today)).toEqual({ inputs: 1, board: 1, total: 1 });
    expect(waitingCount(log.state, U.lin, today)).toBe(1);
  });
});
