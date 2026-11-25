import { describe, expect, it } from 'vitest';
import { currentOrLatestRound, needByCode, needVersion, nextRound, questions, toConfirm } from '@meetless/core';
import {
  confirmItems,
  conflictCommand,
  extractCommand,
  ignoreWorkCommand,
  linkCommand,
  linkTargets,
  newHypCommands,
  proposalCommand,
  staleCommands,
  staleOptions,
  unlinkedSuggestion,
  waitingConflicts,
  type ConfirmItem,
} from '../../src/renderer/collab/confirm';
import { Log } from '../support/log';
import { sample } from '../support/app';

const TODAY = '2026-11-24';

/** A shared external need, idle well past STALE_IDLE_DAYS, in a round due within STALE_DUE_DAYS. */
function staleFixture(): Log {
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
  return log;
}

/** Two members, one need in conflict with a freshly imported document. */
function conflictFixture(): { log: Log; conflictId: string } {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale: 'en' });
  log.emit('user.registered', 'system', { userId: 'u-lin', displayName: 'Lin', locale: 'en' });
  log.emit('project.created', 'u-alex', { projectId: 'P', name: 'P' });
  log.emit('project.member_added', 'u-alex', { projectId: 'P', userId: 'u-lin' });
  log.emit('need.created', 'u-alex', {
    needId: 'n1',
    projectId: 'P',
    kind: 'ext',
    title: 'Field scope',
    roundId: null,
    accept: 'v1 fields',
    source: { src: 'meeting', date: '2026-11-01', quote: 'orig', ref: 'kickoff' },
  });
  log.emit('input.imported', 'u-alex', {
    inputId: 'in1',
    projectId: 'P',
    kind: 'pdf',
    title: 'New spec',
    date: '2026-11-05',
    body: [{ id: 'p1', text: 'All fields now.' }],
    extracts: [{ id: 'x1', type: 'rev', text: 'All fields', paraId: 'p1', needId: 'n1', conflict: true }],
    detector: 'rules/1',
  });
  const conflictId = Object.keys(log.state.conflicts)[0]!;
  return { log, conflictId };
}

describe('confirmItems', () => {
  it('Atlas for Alex: the N1 conflict comes first; ids and count follow the contract', () => {
    const { state } = sample('zh-CN');
    const items = confirmItems(state, 'u-alex', 'sample-atlas', TODAY);
    const n1 = needByCode(state, 'sample-atlas', 'N1')!;
    expect(items[0]).toMatchObject({ kind: 'conflict', delegatedBy: null });
    expect((items[0] as ConfirmItem & { kind: 'conflict' }).conflict.needId).toBe(n1.id);
    expect(items[0]!.id).toBe((items[0] as ConfirmItem & { kind: 'conflict' }).conflict.id);
    expect(items.length).toBe(toConfirm(state, 'u-alex', 'sample-atlas', TODAY).count);
  });

  it('paper for Alex: exactly one question, the unlinked commit (the sample has no stale question)', () => {
    const { state } = sample('zh-CN');
    const items = confirmItems(state, 'u-alex', 'sample-paper', TODAY);
    const qs = items.filter((i) => i.kind === 'question').map((i) => (i as ConfirmItem & { kind: 'question' }).question.kind);
    expect(qs).toEqual(['unlinked']);
  });

  it('a stale question built with a Log fixture appears as a question item', () => {
    const log = staleFixture();
    const items = confirmItems(log.state, 'u-me', 'p', TODAY);
    expect(items).toEqual([expect.objectContaining({ kind: 'question', question: expect.objectContaining({ kind: 'stale', needId: 'n-stale' }) })]);
  });

  it('a parked hypothesis yields no stale question from confirmItems', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    log.emit('round.created', 'u-me', { roundId: 'r1', projectId: 'p', title: 'R1', kind: 'cadence', start: '2026-11-01', due: '2026-11-30' });
    log.emit('need.created', 'u-me', {
      needId: 'h-parked',
      projectId: 'p',
      kind: 'hyp',
      title: 'Parked hypothesis',
      roundId: 'r1',
      source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
    });
    log.emit('need.status_set', 'u-me', { needId: 'h-parked', status: 'parked' });
    expect(confirmItems(log.state, 'u-me', 'p', TODAY).filter((i) => i.kind === 'question')).toEqual([]);
  });

  it('a delegated conflict moves to the new decider', () => {
    const { log, conflictId } = conflictFixture();
    const c = log.state.conflicts[conflictId]!;
    const cmd = conflictCommand(c, { kind: 'handoff', handoffId: 'h1', toId: 'u-lin', ask: 'your call', due: null });
    log.emit(cmd.type, 'u-alex', cmd.payload);

    const after = log.state;
    expect(confirmItems(after, 'u-alex', 'P', TODAY).some((i) => i.kind === 'conflict')).toBe(false);
    expect(waitingConflicts(after, 'u-alex', 'P')).toEqual([expect.objectContaining({ deciderId: 'u-lin' })]);
    expect(confirmItems(after, 'u-lin', 'P', TODAY)[0]).toMatchObject({ kind: 'conflict', delegatedBy: 'u-alex' });
  });
});

