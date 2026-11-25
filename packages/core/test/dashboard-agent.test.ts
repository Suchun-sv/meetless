import { describe, expect, it } from 'vitest';
import {
  DOT_RE,
  activityCard,
  allRisks,
  answer,
  cardFromText,
  cardsFor,
  deliveryCard,
  homeItems,
  hypothesesCard,
  membersCard,
  needContext,
  progressCard,
  projectsCard,
  riskList,
  search,
  sourcesCard,
  suggestions,
  waitingCount,
  weeklyCard,
  type AgentAnswer,
} from '../src/index';
import { atlas, P, R, U } from './log';
import { LABELS } from './labels';

const today = '2026-11-24';

function busy() {
  const log = atlas();
  log.emit('need.status_set', U.ben, { needId: 'h-cache', status: 'refuted', verdict: 'Refuted: 48 → 47 s, reverted' });
  log.emit('need.status_set', U.ben, { needId: 'n-filter', status: 'doing' });
  log.emit('need.revised', U.lin, { needId: 'n-filter', revisionId: 'rv', text: 'Add a “last 7 days” shortcut', why: 'Mr Wang’s email, 11-22', date: '2026-11-22' });
  log.emit('work.recorded', U.ben, { workId: 'w1', projectId: P, needId: 'h-cache', src: 'exp', text: 'Load test: 48 → 47 s', why: 'Hardly any change', effect: 'refute', result: 'revert', date: '2026-11-08' });
  log.emit('work.recorded', U.ben, { workId: 'w2', projectId: P, needId: 'n-filter', src: 'commit', text: 'c91a date range filter', effect: 'advance', date: '2026-11-21' });
  log.emit('work.recorded', U.zhou, { workId: 'w3', projectId: P, needId: 'n-filter', src: 'agent', text: '6 filter tests added, 2 failing', effect: 'advance', date: '2026-11-24', via: { client: 'claude-code', tokenId: 't' } });
  log.emit('work.recorded', U.me, { workId: 'w4', projectId: P, needId: 'n-filter', src: 'commit', text: 'captured 3 commits', date: '2026-11-24', capture: true });
  log.emit('handoff.created', U.me, { handoffId: 'ho1', projectId: P, needId: 'n-filter', toId: U.zhou, ask: 'Add filter tests', due: '2026-11-26' });
  log.emit('handoff.responded', U.zhou, { handoffId: 'ho1', response: 'accepted' });
  log.emit('handoff.context_fetched', U.zhou, { handoffId: 'ho1', version: 1, client: 'codex' });
  log.emit('need.revised', U.lin, { needId: 'n-filter', revisionId: 'rv2', text: 'Last 7 and last 30 days', why: 'Call with Mr Wang', date: '2026-11-24' });
  log.emit('handoff.created', U.lin, { handoffId: 'ho2', projectId: P, needId: 'n-export', toId: U.me, ask: 'Own the export permissions', due: '2026-11-27' });
  return log;
}

