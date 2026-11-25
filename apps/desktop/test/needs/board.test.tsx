import { describe, expect, it } from 'vitest';
import { DOT_RE, needByCode, projectRounds, SEP, userName, viewFor, type Id, type State } from '@meetless/core';
import { createTranslator, type Locale } from '@meetless/i18n';
import { BoardPage } from '../../src/renderer/needs/BoardPage';
import { Lineage } from '../../src/renderer/needs/Lineage';
import { cardFacts } from '../../src/renderer/needs/model';
import { NeedCard } from '../../src/renderer/needs/NeedCard';
import { fakeApi, render, sample } from '../support/app';
import { guards } from '../support/guards';
import { Log } from '../support/log';
import { findAll, tree } from '../collab/harness';

const ATLAS = 'sample-atlas';
const PAPER = 'sample-paper';
const TODAY = '2026-11-24';
const LOCALES: Locale[] = ['zh-CN', 'en'];
const count = (html: string, needle: string) => html.split(needle).length - 1;
const noComposer = () => null;

function boardHtml(live: State, me: Id, locale: Locale, projectId: Id) {
  return render(fakeApi({ live, me, locale, route: { view: 'board', projectId }, today: TODAY }), <BoardPage composer={noComposer} />);
}

function lineageHtml(live: State, me: Id, locale: Locale, projectId: Id) {
  return render(fakeApi({ live, me, locale, route: { view: 'board', projectId }, today: TODAY }), <Lineage projectId={projectId} />);
}

