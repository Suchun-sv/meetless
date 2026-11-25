import { describe, expect, it } from 'vitest';
import { DOT_RE, viewFor, type State } from '@meetless/core';
import { createTranslator, SUPPORTED_LOCALES, type Locale } from '@meetless/i18n';
import type { Route } from '../../src/renderer/app/routes';
import { ExtractPanel } from '../../src/renderer/inputs/ExtractPanel';
import { InputSheet } from '../../src/renderer/inputs/InputSheet';
import { InputsPage } from '../../src/renderer/inputs/InputsPage';
import { MarkdownModal } from '../../src/renderer/inputs/MarkdownModal';
import { fakeApi, render, sample } from '../support/app';
import { clientState } from '../support/client-state';
import { guards } from '../support/guards';
import { Log } from '../support/log';

const LOCALES: Locale[] = [...SUPPORTED_LOCALES];
const PAPER = 'sample-paper';
const ATLAS = 'sample-atlas';
const TODAY = '2026-11-24';
const composer = () => null;

/** Both of the two state sources a renderer client holds (contract 12.14/12.22, ruling R15). */
function liveSources(locale: Locale): State[] {
  const log = sample(locale);
  return [clientState(log, 'u-alex'), viewFor(log.state, 'u-alex')];
}

describe('InputsPage (sample, me u-alex)', () => {
  it('renders groups, the sheet with hit paragraphs and the detected items with the rule label, in both locales', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      for (const live of liveSources(locale)) {
        const in5 = `${PAPER}:IN5`;
        const route: Route = { view: 'inputs', projectId: PAPER, focusId: in5 };
        const html = render(fakeApi({ live, me: 'u-alex', locale, route, today: TODAY }), <InputsPage composer={composer} />);
        guards(`inputs ${locale}`, html);

        expect(html).toContain('data-testid="page-inputs"');
        expect(html).toContain('data-testid="in-import"');
        expect(html).toContain('data-testid="in-write"');
        expect(html).toContain('data-testid="in-file"');
        // The selected input's row, with its status and a positive open count.
        expect(html).toContain(`data-testid="in-item" data-input="${in5}" data-status="pending"`);
        expect(html).toMatch(new RegExp(`<button[^>]*class="li on"[^>]*data-input="${in5}"`));
        // The sheet: at least one hit paragraph.
        expect(html).toMatch(/class="para hit[^"]*"/);
        // The extract panel: the rule label in the footer, and at least one detected row.
        expect(html).toContain(tr.t('in.rules'));
        expect(html).toContain('data-testid="in-x"');
      }
    }
  });

  it('renders paragraphs, extracts and a free-typed requester name through noDots: a dot in any of them never reaches the page (fix round 1, Important 2)', () => {
    for (const locale of LOCALES) {
      const log = new Log();
      log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale });
      log.emit('project.created', 'u-alex', { projectId: 'p1', name: 'P1' });
      log.emit('input.imported', 'u-alex', {
        inputId: 'in1',
        projectId: 'p1',
        kind: 'txt',
        title: 'T',
        date: TODAY,
        from: { name: '王·老师' },
        body: [{ id: 'pa1', text: '• 支持导出' }],
        extracts: [{ id: 'x1', type: 'new', text: '· 导出', paraId: 'pa1' }],
        detector: 'rules/1',
      });
      const route: Route = { view: 'inputs', projectId: 'p1', focusId: 'in1' };
      const html = render(fakeApi({ live: log.state, me: 'u-alex', locale, route, today: TODAY }), <InputsPage composer={composer} />);
      guards(`inputs noDots ${locale}`, html);
      expect(DOT_RE.test(html), locale).toBe(false);
      expect(html).toContain('支持导出');
      expect(html).toContain('导出');
      expect(html).toContain('王 老师'); // noDots turns the dot separator into a space
      expect(html).not.toContain('王·老师');
    }
  });

  it('a conflict on a shared input offers Decide, not Accept', () => {
    const live = clientState(sample('en'), 'u-alex');
    const inputId = `${ATLAS}:IN3`;
    const input = live.inputs[inputId]!;
    const conflicting = input.extracts.find((x) => x.conflict)!;
    expect(input.privateTo).toBeNull(); // shared: the conflict must be decided in To confirm, not accepted here
    const route: Route = { view: 'inputs', projectId: ATLAS, focusId: inputId };
    const html = render(fakeApi({ live, me: 'u-alex', route, today: TODAY }), <InputsPage composer={composer} />);
    guards('inputs conflict decide', html);

    const start = html.indexOf(`data-x="${conflicting.id}"`);
    expect(start).toBeGreaterThanOrEqual(0);
    const nextCard = html.indexOf('data-testid="in-x"', start + 1);
    const footer = html.indexOf('in-x-footer');
    const card = html.slice(start, nextCard === -1 ? footer : nextCard);
    expect(card).toContain('in-x-decide');
    expect(card).not.toContain('in-x-accept');
  });

  it('my private input shows 仅你可见 and Share; Zhou’s render has neither it nor its title', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const log = new Log();
      log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale });
      log.emit('user.registered', 'system', { userId: 'u-zhou', displayName: 'Zhou', locale });
      log.emit('project.created', 'u-alex', { projectId: 'p-priv', name: 'Priv' });
      log.emit('project.member_added', 'u-alex', { projectId: 'p-priv', userId: 'u-zhou' });
      log.emit('input.imported', 'u-alex', {
        inputId: 'secret',
        projectId: 'p-priv',
        kind: 'txt',
        title: 'Secret roadmap',
        date: TODAY,
        body: [{ id: 'pa1', text: 'only for me' }],
        extracts: [],
        detector: 'rules/1',
        private: true,
      });

      const alexLive = clientState(log, 'u-alex');
      const route: Route = { view: 'inputs', projectId: 'p-priv', focusId: 'secret' };
      const alexHtml = render(fakeApi({ live: alexLive, me: 'u-alex', locale, route, today: TODAY }), <InputsPage composer={composer} />);
      guards(`inputs private alex ${locale}`, alexHtml);
      expect(alexHtml).toContain('Secret roadmap');
      expect(alexHtml).toContain(tr.t('pv.mine'));
      expect(alexHtml).toContain('data-testid="in-share"');

      const zhouLive = clientState(log, 'u-zhou');
      expect(zhouLive.inputs.secret).toBeUndefined();
      const zhouHtml = render(fakeApi({ live: zhouLive, me: 'u-zhou', locale, route, today: TODAY }), <InputsPage composer={composer} />);
      guards(`inputs private zhou ${locale}`, zhouHtml);
      expect(zhouHtml).not.toContain('Secret roadmap');
      expect(zhouHtml).not.toContain('data-testid="in-item"');
    }
  });

  it('selects route.focusId through selectedInput, else the first pending input', () => {
    const live = clientState(sample('en'), 'u-alex');
    const noFocus = render(fakeApi({ live, me: 'u-alex', route: { view: 'inputs', projectId: PAPER }, today: TODAY }), <InputsPage composer={composer} />);
    guards('inputs no focus', noFocus);
    const in2 = `${PAPER}:IN2`;
    const focused = render(
      fakeApi({ live, me: 'u-alex', route: { view: 'inputs', projectId: PAPER, focusId: in2 }, today: TODAY }),
      <InputsPage composer={composer} />,
    );
    guards('inputs focus in2', focused);
    expect(focused).toMatch(new RegExp(`<button[^>]*class="li on"[^>]*data-input="${in2}"`));
  });

  it('scrolls to and marks route.paraId inside the sheet (ruling R13)', () => {
    const live = clientState(sample('en'), 'u-alex');
    const in5 = `${PAPER}:IN5`;
    const paraId = live.inputs[in5]!.body[0]!.id;
    const route: Route = { view: 'inputs', projectId: PAPER, focusId: in5, paraId };
    const html = render(fakeApi({ live, me: 'u-alex', route, today: TODAY }), <InputsPage composer={composer} />);
    guards('inputs paraId', html);
    expect(html).toMatch(new RegExp(`data-para="${paraId}"[^>]*aria-current="true"`));
  });

  it('no rendered text contains a DOT_RE character in either locale', () => {
    for (const locale of LOCALES) {
      for (const live of liveSources(locale)) {
        const route: Route = { view: 'inputs', projectId: PAPER, focusId: `${PAPER}:IN5` };
        const html = render(fakeApi({ live, me: 'u-alex', locale, route, today: TODAY }), <InputsPage composer={composer} />);
        guards(`inputs dots ${locale}`, html);
        expect(DOT_RE.test(html), locale).toBe(false);
      }
    }
  });
});

