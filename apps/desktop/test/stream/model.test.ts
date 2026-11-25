import { describe, expect, it } from 'vitest';
import { Log } from '../support/log';
import { streamKind, streamNeedOptions, streamRows } from '../../src/renderer/stream/model';

const TODAY = '2026-11-24';

/**
 * A project with: a shared need (n1) and a second shared need (n2); an agent report (via codex)
 * on n1 (seq low, oldest date); a capture on n1 (newer date, never progress); a rule-linked
 * (`autoLinked`) manual item on n2; an unlinked commit recorded by Alex (askable for Alex only, never for Lin); an ignored item (must never render);
 * and a private hypothesis (hp1) with Alex's own work on it.
 */
function fixture() {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale: 'en' });
  log.emit('user.registered', 'system', { userId: 'u-lin', displayName: 'Lin', locale: 'en' });
  log.emit('project.created', 'u-alex', { projectId: 'p1', name: 'P1' });
  log.emit('project.member_added', 'u-alex', { projectId: 'p1', userId: 'u-lin' });

  log.emit('need.created', 'u-alex', {
    needId: 'n1',
    projectId: 'p1',
    kind: 'ext',
    title: 'Need one',
    roundId: null,
    source: { src: 'doc', date: TODAY, quote: 'q', ref: 'r' },
  });
  log.emit('need.created', 'u-alex', {
    needId: 'n2',
    projectId: 'p1',
    kind: 'ext',
    title: 'Need two',
    roundId: null,
    source: { src: 'doc', date: TODAY, quote: 'q', ref: 'r' },
  });
  log.emit('need.created', 'u-alex', {
    needId: 'hp1',
    projectId: 'p1',
    kind: 'hyp',
    title: 'Secret hypothesis',
    roundId: null,
    source: { src: 'doc', date: TODAY, quote: 'q', ref: 'r' },
    private: true,
  });

  log.emit(
    'work.recorded',
    'u-alex',
    { workId: 'w-agent', projectId: 'p1', needId: 'n1', src: 'agent', text: 'Codex ran tests', date: '2026-11-20', effect: 'advance', via: { client: 'codex', tokenId: 'tok1' } },
    { id: 'wa' },
  );
  log.emit(
    'work.recorded',
    'u-alex',
    { workId: 'w-cap', projectId: 'p1', needId: 'n1', src: 'commit', text: 'abc1 capture commit', date: '2026-11-22', capture: true, via: { client: 'codex', tokenId: 'tok2' } },
    { id: 'wc' },
  );
  log.emit(
    'work.recorded',
    'u-alex',
    { workId: 'w-rule', projectId: 'p1', needId: 'n2', src: 'commit', text: 'def2 rule linked commit', date: '2026-11-21', effect: 'advance', autoLinked: true },
    { id: 'wr' },
  );
  log.emit(
    'work.recorded',
    'u-alex',
    { workId: 'w-unlinked-alex', projectId: 'p1', needId: null, src: 'commit', text: 'ghi3 alex unlinked commit', date: '2026-11-23' },
    { id: 'wua' },
  );
  log.emit('work.recorded', 'u-alex', { workId: 'w-ignored', projectId: 'p1', needId: null, src: 'commit', text: 'mno5 ignored commit', date: '2026-11-18' }, { id: 'wi' });
  log.emit('work.ignored', 'u-alex', { workId: 'w-ignored' });
  log.emit('work.recorded', 'u-alex', { workId: 'w-priv', projectId: 'p1', needId: 'hp1', src: 'exp', text: 'secret experiment', date: '2026-11-17', effect: 'advance' }, { id: 'wp' });

  return log;
}

describe('streamKind', () => {
  it('a capture is capture even when via is also set; else via is agent; else manual', () => {
    const log = fixture();
    expect(streamKind(log.state.work['w-cap']!)).toBe('capture');
    expect(streamKind(log.state.work['w-agent']!)).toBe('agent');
    expect(streamKind(log.state.work['w-rule']!)).toBe('manual');
    expect(streamKind(log.state.work['w-unlinked-alex']!)).toBe('manual');
  });
});

