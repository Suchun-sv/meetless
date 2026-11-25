import { describe, expect, it } from 'vitest';
import { DOT_RE, noDots, viewFor, type State } from '@meetless/core';
import { createTranslator, formatDay, SUPPORTED_LOCALES, type Locale } from '@meetless/i18n';
import type { Route } from '../../src/renderer/app/routes';
import { DeliverForm } from '../../src/renderer/deliveries/DeliverForm';
import { DeliveriesPage } from '../../src/renderer/deliveries/DeliveriesPage';
import { fakeApi, render } from '../support/app';
import { clientState } from '../support/client-state';
import { guards } from '../support/guards';
import { Log } from '../support/log';

const LOCALES: Locale[] = [...SUPPORTED_LOCALES];
const TODAY = '2026-11-24';
const PROJECT = 'p1';
const composer = () => null;

/**
 * A project with: r1, delivered (its shared need n1 frozen into the account; a feedback need n4,
 * logged by Zhou, carrying the lineage back to r1); r2, current after r1's delivery (a shared
 * need n2 in its draft account, plus Alex's own private need np1 and a hypothesis h1, neither of
 * which may ever reach the draft or Zhou's render).
 */
function buildLog(locale: Locale): Log {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale });
  log.emit('user.registered', 'system', { userId: 'u-zhou', displayName: 'Zhou', locale });
  log.emit('project.created', 'u-alex', { projectId: PROJECT, name: 'P1' });
  log.emit('project.member_added', 'u-alex', { projectId: PROJECT, userId: 'u-zhou' });

  log.emit('round.created', 'u-alex', { roundId: 'r1', projectId: PROJECT, title: 'Round one', kind: 'cadence', start: '2026-11-01', due: '2026-11-10' });
  log.emit('round.created', 'u-alex', { roundId: 'r2', projectId: PROJECT, title: 'Round two', kind: 'hard', start: '2026-11-11', due: '2026-11-20' });

  log.emit('need.created', 'u-alex', { needId: 'n1', projectId: PROJECT, kind: 'ext', title: 'Need one', roundId: 'r1', source: { src: 'doc', date: TODAY, quote: 'q1', ref: 'r' } });
  log.emit('round.delivered', 'u-alex', { roundId: 'r1', date: '2026-11-10', items: ['Shipped x'] });

  log.emit('need.created', 'u-zhou', { needId: 'n4', projectId: PROJECT, kind: 'ext', title: 'Feedback need', roundId: null, fromRoundId: 'r1', source: { src: 'meeting', date: '2026-11-10', quote: 'please also do y', ref: 'review' } });
  log.emit('need.created', 'u-alex', { needId: 'n2', projectId: PROJECT, kind: 'ext', title: 'Need two', roundId: 'r2', source: { src: 'doc', date: TODAY, quote: 'q2', ref: 'r' } });
  log.emit('need.created', 'u-alex', { needId: 'np1', projectId: PROJECT, kind: 'ext', title: 'Secret need text', roundId: 'r2', source: { src: 'doc', date: TODAY, quote: 'q3', ref: 'r' }, private: true });
  log.emit('need.created', 'u-alex', { needId: 'h1', projectId: PROJECT, kind: 'hyp', title: 'A hypothesis', roundId: 'r2', source: { src: 'doc', date: TODAY, quote: 'q4', ref: 'r' } });

  return log;
}

/** Both of the two state sources a renderer client holds (contract 12.14/12.22, ruling R15). */
function liveSources(log: Log, userId: string): State[] {
  return [clientState(log, userId), viewFor(log.state, userId)];
}

const route: Route = { view: 'deliveries', projectId: PROJECT };

/** The slice of `html` for the round numbered `n`, up to the next `dl-round` section (or the end). */
function roundHtml(html: string, n: number): string {
  const start = html.indexOf(`data-round="${n}"`);
  expect(start, `round ${n} not found`).toBeGreaterThanOrEqual(0);
  const next = html.indexOf('data-testid="dl-round"', start + 1);
  return html.slice(start, next === -1 ? html.length : next);
}

