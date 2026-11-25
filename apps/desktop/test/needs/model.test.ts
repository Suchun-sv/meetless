import { describe, expect, it } from 'vitest';
import { currentRound, daysLeft, needByCode, projectRounds, questions, roundFeedback, toConfirm } from '@meetless/core';
import {
  boardColumns,
  boardViewFor,
  cardFacts,
  childrenOf,
  drawerWork,
  EVIDENCE_SRC,
  lineageGroups,
  liveHandoffs,
  needArtifacts,
  pendingNeedIds,
  raisedBy,
  shownHandoff,
} from '../../src/renderer/needs/model';
import { Log } from '../support/log';
import { sample } from '../support/app';

const TODAY = '2026-11-24';

describe('boardColumns', () => {
  it('one column per round in order, external before hypotheses, refuted apart', () => {
    const { state } = sample('zh-CN');
    const cols = boardColumns(state, 'sample-paper', { kind: null, round: null }, TODAY);
    expect(cols.map((c) => c.round!.n)).toEqual(projectRounds(state, 'sample-paper').map((r) => r.n));
    for (const c of cols) {
      // No external need follows a hypothesis (findIndex's -1 for "no hyp here" would break a
      // length comparison, so walk the list instead).
      let sawHyp = false;
      for (const n of c.live) {
        if (n.kind === 'hyp') sawHyp = true;
        else expect(sawHyp).toBe(false);
      }
      expect(c.live.some((n) => n.status === 'refuted')).toBe(false);
    }
  });

  it('kind and round filters narrow the columns; only the current column has days left', () => {
    const { state } = sample('zh-CN');
    const P = 'sample-paper';
    expect(
      boardColumns(state, P, { kind: 'hyp', round: null }, TODAY)
        .flatMap((c) => c.live)
        .every((n) => n.kind === 'hyp'),
    ).toBe(true);
    expect(boardColumns(state, P, { kind: null, round: 3 }, TODAY).map((c) => c.round?.n)).toEqual([3]);
    const cols = boardColumns(state, P, { kind: null, round: null }, TODAY);
    const cur = currentRound(state, P)!;
    expect(cols.find((c) => c.round?.id === cur.id)!.daysLeft).toBe(daysLeft(cur, TODAY));
  });

  it('needs without a round go to a trailing Unscheduled column', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    log.emit('need.created', 'u-me', {
      needId: 'n1',
      projectId: 'p',
      kind: 'ext',
      title: 'Loose end',
      roundId: null,
      source: { src: 'chat', date: '2026-11-20', quote: 'q', ref: 'r' },
    });
    expect(boardColumns(log.state, 'p', { kind: null, round: null }, TODAY)).toEqual([
      expect.objectContaining({ round: null, live: [expect.objectContaining({ id: 'n1' })], refuted: [], daysLeft: null }),
    ]);

    const empty = new Log();
    empty.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    empty.emit('project.created', 'u-me', { projectId: 'p0', name: 'P0' });
    expect(boardColumns(empty.state, 'p0', { kind: null, round: null }, TODAY)).toEqual([]);
  });
});

describe('boardViewFor', () => {
  it('keeps the view state on its own project and starts from the defaults on another', () => {
    const v = { projectId: 'p-a', mode: 'lineage' as const, kind: 'hyp' as const, round: 3 };
    expect(boardViewFor(v, 'p-a')).toBe(v);
    expect(boardViewFor(v, 'p-b')).toEqual({ projectId: 'p-b', mode: 'rounds', kind: null, round: null });
    expect(boardViewFor(v, null)).toEqual({ projectId: null, mode: 'rounds', kind: null, round: null });
  });
});