describe('conflictCommand', () => {
  it('revise resolves the conflict through core: the need gains a new revision', () => {
    const { log, conflictId } = conflictFixture();
    const c = log.state.conflicts[conflictId]!;
    const before = needVersion(log.state.needs.n1!);
    const cmd = conflictCommand(c, { kind: 'revise' });
    log.emit(cmd.type, 'u-alex', cmd.payload);
    expect(needVersion(log.state.needs.n1!)).toBe(before + 1);
    expect(log.state.needs.n1!.accept).toBe('All fields now.');
    expect(log.state.conflicts[conflictId]!.status).toBe('resolved');
  });

  it('park with roundId null creates a new N need with status moved', () => {
    const { log, conflictId } = conflictFixture();
    const c = log.state.conflicts[conflictId]!;
    const cmd = conflictCommand(c, { kind: 'park', needId: 'n-parked', roundId: null });
    log.emit(cmd.type, 'u-alex', cmd.payload);
    const parked = log.state.needs['n-parked']!;
    expect(parked.kind).toBe('ext');
    expect(parked.status).toBe('moved');
    expect(parked.roundId).toBeNull();
    expect(log.state.conflicts[conflictId]!.resolution).toEqual(expect.objectContaining({ kind: 'park', needId: 'n-parked' }));
  });

  it("a delegate's conflict.resolved closes the delegating handoff as done", () => {
    const { log, conflictId } = conflictFixture();
    const c = log.state.conflicts[conflictId]!;
    const handoffCmd = conflictCommand(c, { kind: 'handoff', handoffId: 'h1', toId: 'u-lin', ask: 'your call', due: null });
    log.emit(handoffCmd.type, 'u-alex', handoffCmd.payload);
    const delegated = log.state.conflicts[conflictId]!;
    const reviseCmd = conflictCommand(delegated, { kind: 'revise' });
    log.emit(reviseCmd.type, 'u-lin', reviseCmd.payload);
    expect(log.state.handoffs.h1!.state).toBe('done');
    expect(log.state.conflicts[conflictId]!.status).toBe('resolved');
  });
});

