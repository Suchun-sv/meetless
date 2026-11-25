import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_CARDS, progressCard, viewFor, type CardId } from '@meetless/core';
import { createTranslator } from '@meetless/i18n';
import { leftText } from '../../src/renderer/dash/model';
import { rowButton } from '../../src/renderer/dash/parts';
import { ProjectDashPage } from '../../src/renderer/dash/ProjectDashPage';
import type { Route } from '../../src/renderer/app/routes';
import { displayName } from '../../src/renderer/model/state';
import { render, sample } from '../support/app';
import { guards } from '../support/guards';
import { alexApi, LOCALES, privateTitle, sampleWith, textOf, zhouApi } from '../shell/u1';

const today = '2026-11-24';
const route: Route = { view: 'dash', projectId: 'sample-atlas' };
const page = <ProjectDashPage composer={() => null} />;

describe('ProjectDashPage', () => {
  it.each(LOCALES)('(%s) the six default cards in order, each labelled rule-based with a time, refresh and remove', (l) => {
    const api = alexApi(l, { route });
    const html = render(api, page);
    expect([...html.matchAll(/data-card="(\w+)"/g)].map((m) => m[1])).toEqual([...DEFAULT_PROJECT_CARDS]);
    expect(html.match(/data-testid="card-remove"/g)).toHaveLength(6);
    expect(html.match(/data-testid="card-refresh"/g)).toHaveLength(6);
    expect(html).toContain('data-testid="page-dash"');
    expect(html).not.toContain('data-testid="dash-setup"');
    expect(textOf(html)).toContain(api.t('app.rules'));
  });

  it('a stored dashboard.set decides which cards show', () => {
    const state = sampleWith('en', [{ type: 'dashboard.set', payload: { scope: 'sample-atlas', cards: ['sources'] } }]);
    const html = render(alexApi('en', { state, route }), page);
    expect([...html.matchAll(/data-card="(\w+)"/g)].map((m) => m[1])).toEqual(['sources']);
  });

  it.each(LOCALES)('(%s) progress shows the current round with days left and the done count', (l) => {
    const html = render(alexApi(l, { route }), page);
    const s = viewFor(sample(l).state, 'u-alex');
    const t = createTranslator(l).t;
    const p = progressCard(s, 'sample-atlas', today);
    expect(p.round).not.toBeNull();
    expect(textOf(html)).toContain(t('pg.done', { a: p.done, b: p.ext }));
    expect(textOf(html)).toContain(leftText(t, p.daysLeft));
  });

  it.each(LOCALES)('(%s) risks list the stale N2 handoff to Zhou', (l) => {
    const html = render(alexApi(l, { route }), page);
    const s = viewFor(sample(l).state, 'u-alex');
    const t = createTranslator(l).t;
    const zhouName = displayName(s, 'u-zhou');
    expect(textOf(html)).toContain(t('rk.stale', { need: 'N2', who: zhouName, v: 1 }));
  });

  it('project cards never contain a private item, for Alex or for Zhou', () => {
    const paperDash: Route = { view: 'dash', projectId: 'sample-paper' };
    expect(textOf(render(alexApi('en', { route: paperDash }), page))).not.toContain(privateTitle('en'));
    expect(textOf(render(zhouApi('en', { route: paperDash }), page))).not.toContain(privateTitle('en'));
  });

  it('a project with no rounds shows pg.noRound, the rounds link and the setup strip', () => {
    const state = sampleWith('en', [{ type: 'project.created', payload: { projectId: 'p-new', name: 'New project' } }]);
    const html = render(alexApi('en', { state, route: { view: 'dash', projectId: 'p-new' } }), page);
    expect(html).toContain('data-testid="pg-set-rounds"');
    expect(html).toContain('data-testid="dash-setup"');
    expect(html).toContain('data-testid="setup-members"');
    expect(html).toContain('data-testid="setup-rounds"');
    expect(textOf(html)).toContain(createTranslator('en').t('pg.noRound'));
  });

  it('sources and weekly render when added', () => {
    const state = sampleWith('en', [
      { type: 'project.created', payload: { projectId: 'p-u1-src', name: 'SrcTest' } },
      {
        type: 'need.created',
        payload: {
          needId: 'n-u1-src',
          projectId: 'p-u1-src',
          kind: 'ext',
          title: 'Need A',
          roundId: null,
          requester: { name: 'Priya' },
          source: { src: 'chat', date: today, quote: 'q', ref: 'r' },
        },
      },
      { type: 'work.recorded', payload: { workId: 'w-u1-wk', projectId: 'p-u1-src', needId: null, src: 'chat', text: 'Looked into filters', date: today } },
      { type: 'dashboard.set', payload: { scope: 'p-u1-src', cards: ['sources', 'weekly'] } },
    ]);
    const html = render(alexApi('en', { state, route: { view: 'dash', projectId: 'p-u1-src' } }), page);
    const t = createTranslator('en').t;
    const s = viewFor(state, 'u-alex');
    expect([...html.matchAll(/data-card="(\w+)"/g)].map((m) => m[1])).toEqual(['sources', 'weekly']);
    expect(textOf(html)).toContain('Priya');
    expect(textOf(html)).toContain(t('sr.count', { n: 1 }));
    expect(textOf(html)).toContain(displayName(s, 'u-alex'));
    expect(textOf(html)).toContain(t('wk.items', { n: 1 }));
    expect(textOf(html)).toContain('Looked into filters');
  });

  describe('a brand-new project (one member, no rounds, no needs)', () => {
    const fresh = (l: (typeof LOCALES)[number], cards?: CardId[]) =>
      sampleWith(l, [
        { type: 'project.created', payload: { projectId: 'p-fresh', name: 'Fresh' } },
        ...(cards ? [{ type: 'dashboard.set' as const, payload: { scope: 'p-fresh', cards } }] : []),
      ]);
    const freshRoute: Route = { view: 'dash', projectId: 'p-fresh' };
    /** The markup of one card, `data-card=<id>`, up to the next card. */
    const cardHtml = (html: string, id: string) => {
      const start = html.indexOf(`data-card="${id}"`);
      const next = html.indexOf('data-card="', start + 1);
      return html.slice(start, next < 0 ? undefined : next);
    };

    it.each(LOCALES)('(%s) every default card says what is missing and offers a way forward, never a blank body', (l) => {
      const t = createTranslator(l).t;
      const html = render(alexApi(l, { state: fresh(l), route: freshRoute }), page);
      expect(textOf(cardHtml(html, 'delivery'))).toContain(t('pg.noRound'));
      expect(textOf(cardHtml(html, 'delivery'))).toContain(t('pg.setRounds'));
      expect(textOf(cardHtml(html, 'hyps'))).toContain(t('db.hypsEmpty'));
      expect(textOf(cardHtml(html, 'hyps'))).toContain(t('db.openBoard'));
      expect(textOf(cardHtml(html, 'activity'))).toContain(t('db.activityEmpty'));
      expect(textOf(cardHtml(html, 'activity'))).toContain(t('db.openBoard'));
      expect(textOf(cardHtml(html, 'risks'))).toContain(t('rk.none'));
      for (const id of ['delivery', 'hyps', 'activity']) expect(cardHtml(html, id), id).toContain('data-testid="card-empty-action"');
      guards(`fresh project dash ${l}`, html);
    });

    it.each(LOCALES)('(%s) sources and weekly, added to an empty project, say so and link onward', (l) => {
      const t = createTranslator(l).t;
      const html = render(alexApi(l, { state: fresh(l, ['sources', 'weekly']), route: freshRoute }), page);
      expect(textOf(cardHtml(html, 'sources'))).toContain(t('db.sourcesEmpty'));
      expect(textOf(cardHtml(html, 'sources'))).toContain(t('db.openInputs'));
      expect(textOf(cardHtml(html, 'weekly'))).toContain(t('db.weeklyEmpty'));
      expect(textOf(cardHtml(html, 'weekly'))).toContain(t('db.openBoard'));
      guards(`fresh project sources/weekly ${l}`, html);
    });

    it('delivery with a round but no external needs points to inputs', () => {
      const t = createTranslator('en').t;
      const state = sampleWith('en', [
        { type: 'project.created', payload: { projectId: 'p-fresh', name: 'Fresh' } },
        { type: 'round.created', payload: { roundId: 'r-fresh', projectId: 'p-fresh', title: 'R1', kind: 'hard', start: '2026-11-20', due: '2026-12-10' } },
      ]);
      const html = render(alexApi('en', { state, route: freshRoute }), page);
      expect(textOf(cardHtml(html, 'delivery'))).toContain(t('db.deliveryEmpty'));
      expect(textOf(cardHtml(html, 'delivery'))).toContain(t('db.openInputs'));
    });

    it('the sample project shows its real rows, not the empty copy', () => {
      const t = createTranslator('en').t;
      const html = render(alexApi('en', { route }), page);
      for (const k of ['db.deliveryEmpty', 'db.activityEmpty', 'db.hypsEmpty'] as const) expect(textOf(html)).not.toContain(t(k));
    });
  });

  it.each(LOCALES)('(%s) no dot symbol on the project dashboard', (l) => {
    const html = render(alexApi(l, { route }), page);
    guards('project dash', html);
  });
});

