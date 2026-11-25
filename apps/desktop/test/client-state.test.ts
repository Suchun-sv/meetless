import { describe, expect, it } from 'vitest';
import { answer, DETECTOR_ID, detectExtracts, isDomainError, openConflicts, toParagraphs, viewFor, type AgentScope, type EventScope, type State } from '@meetless/core';
import { atlas, P, R, U } from '../../../packages/core/test/log';
import { sample } from './support/app';
import { clientReplay, clientState, streamFor, type ScopedLog } from './support/client-state';
import { Log } from './support/log';

/*
 * The property behind every client screen: what a client builds from the events the service streams
 * to it (safeReplay of streamFor(u)) skips nothing and is exactly the service's view of that user.
 * Checked for every user of the sample (both locales) and of core's test fixtures.
 */

/** A core refusal is part of the scenario (the importer may try); anything else is a test bug. */
function attempt(fn: () => unknown): void {
  try {
    fn();
  } catch (e) {
    if (!isDomainError(e)) throw e;
  }
}

const DOC = [
  '# Client requirements v2',
  'Exports must include all customer fields.',
  'Excel export would be welcome, please support it.',
  'We suspect the date index might keep filtering under 30 s.',
  'N2 should also offer a “last 7 days” shortcut.',
].join('\n');

const src = (quote = '') => ({ src: 'doc' as const, date: '2026-11-24', quote, ref: 'notes' });