describe('staleOptions / staleCommands', () => {
  it('staleOptions differ by kind', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    log.emit('round.created', 'u-me', { roundId: 'r1', projectId: 'p', title: 'R1', kind: 'cadence', start: '2026-11-01', due: '2026-11-30' });
    log.emit('round.created', 'u-me', { roundId: 'r2', projectId: 'p', title: 'R2', kind: 'cadence', start: '2026-12-01', due: '2026-12-31' });
    log.emit('need.created', 'u-me', {
      needId: 'ext1',
      projectId: 'p',
      kind: 'ext',
      title: 'Ext',
      roundId: 'r1',
      source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
    });
    log.emit('need.created', 'u-me', {
      needId: 'hyp1',
      projectId: 'p',
      kind: 'hyp',
      title: 'Hyp',
      roundId: 'r1',
      source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
    });
    const next = nextRound(log.state, 'p');
    expect(next?.id).toBe('r2');
    const ext = log.state.needs.ext1!;
    const hyp = log.state.needs.hyp1!;
    expect(staleOptions(ext, next)).toEqual(['drop', 'next']);
    expect(staleOptions(hyp, next)).toEqual(['park', 'next']);
    expect(staleOptions(ext, null)).toEqual(['drop']);
  });

  it('applying the stale "drop" option removes the question', () => {
    const log = staleFixture();
    const need = log.state.needs['n-stale']!;
    const next = nextRound(log.state, 'p');
    expect(next).toBeNull();
    expect(staleOptions(need, next)).toEqual(['drop']);
    const cmds = staleCommands('drop', need, next);
    expect(cmds).toEqual([{ type: 'need.status_set', payload: { needId: 'n-stale', status: 'dropped' } }]);
    for (const cmd of cmds) log.emit(cmd.type, 'u-me', cmd.payload);
    expect(questions(log.state, 'u-me', 'p', TODAY).some((q) => q.kind === 'stale')).toBe(false);
    expect(log.state.needs['n-stale']!.status).toBe('dropped');
  });

  it('applying the stale "next" option moves the need to the next round without resetting status', () => {
    const log = staleFixture();
    log.emit('round.created', 'u-me', { roundId: 'r2', projectId: 'p', title: 'R2', kind: 'cadence', start: '2026-12-01', due: '2026-12-31' });
    const need = log.state.needs['n-stale']!;
    const next = nextRound(log.state, 'p')!;
    expect(next.id).toBe('r2');
    const cmds = staleCommands('next', need, next);
    expect(cmds).toEqual([{ type: 'need.updated', payload: { needId: 'n-stale', roundId: 'r2' } }]);
    for (const cmd of cmds) log.emit(cmd.type, 'u-me', cmd.payload);
    expect(log.state.needs['n-stale']!.roundId).toBe('r2');
    expect(log.state.needs['n-stale']!.status).toBe('todo');
    expect(questions(log.state, 'u-me', 'p', TODAY).some((q) => q.kind === 'stale')).toBe(false);
  });
});

