import { describe, expect, it } from 'vitest';
import { DOT_RE, needByCode, projectNeeds, viewFor, type Id, type State } from '@meetless/core';
import { createTranslator, type Locale } from '@meetless/i18n';
import type { AppApi } from '../../src/renderer/app/AppContext';
import type { Route } from '../../src/renderer/app/routes';
import { NeedDrawer } from '../../src/renderer/needs/NeedDrawer';
import { ShareControls } from '../../src/renderer/needs/NeedDrawer';
import { privateSourceInputIds, SHARE_IDLE, shareClick, shareSteps, shareView, type ShareState } from '../../src/renderer/needs/share';
import { fakeApi, render, sample } from '../support/app';
import { guards } from '../support/guards';
import { Log } from '../support/log';
import { logSubmit } from '../collab/harness';

const PAPER = 'sample-paper';
const ATLAS = 'sample-atlas';
const TODAY = '2026-11-24';
const LOCALES: Locale[] = ['zh-CN', 'en'];
const SRC = { src: 'chat' as const, date: '2026-11-01', quote: 'q', ref: 'r' };

function drawerHtml(live: State, me: Id, locale: Locale, projectId: Id, needId: Id): string {
  const route: Route = { view: 'board', projectId, needId };
  return render(fakeApi({ live, me, locale, route, today: TODAY }), <NeedDrawer projectId={projectId} needId={needId} />);
}

/**
 * A private need (`n1`, project `p1`, user `u-me`) whose source input (`in1`) and one revision's
 * input (`in2`) are both still private: `extract.accepted` with no `roundId` also leaves
 * `autoRound` set, since this project's only round is current.
 */
function privateSourcedNeed(): Log {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
  log.emit('project.created', 'u-me', { projectId: 'p1', name: 'P1' });
  log.emit('round.created', 'u-me', { roundId: 'r1', projectId: 'p1', title: 'Round 1', kind: 'cadence', start: '2026-11-01', due: '2026-11-30' });
  log.emit('input.imported', 'u-me', {
    inputId: 'in1',
    projectId: 'p1',
    kind: 'md',
    title: 'Doc 1',
    date: '2026-11-10',
    body: [{ id: 'b1', text: 'hello' }],
    extracts: [{ id: 'x1', type: 'new', text: 'New need text', paraId: 'b1' }],
    detector: 'rules/1',
    private: true,
  });
  log.emit('extract.accepted', 'u-me', { inputId: 'in1', extractId: 'x1', needId: 'n1' });
  log.emit('input.imported', 'u-me', {
    inputId: 'in2',
    projectId: 'p1',
    kind: 'md',
    title: 'Doc 2',
    date: '2026-11-15',
    body: [{ id: 'b1', text: 'revised wording' }],
    extracts: [{ id: 'x1', type: 'rev', needId: 'n1', text: 'Revised text', paraId: 'b1' }],
    detector: 'rules/1',
    private: true,
  });
  log.emit('extract.accepted', 'u-me', { inputId: 'in2', extractId: 'x1' });
  return log;
}

/**
 * Contract 12.22's second refusal, through core: `n1` comes from the private input `in1`, which
 * also carries an undecided revision of another private need `n2`; `n2` itself comes from the
 * still-private input `in3`. Sharing `in1` is refused `PRIVATE_ITEM { needIds: ['n2'] }`.
 */
function relatedPrivateNeed(): Log {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
  log.emit('project.created', 'u-me', { projectId: 'p1', name: 'P1' });
  log.emit('input.imported', 'u-me', {
    inputId: 'in3',
    projectId: 'p1',
    kind: 'md',
    title: 'Doc 3',
    date: '2026-11-05',
    body: [{ id: 'b1', text: 'other' }],
    extracts: [{ id: 'x1', type: 'new', text: 'Other need', paraId: 'b1' }],
    detector: 'rules/1',
    private: true,
  });
  log.emit('extract.accepted', 'u-me', { inputId: 'in3', extractId: 'x1', needId: 'n2' });
  log.emit('input.imported', 'u-me', {
    inputId: 'in1',
    projectId: 'p1',
    kind: 'md',
    title: 'Doc 1',
    date: '2026-11-10',
    body: [{ id: 'b1', text: 'hello' }, { id: 'b2', text: 'changes the other one' }],
    extracts: [
      { id: 'x1', type: 'new', text: 'New need text', paraId: 'b1' },
      { id: 'x2', type: 'rev', needId: 'n2', text: 'Other need, revised', paraId: 'b2' },
    ],
    detector: 'rules/1',
    private: true,
  });
  log.emit('extract.accepted', 'u-me', { inputId: 'in1', extractId: 'x1', needId: 'n1' });
  return log;
}