/** Core's Atlas fixture plus every privacy and collaboration flow: private items, sharing, inputs, conflicts, handoffs, proposals, artifacts. */
function privacyMix() {
  const log = atlas();
  // Alex's private hypothesis with work, a private note on a shared need, a private dashboard.
  log.emit('need.created', U.me, { needId: 'h-rope', projectId: P, kind: 'hyp', title: 'RoPE extrapolation cuts latency', roundId: R.r1, expect: 'p50 -5%', source: src('try RoPE'), private: true });
  log.emit('work.recorded', U.me, { workId: 'w-rope', projectId: P, needId: 'h-rope', src: 'exp', text: 'RoPE small run', date: '2026-11-24' });
  log.emit('work.recorded', U.me, { workId: 'w-note', projectId: P, needId: 'n-export', src: 'doc', text: 'scratch note', date: '2026-11-24', private: true });
  log.emit('dashboard.set', U.me, { scope: P, cards: ['progress', 'sources'] });
  log.emit('need.created', U.me, { needId: 'n-p', projectId: P, kind: 'ext', title: 'My export draft', roundId: null, accept: 'A few fields', source: src(), private: true });

  // C1: a shared input whose revision names Alex's private need. Core refuses it; if it ever slipped
  // through, Lin's client could not apply it nor anything built on it (the accepted new need below).
  const one = toParagraphs('Exports must include all customer fields. Excel export too.');
  attempt(() =>
    log.emit('input.imported', U.me, {
      inputId: 'in-c1',
      projectId: P,
      kind: 'txt',
      title: 'mail.txt',
      date: '2026-11-24',
      body: one,
      extracts: [
        { id: 'x1', type: 'rev', text: 'All customer fields', paraId: one[0]!.id, needId: 'n-p', conflict: true },
        { id: 'x2', type: 'new', text: 'Excel export', paraId: one[0]!.id },
      ],
      detector: DETECTOR_ID,
    }),
  );
  attempt(() => log.emit('extract.accepted', U.me, { inputId: 'in-c1', extractId: 'x2', needId: 'n-c1' }));

  // A shared requirements doc, detected over the shared needs: new need, hypothesis, revision, conflict.
  const body = toParagraphs(DOC);
  const shared = Object.values(log.state.needs).filter((n) => n.privateTo === null);
  log.emit('input.imported', U.me, { inputId: 'in-1', projectId: P, kind: 'pdf', title: 'Client requirements v2.pdf', from: { name: 'Mr Wang' }, date: '2026-11-23', body, extracts: detectExtracts(body, shared), detector: DETECTOR_ID });
  const xs = log.state.inputs['in-1']!.extracts;
  log.emit('extract.accepted', U.me, { inputId: 'in-1', extractId: xs.find((x) => x.type === 'new')!.id, needId: 'n-excel' });
  log.emit('extract.accepted', U.ben, { inputId: 'in-1', extractId: xs.find((x) => x.type === 'hyp')!.id, needId: 'h-index', roundId: R.r2 });
  log.emit('extract.accepted', U.me, { inputId: 'in-1', extractId: xs.find((x) => x.type === 'rev' && !x.conflict)!.id });
  const c = openConflicts(log.state, P)[0]!;
  log.emit('conflict.resolved', U.me, { conflictId: c.id, resolution: 'handoff', handoffId: 'ho-c', toId: U.lin, ask: 'Your call.', due: '2026-11-26' });
  log.emit('conflict.resolved', U.lin, { conflictId: c.id, resolution: 'park', needId: 'n-all', roundId: R.r2 });

  // A private input revising the private need: shared only after the need is.
  const priv = toParagraphs('Exports must include every customer field.');
  log.emit('input.imported', U.me, { inputId: 'in-p', projectId: P, kind: 'md', title: 'My notes.md', date: '2026-11-24', body: priv, extracts: [{ id: 'x1', type: 'rev', text: 'Every field', paraId: priv[0]!.id, needId: 'n-p', conflict: true }], detector: DETECTOR_ID, private: true });
  attempt(() => log.emit('input.shared', U.me, { inputId: 'in-p', snapshot: { input: log.state.inputs['in-p']! } }));
  log.emit('need.shared', U.me, { needId: 'n-p', snapshot: { need: log.state.needs['n-p']!, work: [] } });
  // (Both refused if the share above had gone through; the sanity test below checks they took effect.)
  attempt(() => log.emit('input.shared', U.me, { inputId: 'in-p', snapshot: { input: log.state.inputs['in-p']! } }));
  attempt(() => log.emit('conflict.resolved', U.me, { conflictId: 'in-p:x1', resolution: 'revise' }));

  // A private artifact on the private hypothesis, shared after it.
  log.emit('artifact.created', U.me, { artifactId: 'a-doc', projectId: P, kind: 'docx', title: 'RoPE draft', where: 'local', needIds: ['h-rope'], private: true });
  log.emit('artifact.version_added', U.me, { artifactId: 'a-doc', versionId: 'av-1', label: 'v1', date: '2026-11-24', note: '' });
  log.emit('artifactVersion.derived', 'system', { artifactId: 'a-doc', versionId: 'av-1', status: 'ready', pageHashes: [], texts: ['RoPE notes'], error: null, converter: 'test' });
  log.emit('need.shared', U.me, { needId: 'h-rope', snapshot: { need: log.state.needs['h-rope']!, work: [log.state.work['w-rope']!] } });
  log.emit('artifact.shared', U.me, { artifactId: 'a-doc', snapshot: { artifact: log.state.artifacts['a-doc']! } });

  // A need accepted from a private input stays private when the input is shared afterwards.
  const memo = toParagraphs('Zephyr shortlist for the board.');
  log.emit('input.imported', U.me, { inputId: 'in-z', projectId: P, kind: 'md', title: 'Board memo.md', date: '2026-11-24', body: memo, extracts: [{ id: 'x1', type: 'new', text: 'Zephyr shortlist', paraId: memo[0]!.id }], detector: DETECTOR_ID, private: true });
  log.emit('extract.accepted', U.me, { inputId: 'in-z', extractId: 'x1', needId: 'n-zephyr' });
  log.emit('input.shared', U.me, { inputId: 'in-z', snapshot: { input: log.state.inputs['in-z']! } });

  // A handoff round trip, an agent proposal, Lin's private note.
  log.emit('handoff.created', U.me, { handoffId: 'ho1', projectId: P, needId: 'n-filter', toId: U.zhou, ask: 'Add filter tests.', due: '2026-11-26' });
  log.emit('handoff.responded', U.zhou, { handoffId: 'ho1', response: 'accepted' });
  log.emit('handoff.context_fetched', U.zhou, { handoffId: 'ho1', version: 1, client: 'claude-code' });
  log.emit('work.recorded', U.zhou, { workId: 'w-z', projectId: P, needId: 'n-filter', src: 'agent', text: '6 filter tests', date: '2026-11-24', via: { client: 'claude-code', tokenId: 't1' } });
  log.emit('handoff.returned', U.zhou, { handoffId: 'ho1', note: 'done' });
  log.emit('handoff.confirmed', U.me, { handoffId: 'ho1' });
  log.emit('proposal.created', U.ben, { proposalId: 'pr1', projectId: P, kind: 'hyp', title: 'A date index keeps filtering fast', via: { client: 'codex', tokenId: 't2' } });
  log.emit('proposal.accepted', U.me, { proposalId: 'pr1', needId: 'h-prop', roundId: R.r1 });
  log.emit('work.recorded', U.lin, { workId: 'w-lin', projectId: P, needId: 'n-export', src: 'doc', text: 'Lin scratch', date: '2026-11-24', private: true });
  return log;
}

const FIXTURES: [string, () => ScopedLog][] = [
  ['core atlas', atlas],
  ['core privacy mix', privacyMix],
  ['sample zh-CN', () => sample('zh-CN')],
  ['sample en', () => sample('en')],
];

