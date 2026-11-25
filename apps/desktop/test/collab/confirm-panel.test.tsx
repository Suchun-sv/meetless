import { describe, expect, it } from 'vitest';
import { DOT_RE, needByCode, projectRounds, SEP, userName, type Id, type State } from '@meetless/core';
import { createTranslator, formatDay, type Locale } from '@meetless/i18n';
import { ConfirmPanel, DoneRows } from '../../src/renderer/collab/ConfirmPanel';
import { ConflictItem, ExtractItem, HandoffPick, ProposalItem, QuestionItem, decisionHandoff } from '../../src/renderer/collab/ConfirmItems';
import { confirmItems, conflictCommand, linkTargets, unlinkedSuggestion, type ConfirmItem } from '../../src/renderer/collab/confirm';
import { handoffPeople } from '../../src/renderer/collab/model';
import { fakeApi, render, sample } from '../support/app';
import { clientState } from '../support/client-state';
import { guards } from '../support/guards';
import { Log } from '../support/log';
import { click, findAll, recorder, tree } from './harness';

const ATLAS = 'sample-atlas';
const PAPER = 'sample-paper';
const TODAY = '2026-11-24';
const LOCALES: Locale[] = ['zh-CN', 'en'];

const count = (html: string, needle: string) => html.split(needle).length - 1;

type Item<K extends ConfirmItem['kind']> = Extract<ConfirmItem, { kind: K }>;
function panelHtml(live: State, me: Id, projectId: Id, locale: Locale = 'en'): string {
  const overlay = { kind: 'confirm' as const, projectId };
  return render(fakeApi({ live, me, locale, today: TODAY, overlay }), <ConfirmPanel overlay={overlay} />);
}

/** Each `ask-item` of the panel: its kind, its id and its markup up to the next item. */
function itemsOf(html: string): { kind: string; id: string; html: string }[] {
  return html
    .split('data-testid="ask-item"')
    .slice(1)
    .map((seg) => ({ kind: /data-kind="([^"]*)"/.exec(seg)![1]!, id: /data-id="([^"]*)"/.exec(seg)![1]!, html: seg }));
}

function itemOf<K extends ConfirmItem['kind']>(live: State, me: Id, projectId: Id, kind: K): Item<K> {
  const it = confirmItems(live, me, projectId, TODAY).find((i) => i.kind === kind);
  if (!it) throw new Error(`no ${kind} item`);
  return it as Item<K>;
}

const base = (log: Log, ids: [Id, string][]) => {
  for (const [id, name] of ids) log.emit('user.registered', 'system', { userId: id, displayName: name, locale: 'en' });
};

/** Two members, one need in conflict with a freshly imported document (as in confirm.test.ts). */
function conflictFixture(): { log: Log; conflictId: string } {
  const log = new Log();
  base(log, [
    ['u-alex', 'Alex'],
    ['u-lin', 'Lin'],
  ]);
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
  return { log, conflictId: Object.keys(log.state.conflicts)[0]! };
}

/** A shared need of `kind`, idle well past STALE_IDLE_DAYS, in a round due within STALE_DUE_DAYS; `withNext` adds a planned round 2. */
function staleFixture(kind: 'ext' | 'hyp', withNext: boolean): Log {
  const log = new Log();
  base(log, [['u-me', 'Me']]);
  log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
  log.emit('round.created', 'u-me', { roundId: 'r1', projectId: 'p', title: 'R1', kind: 'cadence', start: '2026-11-01', due: '2026-11-30' });
  if (withNext) log.emit('round.created', 'u-me', { roundId: 'r2', projectId: 'p', title: 'R2', kind: 'cadence', start: '2026-12-01', due: '2026-12-31' });
  log.emit('need.created', 'u-me', {
    needId: 'n-stale',
    projectId: 'p',
    kind,
    title: 'Needs attention',
    roundId: 'r1',
    source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
  });
  return log;
}