describe('BoardPage', () => {
  it.each(LOCALES)('renders page-board with the timeline, mode switch, kind chips and one column per round (%s)', (locale) => {
    const live = viewFor(sample(locale).state, 'u-alex');
    const tr = createTranslator(locale);
    const html = boardHtml(live, 'u-alex', locale, ATLAS);
    expect(html).toContain('data-testid="page-board"');
    expect(html).toContain('class="tl"');
    expect(count(html, 'data-testid="board-col"')).toBe(4);
    expect(html).toContain(tr.t('view.rounds'));
    expect(html).toContain(tr.t('view.lineage'));
    expect(html).toContain(tr.t('filter.all'));
    expect(html).toContain(tr.t('filter.ext'));
    expect(html).toContain(tr.t('filter.hyp'));
    expect(html).toContain('data-testid="board-new"');
    expect(html).toContain(tr.t('board.new'));

    // Stable U2 test ids (global-constraints.md): the mode switch, the kind filters, and each
    // column's round number, each exactly once (the chips) or once per round (the columns).
    for (const id of ['board-mode-rounds', 'board-mode-lineage', 'board-filter-all', 'board-filter-ext', 'board-filter-hyp']) {
      expect(count(html, `data-testid="${id}"`), id).toBe(1);
    }
    for (const r of projectRounds(live, ATLAS)) expect(html).toContain(`data-testid="board-col" data-round="${r.n}"`);
    const atlasNeeds = Object.values(live.needs).filter((n) => n.projectId === ATLAS);
    expect(count(html, 'data-testid="need-card"')).toBe(atlasNeeds.length);
    for (const n of atlasNeeds) expect(html).toContain(`data-testid="need-card" data-need="${n.id}"`);

    guards(`board ${locale}`, html);
  });

  it('cards show code, title, status text, owner, the handoff line and the To confirm mark', () => {
    const live = viewFor(sample('en').state, 'u-alex');
    const tr = createTranslator('en');
    const html = boardHtml(live, 'u-alex', 'en', ATLAS);
    const n3 = needByCode(live, ATLAS, 'N3')!;
    const n1 = needByCode(live, ATLAS, 'N1')!;

    // N3: title, status text, and a handoff line from Lin; it is "hot" because it is sent to me.
    expect(html).toContain(n3.title);
    expect(html).toContain(tr.tDynamic(`st.${n3.status}`));
    const handoffText = tr.t('ho.from', { who: userName(live, 'u-lin') }) + SEP + tr.t('ho.st.sent');
    expect(html).toContain(handoffText);
    expect(html).toMatch(/<span class="hoff sm hot">[^<]*<\/span>/);

    // The N3 card (owned by me) also shows the owner's avatar, in the same card as the handoff.
    // Found by its stable `data-need` test id, not by slicing around its code text.
    const n3Tag = `data-testid="need-card" data-need="${n3.id}"`;
    const n3Start = html.indexOf(n3Tag);
    expect(n3Start, 'the N3 card has the need-card/data-need test ids').toBeGreaterThanOrEqual(0);
    const nextCardStart = html.indexOf('data-testid="need-card"', n3Start + n3Tag.length);
    const n3Card = html.slice(n3Start, nextCardStart === -1 ? html.length : nextCardStart);
    expect(n3Card).toContain(handoffText);
    expect(n3Card).toMatch(/class="av av-\d/);

    // N1: no handoff and no owner, but a conflict is waiting on me: the "To confirm" mark, in violet.
    const n1Tag = `data-testid="need-card" data-need="${n1.id}"`;
    const n1Start = html.indexOf(n1Tag);
    expect(n1Start, 'the N1 card has the need-card/data-need test ids').toBeGreaterThanOrEqual(0);
    const n1NextStart = html.indexOf('data-testid="need-card"', n1Start + n1Tag.length);
    const n1Card = html.slice(n1Start, n1NextStart === -1 ? html.length : n1NextStart);
    expect(n1Card).toContain(n1.title);
    expect(n1Card).toContain(`class="card-ai ask">${tr.t('ask.btn')}</span>`);
  });

  it('a card is a keyboard target: role button, tabIndex 0, and Enter or Space opens the need', () => {
    const live = viewFor(sample('en').state, 'u-alex');
    const n1 = needByCode(live, ATLAS, 'N1')!;
    const facts = cardFacts(live, n1, 'u-alex', new Set());
    const html = render(fakeApi({ live, me: 'u-alex', today: TODAY }), <NeedCard need={n1} facts={facts} selected={false} />);
    expect(html).toMatch(/data-testid="need-card"[^>]*role="button"[^>]*tabindex="0"/);

    for (const key of ['Enter', ' ']) {
      const api = fakeApi({ live, me: 'u-alex', today: TODAY, route: { view: 'board', projectId: ATLAS } });
      const card = findAll(tree(api, () => NeedCard({ need: n1, facts, selected: false })), 'need-card')[0]!;
      let prevented = false;
      (card.props.onKeyDown as (e: { key: string; preventDefault(): void }) => void)({ key, preventDefault: () => void (prevented = true) });
      expect(api.route, key).toMatchObject({ projectId: ATLAS, needId: n1.id });
      expect(prevented, key).toBe(true);
    }
    const api = fakeApi({ live, me: 'u-alex', today: TODAY, route: { view: 'board', projectId: ATLAS } });
    const card = findAll(tree(api, () => NeedCard({ need: n1, facts, selected: false })), 'need-card')[0]!;
    (card.props.onKeyDown as (e: { key: string; preventDefault(): void }) => void)({ key: 'Tab', preventDefault: () => undefined });
    expect(api.route).not.toHaveProperty('needId', n1.id);
  });

  it('a private need shows pv.mine to its owner and is absent for another member', () => {
    const full = sample('en').state;
    const alexLive = viewFor(full, 'u-alex');
    const hp1 = Object.values(alexLive.needs).find((n) => n.code === 'Hp1')!;
    const tr = createTranslator('en');

    const alexHtml = boardHtml(alexLive, 'u-alex', 'en', PAPER);
    expect(alexHtml).toContain('Hp1');
    expect(alexHtml).toContain(hp1.title);
    expect(alexHtml).toContain(tr.t('pv.mine'));

    const miaLive = viewFor(full, 'u-mia');
    expect(miaLive.needs[hp1.id]).toBeUndefined();
    const miaHtml = boardHtml(miaLive, 'u-mia', 'en', PAPER);
    expect(miaHtml).not.toContain('Hp1');
    expect(miaHtml).not.toContain(hp1.title);
  });

  it('lineage lists roots and feedback quotes and never a private need', () => {
    const live = viewFor(sample('en').state, 'u-alex');
    const tr = createTranslator('en');
    const html = lineageHtml(live, 'u-alex', 'en', PAPER);
    expect(html).toContain('data-testid="lineage"');
    expect(html).toContain(tr.t('lin.title'));
    expect(html).toContain(tr.t('lin.direct'));
    const n1 = needByCode(live, PAPER, 'N1')!;
    expect(html).toContain(n1.title);
    const n2 = needByCode(live, PAPER, 'N2')!;
    expect(html).toContain(tr.t('round', { n: 1 }) + SEP + 'Group meeting #1');
    expect(html).toContain(n2.title);
    // N2 is round 1's feedback: its own source quote, with its author, appears as a lineage quote.
    expect(html).toContain(n2.source.quote);
    expect(html).toContain(userName(live, 'u-prof'));
    expect(html).not.toContain('Hp1');
    const hp1 = Object.values(live.needs).find((n) => n.code === 'Hp1')!;
    expect(html).not.toContain(hp1.title);
  });

  it.each(LOCALES)('a feedback quote that already carries its own quote marks is not quoted twice (%s)', (locale) => {
    const live = viewFor(sample(locale).state, 'u-alex');
    const html = lineageHtml(live, 'u-alex', locale, ATLAS);
    // Atlas N2's source quote comes with its quote marks (the sample's own data), and it is round 1's feedback.
    const n2 = needByCode(live, ATLAS, 'N2')!;
    expect(n2.source.quote).toMatch(/^“.*”$/);
    expect(html).toContain(`>${n2.source.quote}<`);
    expect(html).not.toContain('““');
    expect(html).not.toContain('””');
    // A plain quote (Atlas N3, round 2's feedback) still gets its marks.
    const n3 = needByCode(live, ATLAS, 'N3')!;
    expect(n3.source.quote).not.toMatch(/^“/);
    expect(html).toContain(`>“${n3.source.quote}”<`);
  });

  it('a project without rounds shows board.noRounds and the Unscheduled column with its needs', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p0', name: 'No rounds yet' });
    log.emit('need.created', 'u-me', {
      needId: 'n1',
      projectId: 'p0',
      kind: 'ext',
      title: 'Loose end',
      roundId: null,
      source: { src: 'chat', date: '2026-11-20', quote: 'q', ref: 'r' },
    });
    const tr = createTranslator('en');
    const html = boardHtml(log.state, 'u-me', 'en', 'p0');
    expect(html).toContain(tr.t('board.noRounds'));
    expect(count(html, 'data-testid="board-col"')).toBe(1);
    // The unscheduled column (no round) carries an empty `data-round`.
    expect(html).toContain('data-testid="board-col" data-round=""');
    expect(html).toContain(tr.t('col.unscheduled'));
    expect(html).toContain('Loose end');
    expect(html).toContain('data-testid="need-card" data-need="n1"');
  });

  it.each(LOCALES)('no markup on the board or the lineage contains a dot symbol (%s)', (locale) => {
    const live = viewFor(sample(locale).state, 'u-alex');
    const board = boardHtml(live, 'u-alex', locale, ATLAS);
    const lineage = lineageHtml(live, 'u-alex', locale, PAPER);
    expect(DOT_RE.test(board)).toBe(false);
    expect(DOT_RE.test(lineage)).toBe(false);
    guards(`board ${locale}`, board);
    guards(`lineage ${locale}`, lineage);
  });
});