describe('DeliveriesPage (me u-alex)', () => {
  it('renders the timeline, sections, statuses as coloured text and the draft rule mark, in both locales', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const log = buildLog(locale);
      for (const live of liveSources(log, 'u-alex')) {
        const html = render(fakeApi({ live, me: 'u-alex', locale, route, today: TODAY }), <DeliveriesPage composer={composer} />);
        guards(`deliveries ${locale}`, html);

        expect(html).toContain('data-testid="page-deliveries"');
        expect(html).toContain('class="tl"');
        expect(html).toContain(tr.t('app.rules'));
        expect(html).toContain(tr.t('dl.draft'));

        const delivered = roundHtml(html, 1);
        expect(delivered).toContain('tone-success');
        expect(delivered).toContain(tr.t('dl.deliveredOn', { d: formatDay('2026-11-10', locale) }));
        expect(delivered).toContain(tr.t('dl.feedback'));
        expect(delivered).toContain('please also do y');

        const current = roundHtml(html, 2);
        expect(current).toContain('tone-info');
        expect(current).toContain(tr.t('app.rules'));
        expect(current).toContain('data-testid="dl-deliver"');
      }
    }
  });

  it('a project without rounds offers round setup', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale: 'en' });
    log.emit('project.created', 'u-alex', { projectId: 'p-empty', name: 'Empty' });
    const live = clientState(log, 'u-alex');
    const emptyRoute: Route = { view: 'deliveries', projectId: 'p-empty' };
    const tr = createTranslator('en');
    const html = render(fakeApi({ live, me: 'u-alex', route: emptyRoute, today: TODAY }), <DeliveriesPage composer={composer} />);
    guards('deliveries no rounds', html);
    expect(html).toContain('data-testid="page-deliveries"');
    expect(html).toContain(tr.t('dl.noRounds'));
    expect(html).toContain('data-testid="dl-set-rounds"');
  });

  it('no rendered text contains a DOT_RE character in either locale', () => {
    for (const locale of LOCALES) {
      const log = buildLog(locale);
      for (const live of liveSources(log, 'u-alex')) {
        const html = render(fakeApi({ live, me: 'u-alex', locale, route, today: TODAY }), <DeliveriesPage composer={composer} />);
        guards(`deliveries dots ${locale}`, html);
        expect(DOT_RE.test(html), locale).toBe(false);
      }
    }
  });
});

/**
 * Final review I1 and screenshot defect R21b: a delivered round's account rows carry the frozen
 * per-need note, and the feedback line names who logged it, both through noDots (a display name
 * like 「约翰·史密斯」 carries a middle dot).
 */
describe('DeliveriesPage: delivered notes and dotted names (I1, R21b)', () => {
  const NOTE = 'Slides 3–5 · failure analysis • done';
  const NAME = '约翰·史密斯';
  function dottedLog(locale: Locale): Log {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale });
    log.emit('user.registered', 'system', { userId: 'u-john', displayName: NAME, locale });
    log.emit('project.created', 'u-alex', { projectId: PROJECT, name: 'P1' });
    log.emit('project.member_added', 'u-alex', { projectId: PROJECT, userId: 'u-john' });
    log.emit('round.created', 'u-alex', { roundId: 'r1', projectId: PROJECT, title: 'Round one', kind: 'cadence', start: '2026-11-01', due: '2026-11-10' });
    log.emit('need.created', 'u-alex', { needId: 'n1', projectId: PROJECT, kind: 'ext', title: 'Need one', roundId: 'r1', source: { src: 'doc', date: TODAY, quote: 'q1', ref: 'r' } });
    log.emit('round.delivered', 'u-alex', { roundId: 'r1', date: '2026-11-10', items: ['Shipped x'], account: [{ needId: 'n1', status: 'met', note: NOTE }] });
    log.emit('need.created', 'u-john', { needId: 'n4', projectId: PROJECT, kind: 'ext', title: 'Feedback need', roundId: null, fromRoundId: 'r1', source: { src: 'meeting', date: '2026-11-10', quote: 'please also do y', ref: 'review' } });
    return log;
  }

  it('shows the frozen account note and the feedback author through noDots, in both locales', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const log = dottedLog(locale);
      for (const live of liveSources(log, 'u-alex')) {
        const html = render(fakeApi({ live, me: 'u-alex', locale, route, today: TODAY }), <DeliveriesPage composer={composer} />);
        guards(`deliveries dotted ${locale}`, html);
        const delivered = roundHtml(html, 1);
        expect(delivered).toContain(noDots(NOTE));
        expect(delivered).toContain(tr.t('in.from', { who: noDots(NAME) }));
        expect(DOT_RE.test(html), locale).toBe(false);
      }
    }
  });
});

describe('DeliveriesPage privacy (ruling R15)', () => {
  it('Zhou’s render never contains Alex’s private need, in either locale, in the draft or anywhere else', () => {
    for (const locale of LOCALES) {
      const log = buildLog(locale);
      for (const live of liveSources(log, 'u-zhou')) {
        expect(live.needs.np1).toBeUndefined();
        const html = render(fakeApi({ live, me: 'u-zhou', locale, route, today: TODAY }), <DeliveriesPage composer={composer} />);
        guards(`deliveries privacy zhou ${locale}`, html);
        expect(html).not.toContain('Secret need text');
        expect(html).not.toContain('np1');
      }
    }
  });
});

describe('DeliverForm', () => {
  it('prefills the textarea with the draft items and renders through guards()', () => {
    const log = buildLog('en');
    const live = clientState(log, 'u-alex');
    const round = live.rounds.r2!;
    const html = render(fakeApi({ live, me: 'u-alex', route, today: TODAY }), <DeliverForm round={round} items={['Draft item one', 'Draft item two']} />);
    guards('deliver form', html);
    expect(html).toContain('data-testid="dl-items"');
    expect(html).toContain('data-testid="dl-confirm"');
    expect(html).toContain('Draft item one\nDraft item two');
  });
});