/** A need with one captured work item: `work.recorded { capture: true }`, no effect. */
function capturedNeed(): Log {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-cap', displayName: 'Cap', locale: 'en' });
  log.emit('project.created', 'u-cap', { projectId: 'p-cap', name: 'Cap project' });
  log.emit('need.created', 'u-cap', {
    needId: 'n-cap',
    projectId: 'p-cap',
    kind: 'ext',
    title: 'Need with a capture',
    roundId: null,
    source: { src: 'chat', date: '2026-11-18', quote: 'q', ref: 'r' },
  });
  log.emit('work.recorded', 'u-cap', { workId: 'w-cap', projectId: 'p-cap', needId: 'n-cap', src: 'doc', text: 'Captured reference', date: '2026-11-20', capture: true });
  return log;
}

describe('NeedDrawer', () => {
  it('shows source, details, revisions with versions, activity, artifacts and children in prototype order', () => {
    const live = viewFor(sample('en').state, 'u-alex');
    const tr = createTranslator('en');
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const html = drawerHtml(live, 'u-alex', 'en', ATLAS, n2.id);

    expect(html).toContain(tr.t('dr.version', { v: 2 }));
    expect(html).toContain(n2.revisions[0]!.text);

    const at = (needle: string) => {
      const i = html.indexOf(needle);
      expect(i, needle).toBeGreaterThanOrEqual(0);
      return i;
    };
    const iSource = at(tr.t('dr.source'));
    const iMeta = at(tr.t('dr.meta'));
    const iRev = at(tr.t('dr.rev'));
    const iWork = at(tr.t('dr.work'));
    const iArtifacts = at(tr.t('dr.artifacts'));
    const iChildren = at(tr.t('dr.children'));
    expect(iSource).toBeLessThan(iMeta);
    expect(iMeta).toBeLessThan(iRev);
    expect(iRev).toBeLessThan(iWork);
    expect(iWork).toBeLessThan(iArtifacts);
    expect(iArtifacts).toBeLessThan(iChildren);
  });

  it('a capture is labelled cap.label with no effect pill; an agent report shows dr.via', () => {
    const log = capturedNeed();
    const tr = createTranslator('en');
    const capHtml = drawerHtml(log.state, 'u-cap', 'en', 'p-cap', 'n-cap');
    expect(capHtml).toContain(tr.t('cap.label'));
    // Only the capture's own pill: no effect or result pill rides along with it.
    expect(capHtml.split('class="pill').length - 1).toBe(1);

    const live = viewFor(sample('en').state, 'u-alex');
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const html = drawerHtml(live, 'u-alex', 'en', ATLAS, n2.id);
    expect(html).toContain(tr.t('dr.via', { client: 'claude-code' }));
  });

  it('a shared need offers hand off and copy for agent; a private need offers only Share with project', () => {
    const live = viewFor(sample('en').state, 'u-alex');
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const hp1 = Object.values(live.needs).find((n) => n.code === 'Hp1')!;
    const shared = drawerHtml(live, 'u-alex', 'en', ATLAS, n2.id);
    const priv = drawerHtml(live, 'u-alex', 'en', PAPER, hp1.id);

    expect(shared).toContain('data-testid="dr-handoff"');
    expect(shared).toContain('data-testid="dr-link"');
    expect(priv).not.toContain('data-testid="dr-handoff"');
    expect(priv).not.toContain('data-testid="dr-link"');
    expect(priv).toContain('data-testid="dr-share"');

    const tr = createTranslator('en');
    expect(priv).toContain(tr.t('pv.publish'));
    expect(priv).not.toContain(tr.t('common.shareSourceFirst'));
  });

  it('a private need whose source input is still private offers common.shareSourceFirst, not pv.publish', () => {
    const log = privateSourcedNeed();
    const tr = createTranslator('en');
    const html = drawerHtml(log.state, 'u-me', 'en', 'p1', 'n1');
    expect(html).toContain('data-testid="dr-share"');
    expect(html).toContain(tr.t('common.shareSourceFirst'));
    expect(html).not.toContain(tr.t('pv.publish'));
  });

  it('a rule-filled round shows RulesMark; a set round does not', () => {
    const tr = createTranslator('en');
    const ruleLog = privateSourcedNeed();
    expect(ruleLog.state.needs['n1']!.autoRound).toBe(true);
    const ruleHtml = drawerHtml(ruleLog.state, 'u-me', 'en', 'p1', 'n1');
    expect(ruleHtml).toContain(tr.t('ai.rules'));

    const live = viewFor(sample('en').state, 'u-alex');
    const n1 = needByCode(live, ATLAS, 'N1')!;
    expect(n1.autoRound).toBe(false);
    const setHtml = drawerHtml(live, 'u-alex', 'en', ATLAS, n1.id);
    expect(setHtml).not.toContain(tr.t('ai.rules'));
  });

  it('Atlas N1 shows the pending line for Alex', () => {
    const live = viewFor(sample('en').state, 'u-alex');
    const n1 = needByCode(live, ATLAS, 'N1')!;
    const html = drawerHtml(live, 'u-alex', 'en', ATLAS, n1.id);
    expect(html).toContain('data-testid="dr-pending"');
  });

  it('an unknown need id renders dr.missing', () => {
    const live = viewFor(sample('en').state, 'u-alex');
    const tr = createTranslator('en');
    const html = drawerHtml(live, 'u-alex', 'en', ATLAS, 'does-not-exist');
    expect(html).toContain(tr.t('dr.missing'));
    expect(html).toContain('data-testid="drawer" data-need="does-not-exist"');
  });

  it.each(LOCALES)('a representative drawer has no dot, no mark before a need code and no non-geometry inline style (%s)', (locale) => {
    const live = viewFor(sample(locale).state, 'u-alex');
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const hp1 = Object.values(live.needs).find((n) => n.code === 'Hp1')!;
    guards(`drawer N2 ${locale}`, drawerHtml(live, 'u-alex', locale, ATLAS, n2.id));
    guards(`drawer Hp1 ${locale}`, drawerHtml(live, 'u-alex', locale, PAPER, hp1.id));
  });

  it.each(LOCALES)('no drawer of any sample need contains a dot symbol (%s)', (locale) => {
    const live = viewFor(sample(locale).state, 'u-alex');
    for (const n of [...projectNeeds(live, PAPER), ...projectNeeds(live, ATLAS)]) {
      expect(DOT_RE.test(drawerHtml(live, 'u-alex', locale, n.projectId, n.id)), n.code).toBe(false);
    }
  });
});

