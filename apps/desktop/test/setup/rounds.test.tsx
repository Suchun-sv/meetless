import { describe, expect, it } from 'vitest';
import { projectRounds, viewFor } from '@meetless/core';
import { createTranslator } from '@meetless/i18n';
import type { Route } from '../../src/renderer/app/routes';
import { RoundsPage } from '../../src/renderer/setup/RoundsPage';
import { render, sample } from '../support/app';
import { guards } from '../support/guards';
import { alexApi, LOCALES, sampleWith, textOf } from '../shell/u1';

const route: Route = { view: 'rounds', projectId: 'sample-atlas' };
const page = <RoundsPage composer={() => null} />;

describe('RoundsPage', () => {
  it.each(LOCALES)('(%s) Atlas rounds: one current, planned rows can start, delivered rows have no controls', (l) => {
    const live = viewFor(sample(l).state, 'u-alex');
    const rounds = projectRounds(live, 'sample-atlas');
    const planned = rounds.filter((r) => r.status === 'planned');
    const current = rounds.filter((r) => r.status === 'current');
    const delivered = rounds.filter((r) => r.status === 'delivered');
    // The Atlas sample carries at least one of each status (two delivered rounds, one current, one planned).
    expect(current).toHaveLength(1);
    expect(planned.length).toBeGreaterThan(0);
    expect(delivered.length).toBeGreaterThan(0);

    const html = render(alexApi(l, { route }), page);
    const t = createTranslator(l).t;
    expect(html).toContain('data-testid="page-rounds"');
    expect(html.match(/data-testid="round"/g)).toHaveLength(rounds.length);
    // Only planned rows can be made current.
    expect(html.match(/data-testid="round-start-now"/g)?.length).toBe(planned.length);
    // Only non-delivered rows (current and planned) carry an edit control.
    expect(html.match(/data-testid="round-edit"/g)).toHaveLength(current.length + planned.length);
    // Every delivered round's row is marked frozen (no edit control, title attribute names why).
    expect(html.match(new RegExp(`title="${t('pj.frozen')}"`, 'g'))).toHaveLength(delivered.length);
    for (const s of [t('round.current'), t('round.planned'), t('round.delivered')]) expect(html).toContain(s);
  });

  it('a project with no rounds shows pj.noRounds and the add form', () => {
    const state = sampleWith('en', [{ type: 'project.created', payload: { projectId: 'p-empty', name: 'Empty' } }]);
    const emptyRoute: Route = { view: 'rounds', projectId: 'p-empty' };
    const html = render(alexApi('en', { state, route: emptyRoute }), page);
    const t = createTranslator('en').t;
    expect(textOf(html)).toContain(t('pj.noRounds'));
    expect(html).toContain('data-testid="round-add"');
    expect(html).not.toContain('data-testid="round-start-now"');
    expect(html).not.toContain('data-testid="round"');
  });

  it.each(LOCALES)('no dot symbol on rounds (%s)', (l) => {
    guards('rounds', render(alexApi(l, { route }), page));
  });
});