const KEYS = ['needs', 'inputs', 'work', 'artifacts', 'conflicts', 'handoffs', 'proposals', 'rounds', 'roles', 'projects', 'users'] as const;

describe('every client holds exactly its service view', () => {
  for (const [name, make] of FIXTURES) {
    it(`${name}: safeReplay(streamFor(u)) skips nothing and equals viewFor(state, u), for every user`, () => {
      const log = make();
      const users = Object.keys(log.state.users);
      expect(users.length).toBeGreaterThan(3);
      for (const u of users) {
        const { state, skipped } = clientReplay(log, u);
        expect(skipped.map((e) => `${e.seq} ${e.type}`), `${name} ${u}`).toEqual([]);
        const view = viewFor(log.state, u);
        for (const k of KEYS) expect(state[k], `${name} ${u} ${k}`).toEqual(view[k]);
        expect(clientState(log, u)).toEqual(state);
      }
    });
  }

  it('the privacy mix exercises what it claims', () => {
    const log = privacyMix();
    expect(log.state.inputs['in-c1']).toBeUndefined();
    expect(log.state.needs['n-p']).toMatchObject({ privateTo: null, revisions: [expect.objectContaining({ inputId: 'in-p' })] });
    expect(log.state.handoffs['ho-c']!.state).toBe('done');
    expect(log.state.artifacts['a-doc']!.privateTo).toBeNull();
    expect(log.scopes.filter((s) => s.privateTo !== null).length).toBeGreaterThan(4);
    // Lin never receives Alex's private note, and Alex never receives Lin's.
    expect(JSON.stringify(streamFor(log, U.lin))).not.toContain('scratch note');
    expect(JSON.stringify(streamFor(log, U.me))).not.toContain('Lin scratch');
    // Eve is in no project: she gets the user directory only.
    expect(Object.keys(clientState(log, U.eve).projects)).toEqual([]);
  });
});

/** Questions for the agent: the fixed intents plus every need title and input paragraph in the full record (private ones too). */
function queries(full: State): string[] {
  const fixed = ['what first today', '今天先做什么', 'deadlines', 'this week', 'delivery note', 'export', '导出', 'cache', '缓存', 'ablation', '消融', 'abstract', '摘要'];
  const fromRecord = [...Object.values(full.needs).map((n) => n.title), ...Object.values(full.inputs).flatMap((i) => [i.title, ...i.body.map((b) => b.text)])];
  return [...fixed, ...fromRecord.map((t) => t.slice(0, 60))];
}

describe('answers cite only what the asker can see', () => {
  for (const [name, make] of FIXTURES) {
    it(`${name}: every cited need id and every retrieved need is in the asker's view`, () => {
      const log = make();
      const qs = queries(log.state);
      for (const u of Object.keys(log.state.users)) {
        const live = clientState(log, u);
        const scopes: AgentScope[] = [{ kind: 'home' }, ...Object.keys(live.projects).map((projectId) => ({ kind: 'project' as const, projectId }))];
        for (const scope of scopes)
          for (const text of qs) {
            const a = answer(live, { userId: u, scope, text, today: '2026-11-24' }).answer;
            const ids = [...a.cites, ...(a.intent === 'retrieval' ? a.needs.flatMap((g) => [g.needId, ...g.hits.map((h) => h.needId)]) : [])];
            for (const id of ids) if (id !== null) expect(live.needs[id], `${name} ${u} "${text}": ${id}`).toBeDefined();
          }
      }
    });
  }
});

describe('clientState', () => {
  it('throws naming the events a client could not apply', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-a', displayName: 'A', locale: 'en' });
    log.emit('user.registered', 'system', { userId: 'u-b', displayName: 'B', locale: 'en' });
    log.emit('project.created', 'u-a', { projectId: 'p', name: 'P' });
    log.emit('project.member_added', 'u-a', { projectId: 'p', userId: 'u-b' });
    log.emit('need.created', 'u-a', { needId: 'n', projectId: 'p', kind: 'ext', title: 'Mine', roundId: null, source: src(), private: true });
    log.emit('work.recorded', 'u-a', { workId: 'w', projectId: 'p', needId: 'n', src: 'doc', text: 'x', date: '2026-11-24' });
    // A wrong scope (the work stored as shared) streams B an event about a need B does not have.
    const scopes: EventScope[] = log.scopes.map((s, i) => (i === 5 ? { ...s, privateTo: null } : s));
    const broken: ScopedLog = { events: log.events, scopes, state: log.state };
    expect(clientReplay(broken, 'u-b').skipped.map((e) => e.type)).toEqual(['work.recorded']);
    expect(() => clientState(broken, 'u-b')).toThrow('the client of u-b skipped 1 event(s): 6 work.recorded');
    expect(clientState(log, 'u-b').needs).toEqual({});
  });
});
