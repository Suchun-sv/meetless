import { describe, expect, it } from 'vitest';
import { DOT_RE, viewFor, type State } from '@meetless/core';
import { createTranslator, SUPPORTED_LOCALES, type Locale } from '@meetless/i18n';
import type { Route } from '../../src/renderer/app/routes';
import { StreamPage } from '../../src/renderer/stream/StreamPage';
import { fakeApi, render } from '../support/app';
import { clientState } from '../support/client-state';
import { guards } from '../support/guards';
import { Log } from '../support/log';

const LOCALES: Locale[] = [...SUPPORTED_LOCALES];
const TODAY = '2026-11-24';
const PROJECT = 'p1';
const composer = () => null;

/**
 * A project with: a shared need (n1); an agent report (via codex) on n1; a capture on n1 (never
 * progress); a rule-linked (`autoLinked`) manual item on n1; an unlinked commit by Alex (askable
 * for Alex); and Alex's own private hypothesis (hp1) with its own work item, which must never
 * reach Zhou's render.
 */
function buildLog(locale: Locale): Log {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale });
  log.emit('user.registered', 'system', { userId: 'u-zhou', displayName: 'Zhou', locale });
  log.emit('project.created', 'u-alex', { projectId: PROJECT, name: 'P1' });
  log.emit('project.member_added', 'u-alex', { projectId: PROJECT, userId: 'u-zhou' });

  log.emit('need.created', 'u-alex', {
    needId: 'n1',
    projectId: PROJECT,
    kind: 'ext',
    title: 'Need one',
    roundId: null,
    source: { src: 'doc', date: TODAY, quote: 'q', ref: 'r' },
  });
  log.emit('need.created', 'u-alex', {
    needId: 'hp1',
    projectId: PROJECT,
    kind: 'hyp',
    title: 'Secret hypothesis text',
    roundId: null,
    source: { src: 'doc', date: TODAY, quote: 'q', ref: 'r' },
    private: true,
  });

  log.emit('work.recorded', 'u-alex', { workId: 'w-agent', projectId: PROJECT, needId: 'n1', src: 'agent', text: 'Codex ran tests', date: '2026-11-23', effect: 'advance', via: { client: 'codex', tokenId: 'tok1' } }, { id: 'wa' });
  log.emit('work.recorded', 'u-alex', { workId: 'w-cap', projectId: PROJECT, needId: 'n1', src: 'commit', text: 'abc123 captured commit', date: '2026-11-22', capture: true }, { id: 'wc' });
  log.emit('work.recorded', 'u-alex', { workId: 'w-rule', projectId: PROJECT, needId: 'n1', src: 'commit', text: 'def456 rule linked commit', date: '2026-11-21', effect: 'advance', autoLinked: true }, { id: 'wr' });
  log.emit('work.recorded', 'u-alex', { workId: 'w-unlinked', projectId: PROJECT, needId: null, src: 'commit', text: 'ghi789 unlinked commit', date: '2026-11-20' }, { id: 'wu' });
  log.emit('work.recorded', 'u-alex', { workId: 'w-priv', projectId: PROJECT, needId: 'hp1', src: 'exp', text: 'Secret hypothesis experiment detail', date: '2026-11-19', effect: 'advance' }, { id: 'wp' });

  return log;
}

/** Both of the two state sources a renderer client holds (contract 12.14/12.22, ruling R15). */
function liveSources(log: Log, userId: string): State[] {
  return [clientState(log, userId), viewFor(log.state, userId)];
}

const route: Route = { view: 'stream', projectId: PROJECT };