/** One need whose code the unlinked commit names, so the rule suggests it. */
function suggestionFixture(): Log {
  const log = new Log();
  base(log, [['u-me', 'Me']]);
  log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
  log.emit('need.created', 'u-me', {
    needId: 'n1',
    projectId: 'p',
    kind: 'ext',
    title: 'Cache layer for search results',
    roundId: null,
    source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
  });
  log.emit('work.recorded', 'u-me', { workId: 'w1', projectId: 'p', needId: null, src: 'commit', text: 'N1 add cache table for search results', date: '2026-11-10' });
  return log;
}

/** Two open agent proposals for `u-me`: one via claude-code, one with no client. */
function proposalFixture(): Log {
  const log = new Log();
  base(log, [
    ['u-me', 'Me'],
    ['u-bot', 'Bot user'],
  ]);
  log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
  log.emit('project.member_added', 'u-me', { projectId: 'p', userId: 'u-bot' });
  log.emit('round.created', 'u-me', { roundId: 'r1', projectId: 'p', title: 'R1', kind: 'cadence', start: '2026-11-01', due: '2026-12-01' });
  log.emit('proposal.created', 'u-bot', { proposalId: 'pr1', projectId: 'p', kind: 'ext', title: 'Add retries', why: 'flaky network', via: { client: 'claude-code', tokenId: 't1' } });
  log.emit('proposal.created', 'u-bot', { proposalId: 'pr2', projectId: 'p', kind: 'hyp', title: 'Batching helps', via: null });
  return log;
}