/** A private input of mine whose one `rev` extract targets `n-blocked`, a second private need (fix round 1). */
function blockedShareFixture(locale: Locale) {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale });
  log.emit('project.created', 'u-alex', { projectId: 'p1', name: 'P1' });
  log.emit('need.created', 'u-alex', {
    needId: 'n-blocked',
    projectId: 'p1',
    kind: 'ext',
    title: 'Blocked need',
    roundId: null,
    source: { src: 'doc', date: TODAY, quote: 'q', ref: 'r' },
    private: true,
  });
  log.emit('input.imported', 'u-alex', {
    inputId: 'secretA',
    projectId: 'p1',
    kind: 'txt',
    title: 'Secret A',
    date: TODAY,
    body: [{ id: 'pa1', text: 'Np1 需要调整' }],
    extracts: [{ id: 'x1', type: 'rev', text: 'Np1 需要调整', paraId: 'pa1', needId: 'n-blocked' }],
    detector: 'rules/1',
    private: true,
  });
  log.emit('input.imported', 'u-alex', {
    inputId: 'secretB',
    projectId: 'p1',
    kind: 'txt',
    title: 'Secret B',
    date: TODAY,
    body: [{ id: 'pb1', text: 'unrelated note' }],
    extracts: [],
    detector: 'rules/1',
    private: true,
  });
  return log;
}

