import { describe, expect, it } from 'vitest';
import { allRisks, DEFAULT_HOME_CARDS, homeItems, viewFor, waitingCount } from '@meetless/core';
import { HomePage } from '../../src/renderer/dash/HomePage';
import { confirmRows, projectTag, riskText } from '../../src/renderer/dash/model';
import { fakeApi, render, sample } from '../support/app';
import { guards } from '../support/guards';
import { alexApi, LOCALES, privateTitle, sampleWith, textOf, zhouApi } from '../shell/u1';

const today = '2026-11-24';
const page = <HomePage composer={() => null} />;

describe('HomePage', () => {
  it.each(LOCALES)('(%s) hero counts what waits and the six default Home cards render', (l) => {
    const api = alexApi(l);
    const html = render(api, page);
    expect(textOf(html)).toContain(api.t('home.hi', { n: waitingCount(api.live, 'u-alex', today) }));
    expect([...html.matchAll(/data-card="(\w+)"/g)].map((m) => m[1])).toEqual([...DEFAULT_HOME_CARDS]);
  });

  it('handed to me: Lin’s Atlas N3 handoff is sent, so accept, ask and decline show', () => {
    const html = render(alexApi('en'), page);
    expect(html).toContain('data-testid="home-accept"');
    expect(html).toContain('data-testid="home-ask"');
    expect(html).toContain('data-testid="home-decline"');
  });

  it('I handed off: Zhou’s N2 shows the stale line with the current version', () => {
    const api = alexApi('en');
    const html = render(api, page);
    expect(textOf(html)).toContain(api.t('ho.stale', { v: 2 }));
  });

  it('to confirm lists the Atlas conflict and the paper questions with their project tags', () => {
    // HO2 declined makes paper N5 a stale question (the sample alone has none), next to the unlinked one.
    const api = alexApi('en', { state: sampleWith('en', [{ type: 'handoff.responded', payload: { handoffId: 'sample-paper:HO2', response: 'declined' } }]) });
    const html = render(api, page);
    const text = textOf(html);
    const items = homeItems(api.live, 'u-alex', today).confirm;
    const rows = confirmRows(api.t, api.live, 'u-alex', items, today);

    const conflictRow = rows.find((r) => r.tag === 'conflict');
    expect(conflictRow).toBeDefined();
    expect(text).toContain(projectTag(api.live.projects[conflictRow!.projectId]!.name));
    expect(text).toContain(api.t('cf.title'));

    const questionRows = rows.filter((r) => r.tag === 'question');
    expect(questionRows).toHaveLength(2);
    for (const row of questionRows) expect(text).toContain(projectTag(api.live.projects[row.projectId]!.name));
  });

  it('owned by me includes Alex’s own private need on Home; Zhou’s Home never does', () => {
    expect(textOf(render(alexApi('en'), page))).toContain(privateTitle('en'));
    expect(textOf(render(zhouApi('en'), page))).not.toContain(privateTitle('en'));
  });

  it('a user with no projects sees pj.empty and the new-project button', () => {
    const api = fakeApi({ live: viewFor(sample('en').state, 'u-eve'), me: 'u-eve', route: { view: 'home' } });
    const html = render(api, page);
    expect(textOf(html)).toContain(api.t('pj.empty'));
    expect(html).toContain('data-testid="home-new-project"');
  });

  it('allRisks renders when added', () => {
    const state = sampleWith('en', [{ type: 'dashboard.set', payload: { scope: 'home', cards: [...DEFAULT_HOME_CARDS, 'allRisks'] } }]);
    const api = alexApi('en', { state });
    const html = render(api, page);
    expect([...html.matchAll(/data-card="(\w+)"/g)].map((m) => m[1])).toContain('allRisks');
    const s = viewFor(state, 'u-alex');
    const risks = allRisks(s, 'u-alex', today);
    expect(risks.length).toBeGreaterThan(0);
    expect(textOf(html)).toContain(riskText(api.t, s, risks[0]!));
  });

  it.each(LOCALES)('no dot symbol on Home (%s)', (l) => {
    guards('home', render(alexApi(l), page));
    // With a stale question row, whose text starts with its need code.
    const state = sampleWith(l, [{ type: 'handoff.responded', payload: { handoffId: 'sample-paper:HO2', response: 'declined' } }]);
    guards('home (stale question)', render(alexApi(l, { state }), page));
  });
});