describe('raisedBy', () => {
  it('the requester (member or outside name), else the creator; without the creator fallback, null', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    const src = { src: 'chat' as const, date: '2026-11-01', quote: 'q', ref: 'r' };
    log.emit('need.created', 'u-me', { needId: 'a', projectId: 'p', kind: 'ext', title: 'A', roundId: null, source: src, requester: { userId: 'u-me' } });
    log.emit('need.created', 'u-me', { needId: 'b', projectId: 'p', kind: 'ext', title: 'B', roundId: null, source: src, requester: { name: 'Client Co' } });
    log.emit('need.created', 'u-me', { needId: 'c', projectId: 'p', kind: 'ext', title: 'C', roundId: null, source: src });
    const n = log.state.needs;
    expect(raisedBy(n['a']!)).toEqual({ userId: 'u-me' });
    expect(raisedBy(n['b']!)).toEqual({ name: 'Client Co' });
    expect(raisedBy(n['c']!)).toEqual({ userId: 'u-me' });
    expect(raisedBy(n['c']!, false)).toBeNull();
    expect(raisedBy(n['b']!, false)).toEqual({ name: 'Client Co' });
  });
});

describe('cardFacts', () => {
  it('counts progress from exp, commit, doc, file and agent only; captures and ignored work do not count', () => {
    expect([...EVIDENCE_SRC].sort()).toEqual(['agent', 'commit', 'doc', 'exp', 'file']);
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    log.emit('round.created', 'u-me', { roundId: 'r1', projectId: 'p', title: 'R1', kind: 'cadence', start: '2026-11-01', due: '2026-12-01' });
    log.emit('need.created', 'u-me', {
      needId: 'n1',
      projectId: 'p',
      kind: 'ext',
      title: 'Ship it',
      roundId: 'r1',
      source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
    });
    log.emit('work.recorded', 'u-me', { workId: 'w1', projectId: 'p', needId: 'n1', src: 'commit', text: 'commit progress', date: '2026-11-02' });
    log.emit('work.recorded', 'u-me', {
      workId: 'w2',
      projectId: 'p',
      needId: 'n1',
      src: 'agent',
      text: 'agent report',
      date: '2026-11-03',
      via: { client: 'claude-code', tokenId: 't1' },
    });
    log.emit('work.recorded', 'u-me', { workId: 'w3', projectId: 'p', needId: 'n1', src: 'commit', text: 'capture', date: '2026-11-03', capture: true });
    log.emit('work.recorded', 'u-me', { workId: 'w4', projectId: 'p', needId: 'n1', src: 'commit', text: 'to be ignored', date: '2026-11-04' });
    log.emit('work.ignored', 'u-me', { workId: 'w4' });
    log.emit('work.recorded', 'u-me', { workId: 'w5', projectId: 'p', needId: 'n1', src: 'meeting', text: 'standup', date: '2026-11-05' });

    const need = log.state.needs.n1!;
    expect(cardFacts(log.state, need, 'u-me', new Set()).evidence).toBe(2);
  });

  it('requester is self when I raised it, else the member or outside name', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('user.registered', 'system', { userId: 'u-lin', displayName: 'Lin', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    log.emit('project.member_added', 'u-me', { projectId: 'p', userId: 'u-lin' });
    log.emit('round.created', 'u-me', { roundId: 'r1', projectId: 'p', title: 'R1', kind: 'cadence', start: '2026-11-01', due: '2026-12-01' });
    log.emit('need.created', 'u-me', {
      needId: 'n-self',
      projectId: 'p',
      kind: 'ext',
      title: 'Mine',
      roundId: 'r1',
      requester: { userId: 'u-me' },
      source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
    });
    log.emit('need.created', 'u-lin', {
      needId: 'n-by-lin',
      projectId: 'p',
      kind: 'ext',
      title: 'Lin raised it, no explicit requester',
      roundId: 'r1',
      source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
    });
    log.emit('need.created', 'u-me', {
      needId: 'n-outside',
      projectId: 'p',
      kind: 'ext',
      title: 'Client ask',
      roundId: 'r1',
      requester: { name: 'Client Co' },
      source: { src: 'mail', date: '2026-11-01', quote: 'q', ref: 'r' },
    });

    const { state } = log;
    expect(cardFacts(state, state.needs['n-self']!, 'u-me', new Set()).requester).toEqual({ self: true });
    expect(cardFacts(state, state.needs['n-by-lin']!, 'u-me', new Set()).requester).toEqual({ self: false, name: 'Lin' });
    expect(cardFacts(state, state.needs['n-outside']!, 'u-me', new Set()).requester).toEqual({ self: false, name: 'Client Co' });
  });
});

describe('shownHandoff', () => {
  it('skips a declined handoff; a resolved conflict decision handoff is shown done', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('user.registered', 'system', { userId: 'u-lin', displayName: 'Lin', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    log.emit('project.member_added', 'u-me', { projectId: 'p', userId: 'u-lin' });
    log.emit('need.created', 'u-me', {
      needId: 'n-x',
      projectId: 'p',
      kind: 'ext',
      title: 'Field scope',
      roundId: null,
      accept: 'v1 fields',
      source: { src: 'meeting', date: '2026-11-01', quote: 'orig', ref: 'kickoff' },
    });
    log.emit('need.created', 'u-me', {
      needId: 'n-y',
      projectId: 'p',
      kind: 'ext',
      title: 'Other',
      roundId: null,
      source: { src: 'meeting', date: '2026-11-01', quote: 'orig', ref: 'kickoff' },
    });

    // A plain handoff, declined outright: never shown (handoffForNeed already excludes it).
    log.emit('handoff.created', 'u-me', { handoffId: 'h-declined', projectId: 'p', needId: 'n-y', toId: 'u-lin', ask: 'take this', due: null });
    log.emit('handoff.responded', 'u-lin', { handoffId: 'h-declined', response: 'declined' });

    // A new document conflicts with n-x; the importer hands the decision to Lin, who resolves the
    // conflict directly. Since the final fix wave (contract 12.11 I1), that also closes the
    // delegating handoff as done, so it is shown (done), not hidden.
    log.emit('input.imported', 'u-me', {
      inputId: 'in1',
      projectId: 'p',
      kind: 'pdf',
      title: 'New spec',
      date: '2026-11-05',
      body: [{ id: 'p1', text: 'All fields now.' }],
      extracts: [{ id: 'x1', type: 'rev', text: 'All fields', paraId: 'p1', needId: 'n-x', conflict: true }],
      detector: 'rules/1',
    });
    const conflictId = Object.keys(log.state.conflicts)[0]!;
    log.emit('conflict.resolved', 'u-me', { conflictId, resolution: 'handoff', handoffId: 'h-conflict', toId: 'u-lin', ask: 'your call', due: null });
    log.emit('conflict.resolved', 'u-lin', { conflictId, resolution: 'revise' });

    expect(log.state.handoffs['h-conflict']!.state).toBe('done');
    expect(log.state.conflicts[conflictId]!.status).toBe('resolved');
    expect(shownHandoff(log.state, 'n-x')).toEqual(expect.objectContaining({ id: 'h-conflict', state: 'done' }));
    expect(shownHandoff(log.state, 'n-y')).toBeNull();
  });
});

describe('liveHandoffs', () => {
  it('every non-terminal handoff on the need, newest first; done and declined are left out', () => {
    const log = new Log();
    for (const [id, name] of [
      ['u-me', 'Me'],
      ['u-lin', 'Lin'],
      ['u-zhou', 'Zhou'],
    ] as const)
      log.emit('user.registered', 'system', { userId: id, displayName: name, locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    log.emit('project.member_added', 'u-me', { projectId: 'p', userId: 'u-lin' });
    log.emit('project.member_added', 'u-me', { projectId: 'p', userId: 'u-zhou' });
    log.emit('need.created', 'u-me', { needId: 'n1', projectId: 'p', kind: 'ext', title: 'T', roundId: null, source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' } });
    log.emit('need.created', 'u-me', { needId: 'n2', projectId: 'p', kind: 'ext', title: 'U', roundId: null, source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' } });

    log.emit('handoff.created', 'u-me', { handoffId: 'h-done', projectId: 'p', needId: 'n1', toId: 'u-lin', ask: 'a', due: null });
    log.emit('handoff.responded', 'u-lin', { handoffId: 'h-done', response: 'accepted' });
    log.emit('handoff.returned', 'u-lin', { handoffId: 'h-done' });
    log.emit('handoff.confirmed', 'u-me', { handoffId: 'h-done' });
    log.emit('handoff.created', 'u-me', { handoffId: 'h-doing', projectId: 'p', needId: 'n1', toId: 'u-zhou', ask: 'b', due: null });
    log.emit('handoff.responded', 'u-zhou', { handoffId: 'h-doing', response: 'accepted' });
    log.emit('handoff.started', 'u-zhou', { handoffId: 'h-doing' });
    log.emit('handoff.created', 'u-me', { handoffId: 'h-declined', projectId: 'p', needId: 'n1', toId: 'u-lin', ask: 'c', due: null });
    log.emit('handoff.responded', 'u-lin', { handoffId: 'h-declined', response: 'declined' });
    log.emit('handoff.created', 'u-me', { handoffId: 'h-sent', projectId: 'p', needId: 'n1', toId: 'u-lin', ask: 'd', due: null });

    expect(log.state.handoffs['h-done']!.state).toBe('done');
    expect(liveHandoffs(log.state, 'n1').map((h) => h.id)).toEqual(['h-sent', 'h-doing']);
    // The card still shows only the latest one.
    expect(shownHandoff(log.state, 'n1')!.id).toBe('h-sent');
    expect(liveHandoffs(log.state, 'n2')).toEqual([]);
  });
});

describe('pendingNeedIds', () => {
  it('Atlas N1 (open conflict Alex decides) is pending; a shared, idle, soon-due need is a real stale question', () => {
    const { state } = sample('zh-CN');
    const atlasPending = pendingNeedIds(toConfirm(state, 'u-alex', 'sample-atlas', TODAY));
    expect(atlasPending.has(needByCode(state, 'sample-atlas', 'N1')!.id)).toBe(true);
    // Contract 12.22 I2: the sample gives nobody a stale question (paper H5 is parked, not stale).
    expect(questions(state, 'u-alex', 'sample-paper', TODAY).some((q) => q.kind === 'stale')).toBe(false);

    // A shared, not-started need, idle well past STALE_IDLE_DAYS while its round is due within
    // STALE_DUE_DAYS, is really asked about (contract 12.11).
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    log.emit('round.created', 'u-me', { roundId: 'r1', projectId: 'p', title: 'R1', kind: 'cadence', start: '2026-11-01', due: '2026-11-30' });
    log.emit('need.created', 'u-me', {
      needId: 'n-stale',
      projectId: 'p',
      kind: 'ext',
      title: 'Needs attention',
      roundId: 'r1',
      source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
    });
    const tc = toConfirm(log.state, 'u-me', 'p', TODAY);
    expect(tc.questions).toEqual([expect.objectContaining({ kind: 'stale', needId: 'n-stale' })]);
    expect(pendingNeedIds(tc).has('n-stale')).toBe(true);
  });
});

describe('lineageGroups', () => {
  it('direct roots first, then delivered rounds with their feedback quotes; private needs never appear', () => {
    const { state } = sample('zh-CN');
    const g = lineageGroups(state, 'sample-paper');
    expect(g[0]!.round).toBeNull();
    expect(g.flatMap((x) => x.roots).some((n) => n.code === 'Hp1')).toBe(false);
    expect(g.slice(1).every((x) => x.quotes.length === roundFeedback(state, x.round!.id).length)).toBe(true);
  });
});

describe('childrenOf', () => {
  it('a private child is never listed under a shared parent, but shows under a private one', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    log.emit('need.created', 'u-me', {
      needId: 'shared-parent',
      projectId: 'p',
      kind: 'ext',
      title: 'Shared',
      roundId: null,
      source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
    });
    log.emit('need.created', 'u-me', {
      needId: 'shared-child',
      projectId: 'p',
      kind: 'ext',
      title: 'Shared child',
      roundId: null,
      parentId: 'shared-parent',
      source: { src: 'chat', date: '2026-11-02', quote: 'q', ref: 'r' },
    });
    log.emit('need.created', 'u-me', {
      needId: 'private-child',
      projectId: 'p',
      kind: 'hyp',
      title: 'Private child',
      roundId: null,
      parentId: 'shared-parent',
      private: true,
      source: { src: 'chat', date: '2026-11-03', quote: 'q', ref: 'r' },
    });
    log.emit('need.created', 'u-me', {
      needId: 'private-parent',
      projectId: 'p',
      kind: 'hyp',
      title: 'Private parent',
      roundId: null,
      private: true,
      source: { src: 'chat', date: '2026-11-04', quote: 'q', ref: 'r' },
    });
    log.emit('need.created', 'u-me', {
      needId: 'private-grandchild',
      projectId: 'p',
      kind: 'hyp',
      title: 'Private grandchild',
      roundId: null,
      parentId: 'private-parent',
      private: true,
      source: { src: 'chat', date: '2026-11-05', quote: 'q', ref: 'r' },
    });

    expect(childrenOf(log.state, 'shared-parent').map((n) => n.id)).toEqual(['shared-child']);
    expect(childrenOf(log.state, 'private-parent').map((n) => n.id)).toEqual(['private-grandchild']);
  });
});

describe('drawerWork', () => {
  it('is newest first and omits ignored work; captures stay', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    log.emit('need.created', 'u-me', {
      needId: 'n1',
      projectId: 'p',
      kind: 'ext',
      title: 'N',
      roundId: null,
      source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
    });
    log.emit('work.recorded', 'u-me', { workId: 'w1', projectId: 'p', needId: 'n1', src: 'commit', text: 'first', date: '2026-11-01' });
    log.emit('work.recorded', 'u-me', { workId: 'w2', projectId: 'p', needId: 'n1', src: 'exp', text: 'second', date: '2026-11-02' });
    log.emit('work.recorded', 'u-me', { workId: 'w3', projectId: 'p', needId: 'n1', src: 'commit', text: 'drop me', date: '2026-11-03' });
    log.emit('work.ignored', 'u-me', { workId: 'w3' });
    log.emit('work.recorded', 'u-me', { workId: 'w4', projectId: 'p', needId: 'n1', src: 'file', text: 'a capture', date: '2026-11-04', capture: true });

    expect(drawerWork(log.state, 'n1').map((w) => w.id)).toEqual(['w4', 'w2', 'w1']);
  });
});

describe('needArtifacts', () => {
  it('returns the artifacts linked to a need, oldest first', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    log.emit('need.created', 'u-me', {
      needId: 'n1',
      projectId: 'p',
      kind: 'ext',
      title: 'N',
      roundId: null,
      source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
    });
    log.emit('need.created', 'u-me', {
      needId: 'n2',
      projectId: 'p',
      kind: 'ext',
      title: 'N2',
      roundId: null,
      source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
    });
    log.emit('artifact.created', 'u-me', { artifactId: 'a1', projectId: 'p', kind: 'code', title: 'Repo', where: 'GitHub', needIds: ['n1'] });
    log.emit('artifact.created', 'u-me', { artifactId: 'a2', projectId: 'p', kind: 'docx', title: 'Doc', where: 'Word', needIds: ['n2'] });
    log.emit('artifact.created', 'u-me', { artifactId: 'a3', projectId: 'p', kind: 'pdf', title: 'Other', where: 'Overleaf', needIds: ['n1', 'n2'] });

    expect(needArtifacts(log.state, 'n1').map((a) => a.id)).toEqual(['a1', 'a3']);
  });
});