describe('streamRows', () => {
  it('kinds: via is agent, capture is capture, else manual; captures are never progress', () => {
    const log = fixture();
    const rows = streamRows(log.state, 'u-alex', 'p1', { kind: 'all', needId: null });
    const byKind = Object.fromEntries(rows.map((r) => [r.w.id, r.kind]));
    expect(byKind['w-agent']).toBe('agent');
    expect(byKind['w-cap']).toBe('capture');
    expect(byKind['w-rule']).toBe('manual');
    expect(rows.filter((r) => r.kind === 'capture').every((r) => !r.progress)).toBe(true);
    expect(rows.filter((r) => r.kind !== 'capture').every((r) => r.progress)).toBe(true);
  });

  it('filters by kind and by need (also matching alsoNeedId); ignored work is gone', () => {
    const log = fixture();
    const all = streamRows(log.state, 'u-alex', 'p1', { kind: 'all', needId: null });
    expect(all.some((r) => r.w.id === 'w-ignored')).toBe(false);

    const agentOnly = streamRows(log.state, 'u-alex', 'p1', { kind: 'agent', needId: null });
    expect(agentOnly.map((r) => r.w.id)).toEqual(['w-agent']);

    const captureOnly = streamRows(log.state, 'u-alex', 'p1', { kind: 'capture', needId: null });
    expect(captureOnly.map((r) => r.w.id)).toEqual(['w-cap']);

    const n1Only = streamRows(log.state, 'u-alex', 'p1', { kind: 'all', needId: 'n1' });
    expect(n1Only.map((r) => r.w.id).sort()).toEqual(['w-agent', 'w-cap'].sort());

    // alsoNeedId match
    log.emit('work.recorded', 'u-alex', { workId: 'w-also', projectId: 'p1', needId: null, alsoNeedId: 'n2', src: 'doc', text: 'pqr6 referencing n2', date: '2026-11-24' }, { id: 'wal' });
    const n2Match = streamRows(log.state, 'u-alex', 'p1', { kind: 'all', needId: 'n2' });
    expect(n2Match.map((r) => r.w.id).sort()).toEqual(['w-also', 'w-rule'].sort());
  });

  it('newest first by date, then by seq', () => {
    const log = fixture();
    const rows = streamRows(log.state, 'u-alex', 'p1', { kind: 'all', needId: null });
    const dates = rows.map((r) => r.w.date);
    for (let i = 1; i < dates.length; i++) expect(dates[i - 1]! >= dates[i]!).toBe(true);
    // w-unlinked-alex (2026-11-23) is the newest of the non-private rows.
    expect(rows[0]!.w.id).toBe('w-unlinked-alex');
  });

  it('the unlinked sample commit is askable for its author only', () => {
    const log = fixture();
    const rowsFor = (me: string) => streamRows(log.state, me, 'p1', { kind: 'all', needId: null });
    expect(rowsFor('u-alex').some((r) => r.unlinked && r.askable && r.w.id === 'w-unlinked-alex')).toBe(true);
    expect(rowsFor('u-lin').some((r) => r.askable)).toBe(false);
  });

  it('rules is w.autoLinked; mine marks the viewer’s own private rows', () => {
    const log = fixture();
    const rows = streamRows(log.state, 'u-alex', 'p1', { kind: 'all', needId: null });
    expect(rows.find((r) => r.w.id === 'w-rule')!.rules).toBe(true);
    expect(rows.find((r) => r.w.id === 'w-agent')!.rules).toBe(false);
    expect(rows.find((r) => r.w.id === 'w-priv')!.mine).toBe(true);
    expect(rows.find((r) => r.w.id === 'w-agent')!.mine).toBe(false);
  });
});

describe('streamNeedOptions', () => {
  it('lists only needs with non-ignored work, sorted by code', () => {
    const log = fixture();
    const opts = streamNeedOptions(log.state, 'p1');
    // n1, n2 (shared) and hp1 (Alex's private hypothesis, which also has a non-ignored work item).
    expect(new Set(opts.map((n) => n.id))).toEqual(new Set(['n1', 'n2', 'hp1']));
    const codes = opts.map((n) => n.code);
    expect(codes).toEqual([...codes].sort());
  });

  it('drops a need once its only work item is ignored', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale: 'en' });
    log.emit('project.created', 'u-alex', { projectId: 'p2', name: 'P2' });
    log.emit('need.created', 'u-alex', { needId: 'n9', projectId: 'p2', kind: 'ext', title: 'N9', roundId: null, source: { src: 'doc', date: TODAY, quote: 'q', ref: 'r' } });
    log.emit('work.recorded', 'u-alex', { workId: 'w9', projectId: 'p2', needId: 'n9', src: 'doc', text: 'x', date: TODAY }, { id: 'w9e' });
    expect(streamNeedOptions(log.state, 'p2').map((n) => n.id)).toEqual(['n9']);
    log.emit('work.ignored', 'u-alex', { workId: 'w9' });
    expect(streamNeedOptions(log.state, 'p2').map((n) => n.id)).toEqual([]);
  });
});