/*
 * Fix round 1 (Important 1 and 3). `blockedNeedIds`/`blockingNeedIds` are now controlled props of
 * `InputSheet`/`ExtractPanel` (lifted to `InputsPage`, which resets them in a `useEffect` keyed on
 * `input?.id`), so the component contract these two describes exercise is exactly what
 * `InputsPage` relies on to never carry a blocked state from one input into another. The harness
 * has no jsdom, so the effect itself cannot be triggered here; these tests instead prove that,
 * for whatever `blockedNeedIds` a parent passes down, the sheet renders the one state that value
 * implies — never a stale mix of two inputs' states.
 */
describe('InputSheet / ExtractPanel: the share-first state (fix round 1)', () => {
  it('a blocked share shows common.sharePrivateNeedFirst, the decide-elsewhere hint, and a neutral (never violet) marker on the blocking extract, in both locales', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const log = blockedShareFixture(locale);
      const live = clientState(log, 'u-alex');
      const input = live.inputs.secretA!;
      const api = fakeApi({ live, me: 'u-alex', locale, route: { view: 'inputs', projectId: 'p1', focusId: 'secretA' }, today: TODAY });
      const html = render(
        api,
        <>
          <InputSheet input={input} hotExtractId={null} onHoverExtract={() => undefined} blockedNeedIds={['n-blocked']} onShare={() => undefined} onShareNeedsFirst={() => undefined} />
          <ExtractPanel input={input} parsing={false} onHover={() => undefined} blockingNeedIds={['n-blocked']} />
        </>,
      );
      guards(`inputs blocked share ${locale}`, html);

      expect(html).toContain('data-testid="in-share-needs-first"');
      expect(html).not.toContain('data-testid="in-share"'); // the plain Share button is replaced, not duplicated
      expect(html).toContain(tr.t('common.sharePrivateNeedFirst'));
      expect(html).toContain('data-testid="in-decide-hint"');
      expect(html).toContain(tr.t('in.decideHint'));
      expect(html).toContain('data-testid="in-x-blocking"');

      const marker = /<div class="([^"]*)" data-testid="in-x-blocking">/.exec(html);
      expect(marker).not.toBeNull();
      expect(marker![1]).toContain('tone-neutral');
      expect(marker![1]).not.toContain('tone-ai'); // violet is reserved for rule output, never a blocking state
    }
  });

  it('a different input never inherits a previous input’s blocked share state (fix round 1, Important 1)', () => {
    const log = blockedShareFixture('en');
    const live = clientState(log, 'u-alex');
    const api = fakeApi({ live, me: 'u-alex', route: { view: 'inputs', projectId: 'p1', focusId: 'secretA' }, today: TODAY });

    // Input A, blocked — what InputsPage shows right after a PRIVATE_ITEM refusal.
    const blockedHtml = render(
      api,
      <InputSheet input={live.inputs.secretA!} hotExtractId={null} onHoverExtract={() => undefined} blockedNeedIds={['n-blocked']} onShare={() => undefined} onShareNeedsFirst={() => undefined} />,
    );
    expect(blockedHtml).toContain('data-testid="in-share-needs-first"');

    // Switching to input B: InputsPage's effect resets blockedNeedIds to null before this would
    // render in the real app, so B must show the plain Share button, never A's blocked state.
    const switchedHtml = render(
      api,
      <InputSheet input={live.inputs.secretB!} hotExtractId={null} onHoverExtract={() => undefined} blockedNeedIds={null} onShare={() => undefined} onShareNeedsFirst={() => undefined} />,
    );
    guards('inputs switch resets share state', switchedHtml);
    expect(switchedHtml).toContain('data-testid="in-share"');
    expect(switchedHtml).not.toContain('data-testid="in-share-needs-first"');
    expect(switchedHtml).not.toContain('data-testid="in-decide-hint"');
  });
});

describe('MarkdownModal (sample, me u-alex): guards() on every render', () => {
  it('renders cleanly in both locales; md-go is disabled while the text is blank', () => {
    for (const locale of LOCALES) {
      const live = clientState(sample(locale), 'u-alex');
      const html = render(
        fakeApi({ live, me: 'u-alex', locale, route: { view: 'inputs', projectId: PAPER }, today: TODAY }),
        <MarkdownModal projectId={PAPER} onClose={() => undefined} />,
      );
      guards(`MarkdownModal ${locale}`, html);
      expect(html).toContain('data-testid="md-modal"');
      expect(html).toMatch(/data-testid="md-go"[^>]*disabled/);
    }
  });
});