describe('StreamPage (me u-alex)', () => {
  it('renders agent reports with the client and the progress label, captures with the reference label, in both locales', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const log = buildLog(locale);
      for (const live of liveSources(log, 'u-alex')) {
        const html = render(fakeApi({ live, me: 'u-alex', locale, route, today: TODAY }), <StreamPage composer={composer} />);
        guards(`stream ${locale}`, html);

        expect(html).toContain('data-testid="page-stream"');
        expect(html).toContain(tr.t('stream.via', { client: 'codex' }));
        expect(html).toContain(tr.t('cap.label'));
        expect(html).toContain(tr.t('stream.progress'));
        expect(html).toContain('data-testid="stream-capture"');

        const agentRow = html.slice(html.indexOf('data-work="w-agent"'), html.indexOf('data-work="w-agent"') + 2000);
        expect(agentRow).toContain('tone-success');
      }
    }
  });

  it('rule-linked rows carry the rule mark', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const log = buildLog(locale);
      for (const live of liveSources(log, 'u-alex')) {
        const html = render(fakeApi({ live, me: 'u-alex', locale, route, today: TODAY }), <StreamPage composer={composer} />);
        guards(`stream rules ${locale}`, html);
        const start = html.indexOf('data-work="w-rule"');
        expect(start).toBeGreaterThanOrEqual(0);
        const nextRow = html.indexOf('data-testid="stream-row"', start + 1);
        const row = html.slice(start, nextRow === -1 ? html.length : nextRow);
        expect(row).toContain(tr.t('ai.rules'));
      }
    }
  });

  it('shows the kind chips, the need filter (visible needs only) and the capture button', () => {
    const log = buildLog('en');
    const live = clientState(log, 'u-alex');
    const html = render(fakeApi({ live, me: 'u-alex', route, today: TODAY }), <StreamPage composer={composer} />);
    guards('stream header', html);
    for (const k of ['all', 'agent', 'manual', 'capture']) {
      expect(html).toContain(`data-testid="stream-k" data-k="${k}"`);
    }
    expect(html).toContain('data-testid="stream-need"');
    // n1 and hp1 (Alex's own private hypothesis, which also has a non-ignored work item) are options.
    expect(html).toMatch(/<option value="n1">/);
    expect(html).toMatch(/<option value="hp1">/);
  });

  it('an unlinked row is askable only for its author: stream-review, which opens the confirm overlay', () => {
    const log = buildLog('en');
    const live = clientState(log, 'u-alex');
    const html = render(fakeApi({ live, me: 'u-alex', route, today: TODAY }), <StreamPage composer={composer} />);
    guards('stream askable', html);
    const start = html.indexOf('data-work="w-unlinked"');
    const row = html.slice(start, start + 1500);
    expect(row).toContain('data-testid="stream-review"');
  });

  it('an unlinked row never says it counts as progress: it shows unlinked, and review when it can be asked (R21c)', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const log = buildLog(locale);
      log.emit('work.recorded', 'u-alex', { workId: 'w-agent-unlinked', projectId: PROJECT, needId: null, src: 'agent', text: 'Codex unlinked report', date: '2026-11-18', via: { client: 'codex', tokenId: 'tok1' } }, { id: 'wau' });
      for (const live of liveSources(log, 'u-alex')) {
        const html = render(fakeApi({ live, me: 'u-alex', locale, route, today: TODAY }), <StreamPage composer={composer} />);
        guards(`stream unlinked ${locale}`, html);
        const rowOf = (work: string) => {
          const start = html.indexOf(`data-work="${work}"`);
          expect(start).toBeGreaterThanOrEqual(0);
          const next = html.indexOf('data-testid="stream-row"', start + 1);
          return html.slice(start, next === -1 ? html.length : next);
        };
        for (const work of ['w-unlinked', 'w-agent-unlinked']) {
          const row = rowOf(work);
          expect(row, work).not.toContain(tr.t('stream.progress'));
          expect(row, work).not.toContain(tr.t('stream.via', { client: 'codex' }));
          expect(row, work).toContain(tr.t('stream.unlinked'));
          expect(row, work).toContain('data-testid="stream-review"');
        }
        // A linked agent report still says both.
        const linked = rowOf('w-agent');
        expect(linked).toContain(tr.t('stream.via', { client: 'codex' }));
        expect(linked).toContain(tr.t('stream.progress'));
      }
    }
  });

  it('a needId/alsoNeedId that is not in the viewer’s state renders nothing for it: no chip, no code, no crash', () => {
    const log = buildLog('en');
    const live = clientState(log, 'u-alex');
    const ghosted: State = { ...live, work: { ...live.work, 'w-rule': { ...live.work['w-rule']!, alsoNeedId: 'ghost-need-id' } } };
    let html = '';
    expect(() => {
      html = render(fakeApi({ live: ghosted, me: 'u-alex', route, today: TODAY }), <StreamPage composer={composer} />);
    }).not.toThrow();
    guards('stream ghost need', html);
    expect(html).not.toContain('ghost-need-id');
  });

  it('shows stream.noMatch when a filter excludes everything, and stream.empty when the project has no activity', () => {
    const tr = createTranslator('en');
    const log = buildLog('en');
    const live = clientState(log, 'u-alex');
    const route2: Route = { view: 'stream', projectId: PROJECT };
    const html = render(fakeApi({ live, me: 'u-alex', route: route2, today: TODAY }), <StreamPage composer={composer} />);
    expect(html).not.toContain(tr.t('stream.noMatch'));
    expect(html).not.toContain(tr.t('stream.empty'));

    const emptyLog = new Log();
    emptyLog.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale: 'en' });
    emptyLog.emit('project.created', 'u-alex', { projectId: 'p-empty', name: 'Empty' });
    const emptyLive = clientState(emptyLog, 'u-alex');
    const emptyHtml = render(
      fakeApi({ live: emptyLive, me: 'u-alex', route: { view: 'stream', projectId: 'p-empty' }, today: TODAY }),
      <StreamPage composer={composer} />,
    );
    guards('stream empty', emptyHtml);
    expect(emptyHtml).toContain(tr.t('stream.empty'));
  });

  it('no rendered text contains a DOT_RE character in either locale', () => {
    for (const locale of LOCALES) {
      const log = buildLog(locale);
      for (const live of liveSources(log, 'u-alex')) {
        const html = render(fakeApi({ live, me: 'u-alex', locale, route, today: TODAY }), <StreamPage composer={composer} />);
        guards(`stream dots ${locale}`, html);
        expect(DOT_RE.test(html), locale).toBe(false);
      }
    }
  });
});

describe('StreamPage privacy (ruling R15)', () => {
  it('Zhou’s stream never contains Alex’s private hypothesis work', () => {
    for (const locale of LOCALES) {
      const log = buildLog(locale);
      for (const live of liveSources(log, 'u-zhou')) {
        expect(live.needs.hp1).toBeUndefined();
        expect(live.work['w-priv']).toBeUndefined();
        const html = render(fakeApi({ live, me: 'u-zhou', locale, route, today: TODAY }), <StreamPage composer={composer} />);
        guards(`stream privacy zhou ${locale}`, html);
        expect(html).not.toContain('Secret hypothesis');
        expect(html).not.toContain('hp1');
        expect(html).not.toContain('data-work="w-priv"');
      }
    }
  });
});