describe('ConfirmPanel', () => {
  it('Atlas for Alex: the N1 conflict side by side with three ways to decide', () => {
    const { state } = sample('en');
    const t = createTranslator('en').t;
    const html = panelHtml(state, 'u-alex', ATLAS);
    const c = itemOf(state, 'u-alex', ATLAS, 'conflict').conflict;

    expect(html).toContain('data-testid="overlay-confirm"');
    expect(html).toMatch(/data-kind="conflict"/);
    expect(html).toContain('class="q qc"');
    expect(html).toContain(`data-id="${c.id}"`);
    expect(html).toContain('class="pill tone-warning"');
    expect(html).toContain(t('cf.title'));
    expect(html).toContain(t('cf.q', { need: 'N1' }));
    expect(html).toContain('class="cf"');
    expect(html).toContain(t('cf.old', { need: 'N1' }));
    expect(html).toContain(c.old);
    expect(html).toContain('class="cf-b neu"');
    expect(html).toContain(t('cf.new') + SEP + c.src);
    expect(html).toContain(c.neu);
    expect(html).toContain(t('cf.why'));
    expect(html).toContain(t('cf.revise', { need: 'N1' }));
    expect(html).toContain('data-testid="cf-revise"');
    expect(html).toContain(t('cf.park', { need: 'N1' }));
    expect(html).toContain('data-testid="cf-handoff"');
    expect(html).toContain(t('cf.handoff'));
    const open = projectRounds(state, ATLAS).filter((r) => r.status !== 'delivered');
    expect(count(html, 'data-testid="cf-park"')).toBe(open.length + 1);
    for (const r of open) expect(html).toContain(`data-round="${r.id}"`);
    expect(html).toContain(t('cf.parkNone'));
    // The person list opens only on cf-handoff.
    expect(html).not.toContain('data-testid="cf-person"');
  });

  it('paper for Alex: the unlinked commit offers other needs, a new hypothesis and ignore; a suggestion when the rule finds one', () => {
    const { state } = sample('en');
    const t = createTranslator('en').t;
    const q = itemOf(state, 'u-alex', PAPER, 'question').question;
    expect(q.kind).toBe('unlinked');
    const w = state.work[(q as { workId: Id }).workId]!;
    const html = panelHtml(state, 'u-alex', PAPER);
    const item = itemsOf(html).find((i) => i.kind === 'question')!;

    expect(item.html).toContain(t('ask.q.unlinked', { work: w.text }));
    expect(item.html).toContain(t('src.commit'));
    expect(item.html).toContain(formatDay(w.date, 'en'));
    expect(item.html).toContain('data-testid="q-link-other"');
    expect(item.html).toContain(t('ask.linkOther'));
    for (const n of linkTargets(state, w)) expect(item.html).toContain(`value="${n.id}"`);
    expect(item.html).toContain('data-testid="q-new"');
    expect(item.html).toContain(t('ask.newHyp'));
    expect(item.html).toContain('data-testid="q-ignore"');
    expect(item.html).toContain(t('ask.skip'));
    // The sample's commit names no need the rule can match, so there is no one-click suggestion.
    expect(unlinkedSuggestion(state, w)).toBeNull();
    expect(item.html).not.toContain('data-testid="q-link"');

    const log = suggestionFixture();
    const sug = panelHtml(log.state, 'u-me', 'p');
    expect(sug).toContain('data-testid="q-link"');
    expect(sug).toContain('data-need="n1"');
    expect(sug).toContain(t('ask.link', { need: 'N1' }));
    // The suggestion is not repeated among the other needs.
    expect(sug).not.toContain('value="n1"');
  });

  it('a stale question (Log fixture) offers drop or park by kind, and the next round when there is one', () => {
    const t = createTranslator('en').t;
    const extNoNext = staleFixture('ext', false);
    const q = itemOf(extNoNext.state, 'u-me', 'p', 'question').question as { kind: 'stale'; idleDays: number; daysLeft: number };
    expect(q.kind).toBe('stale');
    const a = panelHtml(extNoNext.state, 'u-me', 'p');
    expect(a).toContain(t('ask.q.stale', { need: 'N1', idle: q.idleDays, left: q.daysLeft }));
    expect(a).toContain('class="needchip"');
    expect(a).toContain('data-testid="q-drop"');
    expect(a).toContain(t('ask.drop'));
    expect(a).not.toContain('data-testid="q-park"');
    expect(a).not.toContain('data-testid="q-next"');

    const ext = panelHtml(staleFixture('ext', true).state, 'u-me', 'p');
    expect(ext).toContain('data-testid="q-drop"');
    expect(ext).toContain('data-testid="q-next"');
    expect(ext).toContain(t('ask.next', { n: 2 }));

    const hyp = panelHtml(staleFixture('hyp', true).state, 'u-me', 'p');
    expect(hyp).toContain('data-testid="q-park"');
    expect(hyp).toContain(t('ask.park'));
    expect(hyp).toContain('data-testid="q-next"');
    expect(hyp).not.toContain('data-testid="q-drop"');
  });

  it('extracts and proposals render with their own actions; rule items carry RulesMark, proposals pr.by', () => {
    const t = createTranslator('en').t;
    const { state } = sample('en');
    const paper = panelHtml(state, 'u-alex', PAPER);
    const items = itemsOf(paper);
    const extracts = items.filter((i) => i.kind === 'extract');
    expect(extracts.length).toBe(3);
    for (const x of extracts) {
      expect(x.html).toContain('data-testid="x-accept"');
      expect(x.html).toContain('data-testid="x-ignore"');
      expect(x.html).toContain(t('ask.accept'));
      expect(x.html).toContain(t('ask.ignore'));
      expect(x.html).toContain(t('ask.from', { title: 'Mia: ablation suggestions.docx' }));
    }
    const rev = extracts.find((x) => x.html.includes(t('ask.xt.rev')))!;
    const n7 = needByCode(state, PAPER, 'N7')!;
    expect(rev.html).toContain('class="needchip"');
    expect(rev.html).toContain(n7.title.slice(0, 20));
    expect(extracts.some((x) => x.html.includes(t('ask.xt.hyp')))).toBe(true);
    expect(extracts.some((x) => x.html.includes(t('ask.xt.new')))).toBe(true);
    expect(paper).toMatch(/data-testid="x-accept"[^>]*class="btn btn-primary"|class="btn btn-primary"[^>]*data-testid="x-accept"/);
    // Every conflict, question and extract is rule output.
    for (const i of [...items, ...itemsOf(panelHtml(state, 'u-alex', ATLAS))]) expect(i.html, i.id).toContain(t('ai.rules'));

    const log = proposalFixture();
    const prs = itemsOf(panelHtml(log.state, 'u-me', 'p')).filter((i) => i.kind === 'proposal');
    expect(prs.map((p) => p.id)).toEqual(['pr1', 'pr2']);
    for (const p of prs) {
      expect(p.html).toContain(t('pr.title'));
      expect(p.html).toContain('data-testid="pr-accept"');
      expect(p.html).toContain('data-testid="pr-reject"');
      expect(p.html).toContain(t('pr.accept'));
      expect(p.html).toContain(t('pr.reject'));
      expect(p.html).not.toContain(t('ai.rules'));
    }
    expect(prs[0]!.html).toContain('Add retries');
    expect(prs[0]!.html).toContain('flaky network');
    expect(prs[0]!.html).toContain(t('pr.by', { who: 'Bot user', client: 'claude-code' }));
    expect(prs[1]!.html).toContain(t('pr.by', { who: 'Bot user', client: t('src.agent') }));
  });

  it('the delegator sees Waiting for, the delegate sees the reason', () => {
    const t = createTranslator('en').t;
    const { log, conflictId } = conflictFixture();
    const cmd = conflictCommand(log.state.conflicts[conflictId]!, { kind: 'handoff', handoffId: 'h1', toId: 'u-lin', ask: 'your call', due: null });
    log.emit(cmd.type, 'u-alex', cmd.payload);
    const after = log.state;

    const alex = panelHtml(clientState(log, 'u-alex'), 'u-alex', 'P');
    expect(alex).toContain(t('ask.waiting', { who: userName(after, 'u-lin') }));
    expect(alex).toContain('data-testid="ask-waiting"');
    expect(alex).not.toContain('data-testid="cf-revise"');
    expect(alex).not.toContain('data-testid="ask-item"');
    expect(alex).toContain(t('ask.empty'));
    const waiting = alex.slice(alex.indexOf('data-testid="ask-waiting"'));
    expect(waiting).not.toContain('<button');

    const lin = panelHtml(clientState(log, 'u-lin'), 'u-lin', 'P');
    expect(lin).toContain(t('cf.whyDelegated', { who: userName(after, 'u-alex') }));
    expect(lin).not.toContain(t('cf.why'));
    expect(lin).toContain('data-testid="cf-revise"');
    expect(lin).not.toContain('data-testid="ask-waiting"');
  });

  it('the need’s owner who did not import the input is told it is their need, not that they imported it', () => {
    const t = createTranslator('en').t;
    const { log } = conflictFixture();
    log.emit('need.updated', 'u-alex', { needId: 'n1', ownerId: 'u-lin' });
    const lin = panelHtml(clientState(log, 'u-lin'), 'u-lin', 'P');
    expect(lin).toContain('data-testid="cf-revise"');
    expect(lin).toContain(t('cf.whyOwner'));
    expect(lin).not.toContain(t('cf.why'));
    const alex = panelHtml(clientState(log, 'u-alex'), 'u-alex', 'P');
    expect(alex).toContain(t('cf.why'));
    expect(alex).not.toContain(t('cf.whyOwner'));
  });

  it('the three conflict options are equal siblings: revise, keep-and-park (a box with its chips), hand off', () => {
    const { state } = sample('en');
    const item = itemOf(state, 'u-alex', ATLAS, 'conflict');
    const html = render(fakeApi({ live: state, me: 'u-alex', today: TODAY }), <ConflictItem item={item} projectId={ATLAS} onDone={() => undefined} />);
    const block = html.slice(html.indexOf('class="q-opts"'));
    const iRevise = block.indexOf('data-testid="cf-revise"');
    const iPark = block.indexOf('class="q-park"');
    const iHandoff = block.indexOf('data-testid="cf-handoff"');
    expect(iRevise).toBeGreaterThan(0);
    expect(iPark).toBeGreaterThan(iRevise);
    expect(iHandoff).toBeGreaterThan(iPark);
    // The park label is plain option text, not a small or muted caption.
    const park = block.slice(iPark, iHandoff);
    expect(park).toMatch(/<span>[^<]*N1[^<]*<\/span>/);
    expect(park).not.toMatch(/class="(small|muted|faint)"/);
    // None of the options starts out disabled.
    expect(block.slice(0, iHandoff + 60)).not.toContain('disabled=""');
  });

  it('an empty panel says ask.empty; ask.sub is the reworded copy', () => {
    const log = new Log();
    base(log, [['u-me', 'Me']]);
    log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    const en = panelHtml(log.state, 'u-me', 'p', 'en');
    expect(en).toContain('Nothing to confirm');
    expect(en).toContain('class="empty-ask"');
    expect(en).toContain('Needs your confirmation');
    expect(en).toContain('Detected items, conflicts, proposals and questions land here.');
    expect(en).not.toContain('Everything else is sorted automatically');
    expect(en).not.toContain('data-testid="ask-item"');
    const zh = panelHtml(log.state, 'u-me', 'p', 'zh-CN');
    expect(zh).toContain('没有待确认的事项');
    expect(zh).toContain('识别结果、冲突、提议和疑问都在这里。');
    expect(zh).not.toContain('其余已自动整理');

    const { state } = sample('en');
    expect(panelHtml(state, 'u-alex', ATLAS)).not.toContain('class="empty-ask"');
  });

  it('answered items show as done rows: ✓ ask.answered, SEP and the label', () => {
    for (const locale of LOCALES) {
      const t = createTranslator(locale).t;
      const { state } = sample(locale);
      const html = render(fakeApi({ live: state, me: 'u-alex', locale }), <DoneRows done={[{ id: 'a', label: t('cf.resolved.revise', { need: 'N1' }) }]} />);
      expect(html).toContain('class="q done"');
      expect(html).toContain('class="small ok"');
      expect(html).toContain(`✓ ${t('ask.answered')}${SEP}${t('cf.resolved.revise', { need: 'N1' })}`);
      guards(`done rows ${locale}`, html);
    }
  });

  it.each(LOCALES)('no To confirm panel contains a dot symbol (%s)', (locale) => {
    const { state } = sample(locale);
    for (const p of [PAPER, ATLAS]) {
      for (const me of ['u-alex', 'u-lin']) {
        const html = panelHtml(state, me, p, locale);
        expect(DOT_RE.test(html)).toBe(false);
        guards(`confirm ${p} ${me} ${locale}`, html);
      }
    }
    const { log, conflictId } = conflictFixture();
    const cmd = conflictCommand(log.state.conflicts[conflictId]!, { kind: 'handoff', handoffId: 'h1', toId: 'u-lin', ask: 'your call', due: null });
    log.emit(cmd.type, 'u-alex', cmd.payload);
    guards(`confirm delegated lin ${locale}`, panelHtml(clientState(log, 'u-lin'), 'u-lin', 'P', locale));
    guards(`confirm delegated alex ${locale}`, panelHtml(clientState(log, 'u-alex'), 'u-alex', 'P', locale));
    guards(`confirm stale ${locale}`, panelHtml(staleFixture('hyp', true).state, 'u-me', 'p', locale));
    guards(`confirm proposals ${locale}`, panelHtml(proposalFixture().state, 'u-me', 'p', locale));
    guards(`confirm suggestion ${locale}`, panelHtml(suggestionFixture().state, 'u-me', 'p', locale));
    const pick = render(fakeApi({ live: state, me: 'u-alex', locale }), <HandoffPick projectId={ATLAS} busy={false} onSend={() => undefined} />);
    guards(`confirm pick ${locale}`, pick);
  });
});