describe('dashboard cards are computed from the record', () => {
  it('project cards: progress, risks, members, delivery, hypotheses, activity, sources, weekly', () => {
    const s = busy().state;
    expect(progressCard(s, P, today)).toMatchObject({ daysLeft: 4, ext: 2, done: 0, doing: 1, todo: 1, hypTesting: 0 });
    const risks = riskList(s, U.me, P, today);
    expect(risks.map((r) => r.code)).toEqual(['stale', 'waitMe', 'todo']);
    expect(risks[0]).toMatchObject({ needId: 'n-filter', userId: U.zhou, v: 1 });
    expect(riskList(s, U.zhou, P, today).map((r) => r.code)).toEqual(['wait', 'todo']);
    const members = membersCard(s, P);
    expect(members.map((m) => [m.userId, m.role])).toEqual([[U.lin, 'Product'], [U.me, 'Engineering'], [U.ben, 'Engineering'], [U.zhou, null]]);
    expect(members.find((m) => m.userId === U.zhou)!.owns).toBe(1);
    expect(members.find((m) => m.userId === U.ben)!.last!.id).toBe('w2');
    expect(deliveryCard(s, P).lines).toEqual([{ needId: 'n-export', status: 'todo' }, { needId: 'n-filter', status: 'doing' }]);
    expect(hypothesesCard(s, P).counts).toEqual({ held: 0, refuted: 1, testing: 0, untested: 0 });
    // Captures are reference only: not in activity.
    expect(activityCard(s, P).map((w) => w.id)).not.toContain('w4');
    expect(activityCard(s, P)[0]!.id).toBe('w3');
    expect(sourcesCard(s, P)).toEqual([
      { key: 'n:Mr Wang (Client A)', userId: null, name: 'Mr Wang (Client A)', count: 2 },
      { key: `u:${U.ben}`, userId: U.ben, name: null, count: 1 },
    ]);
    expect(weeklyCard(s, P, today).map((w) => [w.userId, w.count])).toEqual([[U.ben, 1], [U.zhou, 1]]);
  });

  it('home cards across projects: projects, handed to me, to confirm, I handed off, owned by me, due soon, all risks', () => {
    const s = busy().state;
    const h = homeItems(s, U.me, today);
    expect(h.toMe).toEqual([{ projectId: P, handoffId: 'ho2', needId: 'n-export' }]);
    expect(h.byMe).toMatchObject([{ handoffId: 'ho1', stale: 3, last: { id: 'w3' } }]);
    expect(h.mine).toEqual([]);
    expect(h.due).toEqual([{ projectId: P, roundId: R.r1, daysLeft: 4 }]);
    expect(waitingCount(s, U.me, today)).toBe(1);
    expect(projectsCard(s, U.me, today)).toMatchObject([{ projectId: P, done: 0, ext: 2, daysLeft: 4 }]);
    expect(allRisks(s, U.me, today).length).toBe(3);
  });

  it('the latest work shown for a handoff skips ignored work', () => {
    const log = busy();
    log.emit('work.recorded', U.zhou, { workId: 'w5', projectId: P, needId: 'n-filter', src: 'commit', text: 'wip', date: '2026-11-24' });
    expect(homeItems(log.state, U.me, today).byMe[0]!.last!.id).toBe('w5');
    log.emit('work.ignored', U.me, { workId: 'w5' });
    expect(homeItems(log.state, U.me, today).byMe[0]!.last!.id).toBe('w3');
  });

  it('home To confirm lists extracts and questions next to conflicts and proposals, and counts them once', () => {
    const log = busy();
    log.emit('work.recorded', U.me, { workId: 'w-free', projectId: P, src: 'commit', text: 'e41b retry on timeout', date: '2026-11-23' });
    const h = homeItems(log.state, U.me, today);
    expect(h.confirm).toEqual([{ projectId: P, kind: 'question', id: 'unlinked:w-free' }]);
    expect(waitingCount(log.state, U.me, today)).toBe(2);
    const t = answer(log.state, { userId: U.me, scope: { kind: 'home' }, text: 'what first today?', today }).answer;
    expect(t.intent === 'today' && t.items.find((i) => i.kind === 'confirm')).toMatchObject({ projectId: P, id: 'unlinked:w-free', needId: null });
  });

  it('card sets default per scope and come from the user’s own dashboard.set', () => {
    const log = busy();
    expect(cardsFor(log.state, U.me, P).cards).toEqual(['progress', 'risks', 'members', 'delivery', 'hyps', 'activity']);
    expect(cardsFor(log.state, U.me, 'home').cards).toEqual(['projects', 'toMe', 'confirm', 'byMe', 'mine', 'due']);
    log.emit('dashboard.set', U.me, { scope: P, cards: ['progress', 'weekly'], refreshed: { weekly: '2026-11-24T10:00:00.000Z' } });
    expect(cardsFor(log.state, U.me, P)).toEqual({ cards: ['progress', 'weekly'], refreshed: { weekly: '2026-11-24T10:00:00.000Z' } });
    expect(cardsFor(log.state, U.ben, P).cards).toHaveLength(6);
  });

  it('rule-based card selection from a request', () => {
    expect(cardFromText('加一张本周谁做了什么的卡片', 'project')).toBe('weekly');
    expect(cardFromText('Add a card showing where needs come from', 'project')).toBe('sources');
    expect(cardFromText('show me all risks', 'home')).toBe('allRisks');
    expect(cardFromText('show risks', 'project')).toBe('risks');
    expect(cardFromText('why does N4 compare latency only?', 'project')).toBeNull();
  });
});

