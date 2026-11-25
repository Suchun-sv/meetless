import { describe, expect, it } from 'vitest';
import {
  DETECTOR_ID,
  DomainError,
  answer,
  activityCard,
  applyEvent,
  detectExtracts,
  hypothesesCard,
  homeItems,
  needContext,
  replay,
  search,
  shareableView,
  sourcesCard,
  toParagraphs,
  viewFor,
  type DomainErrorCode,
  type State,
} from '../src/index';
import { atlas, P, R, U } from './log';
import { LABELS } from './labels';

const rejects = (fn: () => unknown, code: DomainErrorCode) => {
  try {
    fn();
  } catch (e) {
    expect((e as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
};

const SECRET = 'RoPE extrapolation';

function withPrivate() {
  const log = atlas();
  log.emit('need.created', U.me, {
    needId: 'h-rope',
    projectId: P,
    kind: 'hyp',
    title: `${SECRET} may cut latency further`,
    roundId: R.r1,
    expect: 'p50 another -5%',
    source: { src: 'doc', date: '2026-11-24', quote: `Personal note: try ${SECRET}`, ref: 'My drafts' },
    private: true,
  });
  log.emit('work.recorded', U.me, { workId: 'w-rope', projectId: P, needId: 'h-rope', src: 'exp', text: `${SECRET} small run`, date: '2026-11-24' });
  log.emit('work.recorded', U.me, { workId: 'w-note', projectId: P, needId: 'n-export', src: 'doc', text: `${SECRET} scratch note`, date: '2026-11-24', private: true });
  const body = toParagraphs(`We should try ${SECRET} on the small dataset.`);
  log.emit('input.imported', U.me, { inputId: 'in-priv', projectId: P, kind: 'md', title: 'My notes.md', date: '2026-11-24', body, extracts: detectExtracts(body, []), detector: DETECTOR_ID, private: true });
  log.emit('dashboard.set', U.me, { scope: P, cards: ['progress', 'sources'] });
  return log;
}

const mentions = (x: unknown) => JSON.stringify(x).includes(SECRET);

describe('privacy: private items never reach other people', () => {
  it('scopes private events to their owner; members receive none of them', () => {
    const log = withPrivate();
    const priv = log.events.filter((_, i) => log.scopes[i]!.privateTo === U.me).map((e) => e.type);
    expect(priv).toEqual(['need.created', 'work.recorded', 'work.recorded', 'input.imported', 'dashboard.set']);
    expect(mentions(log.streamFor(U.ben))).toBe(false);
    expect(mentions(log.streamFor(U.me))).toBe(true);
  });

  it('a member replays their filtered stream without errors and gets exactly the shared part of the record', () => {
    const log = withPrivate();
    const ben = replay(log.streamFor(U.ben));
    const expected = viewFor(log.state, U.ben);
    for (const k of ['needs', 'work', 'inputs', 'handoffs', 'rounds', 'conflicts', 'dashboards'] as const) expect(ben[k]).toEqual(expected[k]);
    expect(mentions(ben)).toBe(false);
    expect(ben.needs['n-export']!.code).toBe('N1');
    expect(log.state.needs['h-rope']!.code).toBe('Hp1');
  });

  it('others cannot act on a private item (it does not exist for them)', () => {
    const log = withPrivate();
    rejects(() => log.emit('need.revised', U.ben, { needId: 'h-rope', revisionId: 'x', text: 'x', why: 'x', date: '2026-11-24' }), 'NOT_FOUND');
    rejects(() => log.emit('need.shared', U.ben, { needId: 'h-rope' }), 'NOT_FOUND');
    rejects(() => log.emit('work.recorded', U.ben, { workId: 'x', projectId: P, needId: 'h-rope', src: 'doc', text: 'x', date: '2026-11-24' }), 'NOT_FOUND');
    rejects(() => log.emit('extract.accepted', U.ben, { inputId: 'in-priv', extractId: 'x1', needId: 'z' }), 'NOT_FOUND');
  });

  it('is excluded from search, answers, context, dashboards and links', () => {
    const log = withPrivate();
    const today = '2026-11-24';
    const forBen: State = viewFor(log.state, U.ben);
    expect(search(forBen, { text: 'RoPE extrapolation', projectId: P })).toEqual([]);
    expect(mentions(answer(forBen, { userId: U.ben, scope: { kind: 'project', projectId: P }, text: 'did anyone try RoPE extrapolation?', today }))).toBe(false);
    expect(mentions(needContext(forBen, 'n-export', LABELS).markdown)).toBe(false);
    for (const card of [activityCard(forBen, P), hypothesesCard(forBen, P), sourcesCard(forBen, P), homeItems(forBen, U.ben, today)]) expect(mentions(card)).toBe(false);
    expect(Object.keys(forBen.dashboards)).toEqual([]);

    // The owner finds their own item, but a link / shareable context never carries it.
    const forMe = viewFor(log.state, U.me);
    expect(search(forMe, { text: 'RoPE extrapolation', projectId: P }).some((h) => h.needId === 'h-rope')).toBe(true);
    expect(mentions(needContext(shareableView(forMe), 'n-export', LABELS).markdown)).toBe(false);
    expect(mentions(activityCard(forMe, P))).toBe(false);
  });

  it('sharing to the project renumbers it and lets others see it (with its work) from then on', () => {
    const log = withPrivate();
    log.emit('need.shared', U.me, { needId: 'h-rope', snapshot: { need: log.state.needs['h-rope']!, work: [log.state.work['w-rope']!] } });
    expect(log.state.needs['h-rope']).toMatchObject({ privateTo: null, code: 'H2' });
    const ben = replay(log.streamFor(U.ben));
    expect(ben.needs['h-rope']).toMatchObject({ privateTo: null, code: 'H2', title: `${SECRET} may cut latency further` });
    expect(ben.work['w-rope']).toBeDefined();
    // The separately private note stays private.
    expect(ben.work['w-note']).toBeUndefined();
    expect(ben.needs).toEqual(viewFor(log.state, U.ben).needs);
  });

  it('a private input cannot revise a shared need until it is shared; sharing opens its conflicts', () => {
    const log = atlas();
    const body = toParagraphs('Exports must include all customer fields.');
    const extracts = detectExtracts(body, Object.values(log.state.needs));
    expect(extracts[0]).toMatchObject({ type: 'rev', conflict: true });
    log.emit('input.imported', U.me, { inputId: 'in-p', projectId: P, kind: 'txt', title: 'draft.txt', date: '2026-11-24', body, extracts, detector: DETECTOR_ID, private: true });
    expect(Object.keys(log.state.conflicts)).toEqual([]);
    rejects(() => log.emit('extract.accepted', U.me, { inputId: 'in-p', extractId: 'x1' }), 'PRIVATE_SOURCE');
    log.emit('input.shared', U.me, { inputId: 'in-p', snapshot: { input: log.state.inputs['in-p']! } });
    expect(Object.values(log.state.conflicts)).toHaveLength(1);
    const ben = replay(log.streamFor(U.ben));
    expect(ben.inputs['in-p']!.privateTo).toBeNull();
    expect(Object.values(ben.conflicts)).toHaveLength(1);
  });

  it('sharing an artifact shows it to members (from the snapshot for those who never saw it); not while it links a private need', () => {
    const log = atlas();
    log.emit('need.created', U.me, {
      needId: 'h-art',
      projectId: P,
      kind: 'hyp',
      title: 'secret hypothesis',
      roundId: R.r1,
      expect: 'x',
      source: { src: 'doc', date: '2026-11-24', quote: '', ref: '' },
      private: true,
    });
    log.emit('artifact.created', U.me, { artifactId: 'a-doc', projectId: P, kind: 'docx', title: 'Draft', where: 'local', needIds: ['h-art'], private: true });
    rejects(() => log.emit('artifact.shared', U.me, { artifactId: 'a-doc', snapshot: { artifact: log.state.artifacts['a-doc']! } }), 'PRIVATE_ITEM');
    log.emit('need.shared', U.me, { needId: 'h-art', snapshot: { need: log.state.needs['h-art']!, work: [] } });
    log.emit('artifact.shared', U.me, { artifactId: 'a-doc', snapshot: { artifact: log.state.artifacts['a-doc']! } });
    expect(log.state.artifacts['a-doc']).toMatchObject({ privateTo: null });
    const ben = replay(log.streamFor(U.ben));
    expect(ben.artifacts['a-doc']).toMatchObject({ privateTo: null, title: 'Draft' });
    rejects(() => log.emit('artifact.shared', U.me, { artifactId: 'a-doc' }), 'INVALID_STATE_TRANSITION');
  });

  it('a linked need id that does not resolve does not block sharing an artifact; only an existing private need does', () => {
    const log = atlas();
    log.emit('artifact.created', U.me, { artifactId: 'a-doc', projectId: P, kind: 'docx', title: 'Draft', where: 'local', needIds: ['n-export'], private: true });
    const { 'n-export': _gone, ...needs } = log.state.needs;
    const s: State = { ...log.state, needs };
    const next = applyEvent(s, { seq: s.lastSeq + 1, id: 'e-share', type: 'artifact.shared', actorId: U.me, recordedAt: log.now(), payload: { artifactId: 'a-doc' } });
    expect(next.artifacts['a-doc']!.privateTo).toBeNull();
  });

  it('a need from a private input (new or revised) is not shared while the input is private', () => {
    const log = atlas();
    log.emit('need.created', U.me, { needId: 'n-own', projectId: P, kind: 'ext', title: 'My own need', roundId: null, source: { src: 'doc', date: '2026-11-24', quote: '', ref: '' }, private: true });
    const body = toParagraphs(`Excel export would be welcome. ${SECRET}`);
    const extracts = [
      { id: 'x1', type: 'new' as const, text: 'Excel export', paraId: body[0]!.id },
      { id: 'x2', type: 'rev' as const, text: `Also ${SECRET}`, paraId: body[0]!.id, needId: 'n-own' },
    ];
    log.emit('input.imported', U.me, { inputId: 'in-p', projectId: P, kind: 'md', title: `Notes on ${SECRET}.md`, date: '2026-11-24', body, extracts, detector: DETECTOR_ID, private: true });
    log.emit('extract.accepted', U.me, { inputId: 'in-p', extractId: 'x1', needId: 'n-x' });
    log.emit('extract.accepted', U.me, { inputId: 'in-p', extractId: 'x2' });
    expect(log.state.needs['n-x']).toMatchObject({ privateTo: U.me, source: { inputId: 'in-p' } });
    rejects(() => log.emit('need.shared', U.me, { needId: 'n-x' }), 'PRIVATE_SOURCE');
    rejects(() => log.emit('need.shared', U.me, { needId: 'n-own' }), 'PRIVATE_SOURCE');
    expect(mentions(log.streamFor(U.ben))).toBe(false);

    log.emit('input.shared', U.me, { inputId: 'in-p', snapshot: { input: log.state.inputs['in-p']! } });
    log.emit('need.shared', U.me, { needId: 'n-x', snapshot: { need: log.state.needs['n-x']!, work: [log.state.work['in-p:x1']!] } });
    log.emit('need.shared', U.me, { needId: 'n-own', snapshot: { need: log.state.needs['n-own']!, work: [log.state.work['in-p:x2']!] } });
    const ben = replay(log.streamFor(U.ben));
    expect(ben.needs['n-x']).toMatchObject({ privateTo: null, source: { inputId: 'in-p' } });
    expect(ben.needs).toEqual(viewFor(log.state, U.ben).needs);
  });

  it('a need cannot cite an input its author cannot see: the same NOT_FOUND as a missing id, so private ids cannot be probed', () => {
    const log = withPrivate();
    const need = (needId: string, inputId: string, priv: boolean) => ({
      needId,
      projectId: P,
      kind: 'ext' as const,
      title: 'Probe',
      roundId: null,
      source: { src: 'doc' as const, date: '2026-11-24', quote: '', ref: '', inputId },
      private: priv,
    });
    for (const priv of [true, false]) {
      rejects(() => log.emit('need.created', U.ben, need(`n-probe-${priv}`, 'in-priv', priv)), 'NOT_FOUND');
      rejects(() => log.emit('need.created', U.ben, need(`n-none-${priv}`, 'in-none', priv)), 'NOT_FOUND');
    }
    // Probing then sharing reveals nothing either: the private need was never created.
    expect(log.state.needs['n-probe-true']).toBeUndefined();
    // The owner may cite their own private input in a private need, but not in a shared one.
    log.emit('need.created', U.me, need('n-mine', 'in-priv', true));
    expect(log.state.needs['n-mine']).toMatchObject({ privateTo: U.me, source: { inputId: 'in-priv' } });
    rejects(() => log.emit('need.created', U.me, need('n-shared', 'in-priv', false)), 'PRIVATE_SOURCE');
    // A shared input may be cited by any member, and every member's replay of their stream applies it.
    log.emit('input.shared', U.me, { inputId: 'in-priv', snapshot: { input: log.state.inputs['in-priv']! } });
    log.emit('need.created', U.ben, need('n-ben', 'in-priv', false));
    expect(replay(log.streamFor(U.zhou)).needs['n-ben']).toMatchObject({ privateTo: null, source: { inputId: 'in-priv' } });
  });

  it('a need cannot cite an input of another project: NOT_FOUND, even when the author can read that project', () => {
    const log = atlas();
    log.emit('project.created', U.ben, { projectId: 'p-other', name: 'Other' });
    const body = toParagraphs('Shared notes in another project.');
    log.emit('input.imported', U.ben, { inputId: 'in-other', projectId: 'p-other', kind: 'md', title: 'Other.md', date: '2026-11-24', body, extracts: [], detector: DETECTOR_ID });
    const need = (needId: string, priv: boolean) => ({
      needId,
      projectId: P,
      kind: 'ext' as const,
      title: 'Probe',
      roundId: null,
      source: { src: 'doc' as const, date: '2026-11-24', quote: '', ref: '', inputId: 'in-other' },
      private: priv,
    });
    const codes = log.state.projects[P]!.nextCode;
    for (const priv of [true, false]) {
      // A member of P only, and Ben, who belongs to both projects and owns the shared input.
      rejects(() => log.emit('need.created', U.me, need(`n-me-${priv}`, priv)), 'NOT_FOUND');
      rejects(() => log.emit('need.created', U.ben, need(`n-ben-${priv}`, priv)), 'NOT_FOUND');
    }
    expect(log.state.projects[P]!.nextCode).toEqual(codes);
  });

  it('dashboards are personal: one user’s card set never reaches another', () => {
    const log = withPrivate();
    log.emit('dashboard.set', U.ben, { scope: 'home', cards: ['projects', 'allRisks'] });
    expect(replay(log.streamFor(U.me)).dashboards[`${U.ben}|home`]).toBeUndefined();
    expect(replay(log.streamFor(U.ben)).dashboards[`${U.me}|${P}`]).toBeUndefined();
    rejects(() => log.emit('dashboard.set', U.ben, { scope: P, cards: ['projects'] as never }), 'INVALID_EVENT');
    rejects(() => log.emit('dashboard.set', U.eve, { scope: P, cards: ['progress'] }), 'NOT_A_MEMBER');
  });
});

describe('a shared input never revises a private need (C1)', () => {
  const body = () => toParagraphs('Exports must include all customer fields.');
  const ownNeed = (log: ReturnType<typeof atlas>) =>
    log.emit('need.created', U.me, { needId: 'n-p', projectId: P, kind: 'ext', title: 'My export draft', roundId: null, accept: 'A few fields', source: { src: 'doc', date: '2026-11-24', quote: '', ref: '' }, private: true });
  const extracts = (b: { id: string }[], conflict: boolean) => [
    { id: 'x1', type: 'rev' as const, text: 'All customer fields', paraId: b[0]!.id, needId: 'n-p', conflict },
    { id: 'x2', type: 'new' as const, text: 'Excel export', paraId: b[0]!.id },
  ];
  const importInput = (log: ReturnType<typeof atlas>, id: string, conflict: boolean, priv: boolean) => {
    const b = body();
    log.emit('input.imported', U.me, { inputId: id, projectId: P, kind: 'txt', title: 'mail.txt', date: '2026-11-24', body: b, extracts: extracts(b, conflict), detector: DETECTOR_ID, private: priv });
  };
  /** What Lin's client holds: her filtered stream replays without an error and matches her view. */
  const linMatches = (log: ReturnType<typeof atlas>) => {
    const lin = replay(log.streamFor(U.lin));
    const view = viewFor(log.state, U.lin);
    for (const k of ['needs', 'inputs', 'work', 'artifacts', 'conflicts', 'handoffs'] as const) expect(lin[k], k).toEqual(view[k]);
  };

  it('a shared input may not target a private need with a revision; a private input may', () => {
    for (const conflict of [false, true]) {
      const log = atlas();
      ownNeed(log);
      rejects(() => importInput(log, 'in-s', conflict, false), 'PRIVATE_ITEM');
      expect(log.state.inputs['in-s']).toBeUndefined();
      importInput(log, 'in-p', conflict, true);
      expect(log.state.inputs['in-p']!.extracts[0]).toMatchObject({ type: 'rev', needId: 'n-p', conflict });
      linMatches(log);
    }
  });

  it('a private input is not shared while an undecided revision targets a private need; sharing the need first, or deciding the extract, unblocks it', () => {
    const log = atlas();
    ownNeed(log);
    importInput(log, 'in-p', true, true);
    rejects(() => log.emit('input.shared', U.me, { inputId: 'in-p', snapshot: { input: log.state.inputs['in-p']! } }), 'PRIVATE_ITEM');
    // The refusal names the private needs to share first (or whose extracts to decide), for 「先公开相关的私有需求」.
    expect(() => log.emit('input.shared', U.me, { inputId: 'in-p', snapshot: { input: log.state.inputs['in-p']! } })).toThrow(
      expect.objectContaining({ code: 'PRIVATE_ITEM', details: { needIds: ['n-p'] } }),
    );
    log.emit('need.shared', U.me, { needId: 'n-p', snapshot: { need: log.state.needs['n-p']!, work: [] } });
    log.emit('input.shared', U.me, { inputId: 'in-p', snapshot: { input: log.state.inputs['in-p']! } });
    // The conflict opens now that both sides are shared.
    expect(Object.values(log.state.conflicts)).toMatchObject([{ needId: 'n-p', inputId: 'in-p', status: 'open' }]);
    linMatches(log);

    for (const decide of ['extract.ignored', 'extract.accepted'] as const) {
      const other = atlas();
      ownNeed(other);
      importInput(other, 'in-q', false, true);
      other.emit(decide, U.me, { inputId: 'in-q', extractId: 'x1' });
      if (decide === 'extract.accepted') {
        // A revision from a private input makes the need cite it: the need stays private until the input is shared.
        expect(other.state.work['in-q:x1']!.privateTo).toBe(U.me);
      }
      other.emit('input.shared', U.me, { inputId: 'in-q', snapshot: { input: other.state.inputs['in-q']! } });
      expect(other.state.inputs['in-q']!.privateTo).toBeNull();
      linMatches(other);
    }
  });

  it('accepting a revision gives its work item the need’s privacy, never less', () => {
    const log = atlas();
    ownNeed(log);
    importInput(log, 'in-p', false, true);
    // A state the guards above no longer produce (an old log): the input shared, its revision target still private.
    const s: State = { ...log.state, inputs: { ...log.state.inputs, 'in-p': { ...log.state.inputs['in-p']!, privateTo: null } } };
    const next = applyEvent(s, { seq: s.lastSeq + 1, id: 'e-acc', type: 'extract.accepted', actorId: U.me, recordedAt: log.now(), payload: { inputId: 'in-p', extractId: 'x1' } });
    expect(next.work['in-p:x1']!.privateTo).toBe(U.me);
  });
});

describe('views carry no event bookkeeping (M1)', () => {
  it('viewFor and shareableView hold no seen event ids, so no id or seq of anyone’s private events', () => {
    const log = withPrivate();
    const privateIds = log.events.filter((_, i) => log.scopes[i]!.privateTo === U.me).map((e) => e.id);
    expect(privateIds.length).toBeGreaterThan(0);
    const forBen = viewFor(log.state, U.ben);
    expect(forBen.seenEventIds).toEqual({});
    expect(shareableView(viewFor(log.state, U.me)).seenEventIds).toEqual({});
    expect(shareableView(log.state).seenEventIds).toEqual({});
    const json = JSON.stringify(forBen);
    for (const id of privateIds) expect(json.includes(id), id).toBe(false);
  });
});

describe('a shared input never cites a private need in search or answers', () => {
  it('a need accepted from a private input stays private after the input is shared: other members get no id of it', () => {
    const log = atlas();
    const body = toParagraphs('Zephyr shortlist for the board.');
    log.emit('input.imported', U.me, { inputId: 'in-z', projectId: P, kind: 'md', title: 'notes.md', date: '2026-11-24', body, extracts: [{ id: 'x1', type: 'new', text: 'Zephyr shortlist', paraId: body[0]!.id }], detector: DETECTOR_ID, private: true });
    log.emit('extract.accepted', U.me, { inputId: 'in-z', extractId: 'x1', needId: 'n-priv' });
    log.emit('input.shared', U.me, { inputId: 'in-z', snapshot: { input: log.state.inputs['in-z']! } });
    expect(log.state.needs['n-priv']!.privateTo).toBe(U.me);
    expect(log.state.inputs['in-z']!.extracts[0]!.resultNeedId).toBe('n-priv');

    const forLin = viewFor(log.state, U.lin);
    const hit = search(forLin, { text: 'Zephyr shortlist', projectId: P }).find((h) => h.field === 'paragraph')!;
    expect(hit).toMatchObject({ kind: 'input', id: 'in-z', needId: null });
    const a = answer(forLin, { userId: U.lin, scope: { kind: 'project', projectId: P }, text: 'Zephyr shortlist?', today: '2026-11-24' }).answer;
    expect(JSON.stringify(a)).not.toContain('n-priv');
    for (const id of a.cites) expect(forLin.needs[id]).toBeDefined();

    // The owner still finds it under the need.
    const forMe = viewFor(log.state, U.me);
    expect(search(forMe, { text: 'Zephyr shortlist', projectId: P }).find((h) => h.field === 'paragraph')!.needId).toBe('n-priv');
  });
});