describe('rowButton (risk rows on both dashboards)', () => {
  /** A minimal keyboard event: only what `rowButton`'s handler reads. */
  const key = (k: string, onRow: boolean) => {
    const row = {};
    const ev = { key: k, currentTarget: row, target: onRow ? row : {}, prevented: false, preventDefault() { ev.prevented = true; } };
    return ev;
  };

  it('is focusable, and Enter or Space on the row runs it like a click', () => {
    let runs = 0;
    const p = rowButton(() => runs++);
    expect(p).toMatchObject({ role: 'button', tabIndex: 0 });
    for (const k of ['Enter', ' ']) {
      const ev = key(k, true);
      p.onKeyDown(ev as unknown as Parameters<typeof p.onKeyDown>[0]);
      expect(ev.prevented, k).toBe(true);
    }
    p.onClick();
    expect(runs).toBe(3);
  });

  it('ignores other keys, and keys pressed on an inner need chip', () => {
    let runs = 0;
    const p = rowButton(() => runs++);
    p.onKeyDown(key('Tab', true) as unknown as Parameters<typeof p.onKeyDown>[0]);
    p.onKeyDown(key('Enter', false) as unknown as Parameters<typeof p.onKeyDown>[0]);
    expect(runs).toBe(0);
  });

  it('the risk rows render as focusable buttons', () => {
    const html = render(alexApi('en', { route }), page);
    expect(html).toMatch(/class="rk-i [^"]*" role="button" tabindex="0"/);
  });
});