describe('unlinked work', () => {
  function fixture(): Log {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    log.emit('round.created', 'u-me', { roundId: 'r1', projectId: 'p', title: 'R1', kind: 'cadence', start: '2026-11-01', due: '2026-12-01' });
    log.emit('need.created', 'u-me', {
      needId: 'n1',
      projectId: 'p',
      kind: 'ext',
      title: 'Cache layer for search results',
      roundId: 'r1',
      accept: 'search queries use a cache table',
      source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
    });
    return log;
  }

  it('the unlinked commit suggests a need by code and links it', () => {
    const log = fixture();
    log.emit('work.recorded', 'u-me', { workId: 'w1', projectId: 'p', needId: null, src: 'commit', text: 'N1 add cache table for search results', date: '2026-11-10' });
    const w = log.state.work.w1!;
    expect(linkTargets(log.state, w).map((n) => n.id)).toEqual(['n1']);
    const suggestion = unlinkedSuggestion(log.state, w);
    expect(suggestion?.id).toBe('n1');
    const cmd = linkCommand(w, suggestion!.id);
    expect(cmd).toEqual({ type: 'work.linked', payload: { workId: 'w1', needId: 'n1', effect: 'advance' } });
    log.emit(cmd.type, 'u-me', cmd.payload);
    expect(log.state.work.w1!.needId).toBe('n1');
    expect(log.state.work.w1!.effect).toBe('advance');
  });

  it('an unmatched work item can be ignored, final', () => {
    const log = fixture();
    log.emit('work.recorded', 'u-me', { workId: 'w2', projectId: 'p', needId: null, src: 'commit', text: 'totally unrelated string of words', date: '2026-11-11' });
    const w = log.state.work.w2!;
    expect(unlinkedSuggestion(log.state, w)).toBeNull();
    const cmd = ignoreWorkCommand(w);
    expect(cmd).toEqual({ type: 'work.ignored', payload: { workId: 'w2' } });
    log.emit(cmd.type, 'u-me', cmd.payload);
    expect(log.state.work.w2!.ignored).toBe(true);
  });

  it('the unlinked commit becomes a new hypothesis, linked by spawn, when nothing matches', () => {
    const log = fixture();
    log.emit('work.recorded', 'u-me', { workId: 'w3', projectId: 'p', needId: null, src: 'commit', text: 'maybe batching helps latency', date: '2026-11-12' });
    const w = log.state.work.w3!;
    expect(unlinkedSuggestion(log.state, w)).toBeNull();
    const round = currentOrLatestRound(log.state, 'p');
    const [created, linked] = newHypCommands(w, 'h-new', round, 'u-me', 'commit log');
    log.emit(created.type, 'u-me', created.payload);
    log.emit(linked.type, 'u-me', linked.payload);
    const need = log.state.needs['h-new']!;
    expect(need).toMatchObject({ kind: 'hyp', status: 'testing', title: w.text, ownerId: 'u-me', privateTo: null });
    expect(need.source).toMatchObject({ src: 'commit', date: '2026-11-12', quote: w.text, ref: 'commit log' });
    expect(log.state.work.w3!.needId).toBe('h-new');
    expect(log.state.work.w3!.effect).toBe('spawn');
  });

  it('shared work leaves out private needs from link targets; private work can also link to the owner’s private needs', () => {
    const log = fixture();
    log.emit('need.created', 'u-me', {
      needId: 'n-private',
      projectId: 'p',
      kind: 'ext',
      title: 'Private need',
      roundId: 'r1',
      private: true,
      source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
    });
    log.emit('work.recorded', 'u-me', { workId: 'w-shared', projectId: 'p', needId: null, src: 'commit', text: 'shared commit', date: '2026-11-10' });
    log.emit('work.recorded', 'u-me', { workId: 'w-private', projectId: 'p', needId: null, src: 'commit', text: 'private commit', date: '2026-11-10', private: true });

    const shared = log.state.work['w-shared']!;
    const priv = log.state.work['w-private']!;
    expect(linkTargets(log.state, shared).map((n) => n.id).sort()).toEqual(['n1']);
    expect(linkTargets(log.state, priv).map((n) => n.id).sort()).toEqual(['n-private', 'n1']);
  });
});