describe('project agent (rule-based, simulated) answers with citations', () => {
  const ask = (text: string, scope: 'home' | 'project' = 'project', user: string = U.me): AgentAnswer =>
    answer(busy().state, { userId: user, scope: scope === 'home' ? { kind: 'home' } : { kind: 'project', projectId: P }, text, today }).answer;

  it('retrieval: finds the need through its revisions and work, cites it', () => {
    const a = ask('did we try a cache table?');
    expect(a.intent).toBe('retrieval');
    if (a.intent !== 'retrieval') return;
    expect(a.cites[0]).toBe('h-cache');
    expect(a.needs[0]!.hits.map((h) => h.field)).toContain('title');
    const b = ask('why the last 7 days shortcut?');
    expect(b.cites[0]).toBe('n-filter');
    if (b.intent === 'retrieval') expect(b.needs[0]!.hits.some((h) => h.field === 'revision' && h.why === 'Mr Wang’s email, 11-22')).toBe(true);
    expect(ask('N1').cites[0]).toBe('n-export');
  });

  it('every reply is labelled as rule-based and simulated', () => {
    const r = answer(busy().state, { userId: U.me, scope: { kind: 'home' }, text: 'hello', today });
    expect(r).toMatchObject({ provider: 'rules/1', simulated: true });
    expect(r.answer.intent).toBe('summary');
  });

  it('intents: what first today, deadlines, this week, delivery note, add a card, looks like an input', () => {
    const t = ask('What should I do first today?', 'home');
    expect(t.intent).toBe('today');
    if (t.intent === 'today') expect(t.items[0]).toMatchObject({ kind: 'toMe', needId: 'n-export' });
    expect(ask('All deadlines across projects', 'home')).toMatchObject({ intent: 'deadlines', items: [{ projectId: P, daysLeft: 4 }] });
    expect(ask('This week by person')).toMatchObject({ intent: 'weekly' });
    const d = ask('Draft the delivery note');
    expect(d).toMatchObject({ intent: 'delivery', roundId: R.r1 });
    expect(ask('add a card for hypotheses')).toEqual({ intent: 'addCard', card: 'hyps', cites: [] });
    expect(ask('Meeting notes\nClient: exports must include all fields.')).toMatchObject({ intent: 'asInput' });
  });

  it('handoff intent picks the need and the member', () => {
    const view = busy().state;
    expect(answer(view, { userId: U.me, scope: { kind: 'project', projectId: P }, text: '把 N2 交给 Zhou Yu', today }).answer)
      .toMatchObject({ intent: 'handoff', needId: 'n-filter', toId: U.zhou });
    expect(ask('hand it over to lin an')).toEqual({ intent: 'handoff', projectId: P, needId: null, toId: U.lin, cites: [] });
    expect(ask('assign to someone: N1')).toEqual({ intent: 'handoff', projectId: P, needId: 'n-export', toId: null, cites: ['n-export'] });
    // Project scope only.
    expect(ask('把 N2 交给 Zhou Yu', 'home').intent).not.toBe('handoff');
  });

  it('handoff intent: English word orders, never a question about what was handed to me', () => {
    expect(ask('hand N2 over to Zhou Yu')).toMatchObject({ intent: 'handoff', needId: 'n-filter', toId: U.zhou });
    expect(ask('hand N2 to Zhou Yu')).toMatchObject({ intent: 'handoff', needId: 'n-filter', toId: U.zhou });
    expect(ask('交给我的有哪些').intent).not.toBe('handoff');
    expect(ask('今天先做 Lin 交给我的哪个')).toMatchObject({ intent: 'today' });
  });

  it('handoff intent skips private needs and matches ASCII names as whole words', () => {
    const log = busy();
    log.emit('user.registered', 'system', { userId: 'u-an', displayName: 'An', locale: 'en' });
    log.emit('project.member_added', U.me, { projectId: P, userId: 'u-an' });
    log.emit('need.created', U.me, { needId: 'h-mine', projectId: P, kind: 'hyp', title: 'My private idea', roundId: R.r1, expect: 'x', private: true, source: { src: 'doc', date: '2026-11-24', quote: '', ref: '' } });
    const code = log.state.needs['h-mine']!.code;
    const handoff = (text: string) => answer(log.state, { userId: U.me, scope: { kind: 'project', projectId: P }, text, today }).answer;
    expect(handoff(`把 ${code} 交给 Ben`)).toEqual({ intent: 'handoff', projectId: P, needId: null, toId: U.ben, cites: [] });
    // "an" inside "hand" is not the member An; "Lin An" (longest) beats "An".
    expect(handoff('hand N2 over to someone')).toMatchObject({ intent: 'handoff', needId: 'n-filter', toId: null });
    expect(handoff('hand N2 to An')).toMatchObject({ toId: 'u-an' });
    expect(handoff('hand N2 to Lin An')).toMatchObject({ toId: U.lin });
  });

  it('stale intent lists my handoffs whose recipient holds an older context', () => {
    const log = busy();
    const stale = (user: string, scope: 'home' | 'project' = 'project') =>
      answer(log.state, { userId: user, scope: scope === 'home' ? { kind: 'home' } : { kind: 'project', projectId: P }, text: 'Which handoffs are out of date?', today }).answer;
    expect(stale(U.me)).toEqual({ intent: 'stale', items: [{ projectId: P, handoffId: 'ho1', needId: 'n-filter', fetched: 1, current: 3, reminded: false }], cites: ['n-filter'] });
    log.emit('handoff.refresh_requested', U.me, { handoffId: 'ho1' });
    expect(stale(U.me, 'home')).toMatchObject({ intent: 'stale', items: [{ handoffId: 'ho1', reminded: true }] });
    // Zhou handed nothing off; Lin's handoff to me was never fetched.
    expect(stale(U.zhou)).toEqual({ intent: 'stale', items: [], cites: [] });
    expect(stale(U.lin)).toEqual({ intent: 'stale', items: [], cites: [] });
    expect(ask('哪些交接是旧版本')).toMatchObject({ intent: 'stale' });
  });

  it('suggestion chips: stale handoff, handed to me, add-card chips on dashboards', () => {
    const s = busy().state;
    const chips = suggestions(s, U.me, { kind: 'project', projectId: P }, today);
    expect(chips.map((c) => c.kind)).toEqual(['stale', 'toMe', 'ask', 'ask']);
    const dash = suggestions(s, U.me, { kind: 'project', projectId: P }, today, { dashboardCards: ['progress'], pool: ['progress', 'risks', 'weekly'] });
    expect(dash.filter((c) => c.kind === 'addCard').map((c) => (c.kind === 'addCard' ? c.card : ''))).toEqual(['risks', 'weekly']);
  });

  it('search covers quotes, revisions, work and input paragraphs', () => {
    const s = busy().state;
    expect(search(s, { text: 'monthly customer data', projectId: P })[0]).toMatchObject({ needId: 'n-export', field: 'quote' });
    expect(search(s, { text: '48 → 47', projectId: P }).some((h) => h.kind === 'work' && h.needId === 'h-cache')).toBe(true);
  });
});

describe('need context (what the link resolves to)', () => {
  it('is version-stamped, lists revisions, activity and refuted hypotheses, and contains no dot symbols', () => {
    const s = busy().state;
    const c = needContext(s, 'n-filter', LABELS);
    expect(c).toMatchObject({ code: 'N2', version: 3, link: `meetless://${P}/N2` });
    expect(c.markdown).toContain('# N2 Export filters by date');
    expect(c.markdown).toContain('v3');
    expect(c.markdown).toContain('Last 7 and last 30 days');
    expect(c.markdown).toContain('6 filter tests added, 2 failing');
    expect(c.markdown).toContain('H1 A cache table speeds export up — Refuted');
    expect(c.markdown).toContain('captured, reference only');
    expect(DOT_RE.test(c.markdown)).toBe(false);
  });
});