describe('needs/share', () => {
  it('shareSteps shares the source input, then each revision input, source first, before need.shared', () => {
    const log = privateSourcedNeed();
    const need = log.state.needs['n1']!;
    expect(privateSourceInputIds(log.state, need)).toEqual(['in1', 'in2']);
    expect(shareSteps(log.state, need)).toEqual([
      { type: 'input.shared', payload: { inputId: 'in1' } },
      { type: 'input.shared', payload: { inputId: 'in2' } },
      { type: 'need.shared', payload: { needId: 'n1' } },
    ]);
  });

  it('shareSteps is just need.shared once the source inputs are already shared', () => {
    const log = privateSourcedNeed();
    log.emit('input.shared', 'u-me', { inputId: 'in1' });
    log.emit('input.shared', 'u-me', { inputId: 'in2' });
    const need = log.state.needs['n1']!;
    expect(shareSteps(log.state, need)).toEqual([{ type: 'need.shared', payload: { needId: 'n1' } }]);
  });

  it('a click stops at the first rejection and never sends a later step', async () => {
    const calls: { type: string; payload: unknown }[] = [];
    const submit = (async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      return calls.length === 1 ? { kind: 'accepted', seq: 1 } : { kind: 'rejected', code: 'NOT_AUTHORISED' };
    }) as unknown as AppApi['submit'];
    const log = privateSourcedNeed();
    const next = await shareClick(log.state, log.state.needs['n1']!, SHARE_IDLE, submit);
    expect(next).toEqual(SHARE_IDLE);
    expect(calls).toEqual([
      { type: 'input.shared', payload: { inputId: 'in1' } },
      { type: 'input.shared', payload: { inputId: 'in2' } },
    ]);
  });

  it('a click runs every step when none is rejected (queued still moves on)', async () => {
    const calls: string[] = [];
    const submit = (async (type: string) => {
      calls.push(type);
      return { kind: 'queued' };
    }) as unknown as AppApi['submit'];
    const log = privateSourcedNeed();
    expect(await shareClick(log.state, log.state.needs['n1']!, SHARE_IDLE, submit)).toEqual(SHARE_IDLE);
    expect(calls).toEqual(['input.shared', 'input.shared', 'need.shared']);
  });

  it('an input.shared PRIVATE_ITEM refusal naming other needs stops there, publishes nothing more and keeps the ids (deduped)', async () => {
    const calls: { type: string; payload: unknown }[] = [];
    const submit = (async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      return type === 'input.shared'
        ? { kind: 'rejected', code: 'PRIVATE_ITEM', details: { needIds: ['n-other', 'n-other'] } }
        : { kind: 'accepted', seq: calls.length };
    }) as unknown as AppApi['submit'];
    const log = privateSourcedNeed();
    const next = await shareClick(log.state, log.state.needs['n1']!, SHARE_IDLE, submit);
    expect(next).toEqual({ kind: 'needFirst', needIds: ['n-other'] });
    expect(calls).toEqual([{ type: 'input.shared', payload: { inputId: 'in1' } }]);
  });

  it('an input.shared PRIVATE_ITEM refusal naming the need being shared itself stops with decideFirst', async () => {
    const calls: { type: string; payload: unknown }[] = [];
    const submit = (async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      return type === 'input.shared'
        ? { kind: 'rejected', code: 'PRIVATE_ITEM', details: { needIds: ['n1'] } }
        : { kind: 'accepted', seq: calls.length };
    }) as unknown as AppApi['submit'];
    const log = privateSourcedNeed();
    expect(await shareClick(log.state, log.state.needs['n1']!, SHARE_IDLE, submit)).toEqual({ kind: 'decideFirst' });
    // Stops immediately: no need.shared for n1 is attempted, and in2 is never reached.
    expect(calls).toEqual([{ type: 'input.shared', payload: { inputId: 'in1' } }]);
  });

  it('an input.shared PRIVATE_ITEM refusal with malformed details just stops, like any other unhandled rejection', async () => {
    const calls: { type: string; payload: unknown }[] = [];
    const submit = (async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      return { kind: 'rejected', code: 'PRIVATE_ITEM', details: { needIds: 'not-an-array' } };
    }) as unknown as AppApi['submit'];
    const log = privateSourcedNeed();
    expect(await shareClick(log.state, log.state.needs['n1']!, SHARE_IDLE, submit)).toEqual(SHARE_IDLE);
    expect(calls).toEqual([{ type: 'input.shared', payload: { inputId: 'in1' } }]);
  });

  it('through core: the first click stops at the other need; the second shares it share-first (its own private source too), then the input, then this need', async () => {
    const log = relatedPrivateNeed();
    const { calls, submit } = logSubmit(log, 'u-me');

    const first = await shareClick(log.state, log.state.needs['n1']!, SHARE_IDLE, submit);
    expect(first).toEqual({ kind: 'needFirst', needIds: ['n2'] });
    expect(calls.map((c) => c.type)).toEqual(['input.shared']);
    // Nothing of n2's was published by the first click.
    expect(log.state.needs['n2']!.privateTo).toBe('u-me');
    expect(log.state.inputs['in3']!.privateTo).toBe('u-me');
    expect(log.state.inputs['in1']!.privateTo).toBe('u-me');

    // The label names the other need before anything of it is published.
    const view = shareView(log.state, log.state.needs['n1']!, first);
    expect(view.label).toBe('common.sharePrivateNeedFirst');
    expect(view.also).toEqual([log.state.needs['n2']!.code]);

    const second = await shareClick(log.state, log.state.needs['n1']!, first, submit);
    expect(second).toEqual(SHARE_IDLE);
    expect(calls.slice(1)).toEqual([
      { type: 'input.shared', payload: { inputId: 'in3' } },
      { type: 'need.shared', payload: { needId: 'n2' } },
      { type: 'input.shared', payload: { inputId: 'in1' } },
      { type: 'need.shared', payload: { needId: 'n1' } },
    ]);
    for (const id of ['n1', 'n2']) expect(log.state.needs[id]!.privateTo).toBeNull();
    for (const id of ['in1', 'in3']) expect(log.state.inputs[id]!.privateTo).toBeNull();
  });

  it('through core: a refusal inside the other need’s own steps stops with decideFirst', async () => {
    const log = relatedPrivateNeed();
    // n2 gets a private parent: its need.shared is refused PRIVATE_ITEM after its source input is shared.
    log.emit('need.created', 'u-me', { needId: 'n-parent', projectId: 'p1', kind: 'ext', title: 'Parent', roundId: null, source: SRC, private: true });
    log.emit('need.updated', 'u-me', { needId: 'n2', parentId: 'n-parent' });
    expect(log.state.needs['n2']!.parentId).toBe('n-parent');
    const { calls, submit } = logSubmit(log, 'u-me');
    const first = await shareClick(log.state, log.state.needs['n1']!, SHARE_IDLE, submit);
    const second = await shareClick(log.state, log.state.needs['n1']!, first, submit);
    expect(second).toEqual({ kind: 'decideFirst' });
    expect(calls.map((c) => c.type)).toEqual(['input.shared', 'input.shared', 'need.shared']);
    // The need being shared and its input stay private.
    expect(log.state.needs['n1']!.privateTo).toBe('u-me');
    expect(log.state.inputs['in1']!.privateTo).toBe('u-me');
  });

  it('through core: the circular case (the input’s undecided revision targets this need) stops with decideFirst', async () => {
    const log = privateSourcedNeed();
    // in2 also carries a second, undecided revision of n1: sharing in2 would expose n1.
    log.emit('input.imported', 'u-me', {
      inputId: 'in4',
      projectId: 'p1',
      kind: 'md',
      title: 'Doc 4',
      date: '2026-11-16',
      body: [{ id: 'b1', text: 'more' }, { id: 'b2', text: 'again' }],
      extracts: [
        { id: 'x1', type: 'rev', needId: 'n1', text: 'Taken', paraId: 'b1' },
        { id: 'x2', type: 'rev', needId: 'n1', text: 'Undecided', paraId: 'b2' },
      ],
      detector: 'rules/1',
      private: true,
    });
    log.emit('extract.accepted', 'u-me', { inputId: 'in4', extractId: 'x1' });
    const { calls, submit } = logSubmit(log, 'u-me');
    const next = await shareClick(log.state, log.state.needs['n1']!, SHARE_IDLE, submit);
    expect(next).toEqual({ kind: 'decideFirst' });
    expect(calls.map((c) => (c.payload as { inputId?: string }).inputId)).toEqual(['in1', 'in2', 'in4']);
    expect(log.state.needs['n1']!.privateTo).toBe('u-me');
  });

  it('shareView: the label and hint for each state; ids already shared drop out', () => {
    const log = relatedPrivateNeed();
    const n1 = log.state.needs['n1']!;
    expect(shareView(log.state, n1, SHARE_IDLE)).toEqual({ label: 'common.shareSourceFirst', also: [], decideFirst: false });
    expect(shareView(log.state, n1, { kind: 'decideFirst' })).toEqual({ label: 'common.shareSourceFirst', also: [], decideFirst: true });
    expect(shareView(log.state, n1, { kind: 'needFirst', needIds: ['n2', 'gone'] }).also).toEqual([log.state.needs['n2']!.code]);
    log.emit('input.shared', 'u-me', { inputId: 'in3' });
    log.emit('need.shared', 'u-me', { needId: 'n2' });
    expect(shareView(log.state, n1, { kind: 'needFirst', needIds: ['n2'] })).toEqual({ label: 'common.shareSourceFirst', also: [], decideFirst: false });
  });

  it.each(LOCALES)('ShareControls renders the related-need label with its codes, and the decide-first hint with dr-share-review (%s)', (locale) => {
    const log = relatedPrivateNeed();
    const tr = createTranslator(locale);
    const n1 = log.state.needs['n1']!;
    const code = log.state.needs['n2']!.code;
    const api = fakeApi({ live: log.state, me: 'u-me', locale, today: TODAY });
    const at = (share: ShareState) => render(api, <ShareControls projectId="p1" need={n1} busy={false} share={share} onShare={() => undefined} />);

    const needFirst = at({ kind: 'needFirst', needIds: ['n2'] });
    expect(needFirst).toContain(tr.t('common.sharePrivateNeedFirst'));
    expect(needFirst).toContain(tr.t('dr.shareAlso', { codes: code }));
    expect(needFirst).toContain('data-testid="dr-share-review"');
    guards(`share needFirst ${locale}`, needFirst);

    const decide = at({ kind: 'decideFirst' });
    expect(decide).toContain(tr.t('dr.decideFirst'));
    expect(decide).not.toContain(tr.t('common.sharePrivateNeedFirst'));
    expect(decide).toContain('data-testid="dr-share-review"');
    guards(`share decideFirst ${locale}`, decide);

    const idle = at(SHARE_IDLE);
    expect(idle).toContain(tr.t('common.shareSourceFirst'));
    expect(idle).not.toContain('data-testid="dr-share-review"');
  });

  it.each(LOCALES)('common.sharePrivateNeedFirst, dr.shareAlso, dr.decideFirst and dr.review exist (%s)', (locale) => {
    const tr = createTranslator(locale);
    for (const k of ['common.sharePrivateNeedFirst', 'dr.shareAlso', 'dr.decideFirst', 'dr.review']) expect(tr.has(k), k).toBe(true);
  });
});