describe('extractCommand', () => {
  function inputFixture(): Log {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    log.emit('round.created', 'u-me', { roundId: 'r1', projectId: 'p', title: 'R1', kind: 'cadence', start: '2026-11-01', due: '2026-12-01' });
    log.emit('input.imported', 'u-me', {
      inputId: 'in1',
      projectId: 'p',
      kind: 'md',
      title: 'Notes',
      date: '2026-11-10',
      body: [{ id: 'p1', text: 'We need an export button.' }],
      extracts: [{ id: 'x1', type: 'new', text: 'Export button', paraId: 'p1' }],
      detector: 'rules/1',
    });
    return log;
  }

  it('accepting a new extract without a round fills the current round and marks it rule-filled', () => {
    const log = inputFixture();
    const input = log.state.inputs.in1!;
    const x = input.extracts[0]!;
    const cmd = extractCommand('accept', input, x, 'n-new');
    expect(cmd.payload).toEqual({ inputId: 'in1', extractId: 'x1', needId: 'n-new' });
    log.emit(cmd.type, 'u-me', cmd.payload);
    const nid = log.state.inputs.in1!.extracts[0]!.resultNeedId!;
    expect(nid).toBe('n-new');
    expect(log.state.needs[nid]!.autoRound).toBe(true);
    expect(log.state.needs[nid]!.roundId).toBe('r1');
  });

  it('ignoring an extract marks it ignored, undecided by core', () => {
    const log = inputFixture();
    const input = log.state.inputs.in1!;
    const x = input.extracts[0]!;
    const cmd = extractCommand('ignore', input, x, 'unused');
    expect(cmd).toEqual({ type: 'extract.ignored', payload: { inputId: 'in1', extractId: 'x1' } });
    log.emit(cmd.type, 'u-me', cmd.payload);
    expect(log.state.inputs.in1!.extracts[0]!.state).toBe('ignored');
  });

  it('accepting a revision extract never sends needId (the target is already on the extract)', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    log.emit('need.created', 'u-me', {
      needId: 'n1',
      projectId: 'p',
      kind: 'ext',
      title: 'Target',
      roundId: null,
      accept: 'v1',
      source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
    });
    log.emit('input.imported', 'u-me', {
      inputId: 'in2',
      projectId: 'p',
      kind: 'md',
      title: 'Update',
      date: '2026-11-10',
      body: [{ id: 'p1', text: 'v2 now.' }],
      extracts: [{ id: 'x1', type: 'rev', text: 'v2', paraId: 'p1', needId: 'n1' }],
      detector: 'rules/1',
    });
    const input = log.state.inputs.in2!;
    const x = input.extracts[0]!;
    const cmd = extractCommand('accept', input, x, 'should-be-ignored');
    expect(cmd.payload).toEqual({ inputId: 'in2', extractId: 'x1' });
    log.emit(cmd.type, 'u-me', cmd.payload);
    expect(log.state.needs.n1!.accept).toBe('v2');
  });
});

describe('proposalCommand', () => {
  function proposalFixture(): Log {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('user.registered', 'system', { userId: 'u-bot', displayName: 'Bot user', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    log.emit('project.member_added', 'u-me', { projectId: 'p', userId: 'u-bot' });
    log.emit('round.created', 'u-me', { roundId: 'r1', projectId: 'p', title: 'R1', kind: 'cadence', start: '2026-11-01', due: '2026-12-01' });
    log.emit('proposal.created', 'u-bot', {
      proposalId: 'pr1',
      projectId: 'p',
      kind: 'ext',
      title: 'Add retries',
      why: 'flaky network',
      via: { client: 'claude-code', tokenId: 't1' },
    });
    return log;
  }

  it('a proposal accepted becomes a need owned by its proposer', () => {
    const log = proposalFixture();
    const p = log.state.proposals.pr1!;
    const round = currentOrLatestRound(log.state, 'p');
    const cmd = proposalCommand('accept', p, 'n-from-proposal', round?.id ?? null);
    expect(cmd).toEqual({ type: 'proposal.accepted', payload: { proposalId: 'pr1', needId: 'n-from-proposal', roundId: 'r1' } });
    log.emit(cmd.type, 'u-me', cmd.payload);
    const need = log.state.needs['n-from-proposal']!;
    expect(need.ownerId).toBe('u-bot');
    expect(log.state.proposals.pr1!.status).toBe('accepted');
    expect(log.state.proposals.pr1!.needId).toBe('n-from-proposal');
  });

  it('a proposal rejected stays without a need', () => {
    const log = proposalFixture();
    const p = log.state.proposals.pr1!;
    const cmd = proposalCommand('reject', p, 'unused', null);
    expect(cmd).toEqual({ type: 'proposal.rejected', payload: { proposalId: 'pr1' } });
    log.emit(cmd.type, 'u-me', cmd.payload);
    expect(log.state.proposals.pr1!.status).toBe('rejected');
    expect(log.state.proposals.pr1!.needId).toBeNull();
  });
});