describe('answering an item', () => {
  it('cf-revise submits revise and reports the label; a rejection keeps the item', async () => {
    const { state } = sample('en');
    const t = createTranslator('en').t;
    const item = itemOf(state, 'u-alex', ATLAS, 'conflict');
    const done: string[] = [];
    const ok = recorder();
    await click(ok.api(state, 'u-alex'), () => ConflictItem({ item, projectId: ATLAS, onDone: (l) => void done.push(l) }), 'cf-revise');
    expect(ok.calls).toEqual([{ type: 'conflict.resolved', payload: { conflictId: item.id, resolution: 'revise' } }]);
    expect(done).toEqual([t('cf.resolved.revise', { need: 'N1' })]);

    const no = recorder([{ kind: 'rejected', code: 'FORBIDDEN' }]);
    await click(no.api(state, 'u-alex'), () => ConflictItem({ item, projectId: ATLAS, onDone: (l) => void done.push(l) }), 'cf-revise');
    expect(no.calls.length).toBe(1);
    expect(done.length).toBe(1);
  });

  it('cf-park chips park into a round, or into no round', async () => {
    const { state } = sample('en');
    const t = createTranslator('en').t;
    const item = itemOf(state, 'u-alex', ATLAS, 'conflict');
    const open = projectRounds(state, ATLAS).filter((r) => r.status !== 'delivered');
    const done: string[] = [];
    const rec = recorder();
    const api = rec.api(state, 'u-alex');
    const Comp = () => ConflictItem({ item, projectId: ATLAS, onDone: (l) => void done.push(l) });
    await click(api, Comp, 'cf-park', 0);
    await click(api, Comp, 'cf-park', open.length);
    expect(rec.calls.map((c) => c.payload.roundId)).toEqual([open[0]!.id, null]);
    for (const c of rec.calls) {
      expect(c.type).toBe('conflict.resolved');
      expect(c.payload).toMatchObject({ conflictId: item.id, resolution: 'park' });
      expect(c.payload.needId).toMatch(/^n-/);
    }
    expect(rec.calls[0]!.payload.needId).not.toBe(rec.calls[1]!.payload.needId);
    expect(done).toEqual([t('cf.resolved.park', { need: 'N1' }), t('cf.resolved.park', { need: 'N1' })]);
  });

  it('the handoff pick lists people (never me), sends to the first by default, and says ho.nobody when alone', async () => {
    const { state } = sample('en');
    const t = createTranslator('en').t;
    const html = render(fakeApi({ live: state, me: 'u-alex' }), <HandoffPick projectId={ATLAS} busy={false} onSend={() => undefined} />);
    const ids = handoffPeople(state, ATLAS, 'u-alex').flatMap((g) => g.memberIds);
    expect(html).toContain(t('cf.pick'));
    expect(count(html, 'data-testid="cf-person"')).toBe(ids.length);
    expect(html).not.toContain('data-person="u-alex"');
    expect(html).toContain('data-testid="cf-send"');
    expect(html).toContain(t('cf.send'));

    const sent: Id[] = [];
    await click(fakeApi({ live: state, me: 'u-alex' }), () => HandoffPick({ projectId: ATLAS, busy: false, onSend: (id) => void sent.push(id) }), 'cf-send');
    expect(sent).toEqual([ids[0]]);

    const solo = new Log();
    base(solo, [['u-me', 'Me']]);
    solo.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    const alone = render(fakeApi({ live: solo.state, me: 'u-me' }), <HandoffPick projectId="p" busy={false} onSend={() => undefined} />);
    expect(alone).toContain(t('ho.nobody'));
    expect(alone).not.toContain('data-testid="cf-send"');
    expect(alone).not.toContain('data-testid="cf-person"');
  });

  it('the decision handoff asks cf.handoffAsk with the current round due date', () => {
    const { state } = sample('en');
    const t = createTranslator('en').t;
    const c = itemOf(state, 'u-alex', ATLAS, 'conflict').conflict;
    const cmd = decisionHandoff(state, ATLAS, c, 'u-lin', t('cf.handoffAsk', { need: 'N1' }), TODAY);
    expect(cmd.type).toBe('conflict.resolved');
    expect(cmd.payload).toMatchObject({ conflictId: c.id, resolution: 'handoff', toId: 'u-lin', ask: t('cf.handoffAsk', { need: 'N1' }), due: '2026-11-28' });
    expect((cmd.payload as { handoffId: string }).handoffId).toMatch(/^h-/);

    const { log, conflictId } = conflictFixture();
    const none = decisionHandoff(log.state, 'P', log.state.conflicts[conflictId]!, 'u-lin', 'x', TODAY);
    expect(none.payload).toMatchObject({ due: null });
  });

  it('the decision handoff never carries a past due date: a round past its deadline gives none', () => {
    const { log, conflictId } = conflictFixture();
    log.emit('round.created', 'u-alex', { roundId: 'r-old', projectId: 'P', title: 'Old', kind: 'cadence', start: '2026-10-01', due: '2026-11-10' });
    const c = log.state.conflicts[conflictId]!;
    expect(decisionHandoff(log.state, 'P', c, 'u-lin', 'x', TODAY).payload).toMatchObject({ due: null });
    // The same round while its deadline is still ahead is offered as the due date.
    expect(decisionHandoff(log.state, 'P', c, 'u-lin', 'x', '2026-11-05').payload).toMatchObject({ due: '2026-11-10' });
  });

  it('q-new creates the hypothesis, then links it only after the create is accepted', async () => {
    const { state } = sample('en');
    const t = createTranslator('en').t;
    const item = itemOf(state, 'u-alex', PAPER, 'question');
    const w = state.work[(item.question as { workId: Id }).workId]!;
    const done: string[] = [];
    const ok = recorder();
    await click(ok.api(state, 'u-alex'), () => QuestionItem({ item, projectId: PAPER, onDone: (l) => void done.push(l) }), 'q-new');
    expect(ok.calls.map((c) => c.type)).toEqual(['need.created', 'work.linked']);
    const needId = ok.calls[0]!.payload.needId as string;
    expect(needId).toMatch(/^n-/);
    expect(ok.calls[0]!.payload).toMatchObject({ kind: 'hyp', title: w.text, ownerId: 'u-alex', roundId: 'sample-paper:r3', source: { src: 'commit', ref: t('src.commit') } });
    expect(ok.calls[1]!.payload).toEqual({ workId: w.id, needId, effect: 'spawn' });
    expect(done).toEqual([t('ask.newHyp')]);

    const no = recorder([{ kind: 'rejected', code: 'FORBIDDEN' }]);
    await click(no.api(state, 'u-alex'), () => QuestionItem({ item, projectId: PAPER, onDone: (l) => void done.push(l) }), 'q-new');
    expect(no.calls.map((c) => c.type)).toEqual(['need.created']);
    expect(done.length).toBe(1);
  });

  it('q-ignore, q-link and q-link-other submit their work commands', async () => {
    const t = createTranslator('en').t;
    const log = suggestionFixture();
    log.emit('need.created', 'u-me', {
      needId: 'n2',
      projectId: 'p',
      kind: 'ext',
      title: 'Another need',
      roundId: null,
      source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
    });
    const item = itemOf(log.state, 'u-me', 'p', 'question');
    const done: string[] = [];
    const rec = recorder();
    const api = rec.api(log.state, 'u-me');
    const Comp = () => QuestionItem({ item, projectId: 'p', onDone: (l) => void done.push(l) });
    await click(api, Comp, 'q-link');
    await click(api, Comp, 'q-ignore');
    const sel = findAll(tree(api, Comp), 'q-link-other')[0]!;
    await (sel.props.onChange as (e: { target: { value: string } }) => unknown)({ target: { value: 'n2' } });
    expect(rec.calls).toEqual([
      { type: 'work.linked', payload: { workId: 'w1', needId: 'n1', effect: 'advance' } },
      { type: 'work.ignored', payload: { workId: 'w1' } },
      { type: 'work.linked', payload: { workId: 'w1', needId: 'n2', effect: 'advance' } },
    ]);
    expect(done).toEqual([t('ask.link', { need: 'N1' }), t('ask.skip'), t('ask.link', { need: 'N2' })]);
  });

  it('stale options submit staleCommands', async () => {
    const extLog = staleFixture('ext', true);
    const rec = recorder();
    const api = rec.api(extLog.state, 'u-me');
    const item = itemOf(extLog.state, 'u-me', 'p', 'question');
    const Comp = () => QuestionItem({ item, projectId: 'p', onDone: () => undefined });
    await click(api, Comp, 'q-drop');
    await click(api, Comp, 'q-next');
    const hypLog = staleFixture('hyp', false);
    const hypItem = itemOf(hypLog.state, 'u-me', 'p', 'question');
    await click(rec.api(hypLog.state, 'u-me'), () => QuestionItem({ item: hypItem, projectId: 'p', onDone: () => undefined }), 'q-park');
    expect(rec.calls).toEqual([
      { type: 'need.status_set', payload: { needId: 'n-stale', status: 'dropped' } },
      { type: 'need.updated', payload: { needId: 'n-stale', roundId: 'r2' } },
      { type: 'need.status_set', payload: { needId: 'n-stale', status: 'parked' } },
    ]);
  });

  it('x-accept sends a new need id only for new and hypothesis extracts; a share-first refusal keeps the item', async () => {
    const { state } = sample('en');
    const t = createTranslator('en').t;
    const xs = confirmItems(state, 'u-alex', PAPER, TODAY).filter((i): i is Item<'extract'> => i.kind === 'extract');
    const rev = xs.find((x) => x.extract.type === 'rev')!;
    const hyp = xs.find((x) => x.extract.type === 'hyp')!;
    const done: string[] = [];
    const rec = recorder();
    const api = rec.api(state, 'u-alex');
    await click(api, () => ExtractItem({ item: rev, projectId: PAPER, onDone: (l) => void done.push(l) }), 'x-accept');
    await click(api, () => ExtractItem({ item: hyp, projectId: PAPER, onDone: (l) => void done.push(l) }), 'x-accept');
    await click(api, () => ExtractItem({ item: hyp, projectId: PAPER, onDone: (l) => void done.push(l) }), 'x-ignore');
    expect(rec.calls[0]).toEqual({ type: 'extract.accepted', payload: { inputId: rev.input.id, extractId: rev.extract.id } });
    expect(rec.calls[1]!.type).toBe('extract.accepted');
    expect(rec.calls[1]!.payload.needId).toMatch(/^n-/);
    expect(rec.calls[2]).toEqual({ type: 'extract.ignored', payload: { inputId: hyp.input.id, extractId: hyp.extract.id } });
    expect(done.length).toBe(3);
    expect(done[0]).toContain(t('ask.accept'));
    expect(done[2]).toContain(t('ask.ignore'));

    const no = recorder([{ kind: 'rejected', code: 'PRIVATE_SOURCE' }]);
    await click(no.api(state, 'u-alex'), () => ExtractItem({ item: hyp, projectId: PAPER, onDone: (l) => void done.push(l) }), 'x-accept');
    expect(no.calls.length).toBe(1);
    expect(done.length).toBe(3);
  });

  it('pr-accept takes the current round; pr-reject rejects', async () => {
    const t = createTranslator('en').t;
    const log = proposalFixture();
    const item = itemOf(log.state, 'u-me', 'p', 'proposal');
    const done: string[] = [];
    const rec = recorder();
    const api = rec.api(log.state, 'u-me');
    const Comp = () => ProposalItem({ item, projectId: 'p', onDone: (l) => void done.push(l) });
    await click(api, Comp, 'pr-accept');
    await click(api, Comp, 'pr-reject');
    expect(rec.calls[0]!.type).toBe('proposal.accepted');
    expect(rec.calls[0]!.payload).toMatchObject({ proposalId: 'pr1', roundId: 'r1' });
    expect(rec.calls[0]!.payload.needId).toMatch(/^n-/);
    expect(rec.calls[1]).toEqual({ type: 'proposal.rejected', payload: { proposalId: 'pr1' } });
    expect(done[0]).toContain(t('pr.accept'));
    expect(done[1]).toContain(t('pr.reject'));
  });
});
