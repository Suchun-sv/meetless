import { describe, expect, it } from 'vitest';
import { DOT_RE, needByCode, needVersion, type State } from '@meetless/core';
import { createTranslator, type Locale } from '@meetless/i18n';
import { LinkModal } from '../../src/renderer/collab/LinkModal';
import { PromptBox } from '../../src/renderer/collab/PromptBox';
import { copyText } from '../../src/renderer/collab/clipboard';
import { fakeApi, render, sample } from '../support/app';
import { guards } from '../support/guards';
import { Log } from '../support/log';

const ATLAS = 'sample-atlas';
const TODAY = '2026-11-24';
const LOCALES: Locale[] = ['zh-CN', 'en'];

function promptHtml(live: State, me: string, locale: Locale, projectId: string, needId: string, defaultOpen?: boolean): string {
  return render(fakeApi({ live, me, locale, today: TODAY }), <PromptBox projectId={projectId} needId={needId} defaultOpen={defaultOpen} />);
}

function modalHtml(live: State, me: string, locale: Locale, projectId: string, needId: string): string {
  return render(fakeApi({ live, me, locale, today: TODAY, overlay: { kind: 'link', projectId, needId } }), <LinkModal overlay={{ kind: 'link', projectId, needId }} />);
}

/** A shared parent `n-a` and Alex's private child `n-child`, both on project `p`. */
function sharedParentPrivateChild(): Log {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale: 'en' });
  log.emit('project.created', 'u-alex', { projectId: 'p', name: 'P' });
  log.emit('need.created', 'u-alex', {
    needId: 'n-a',
    projectId: 'p',
    kind: 'ext',
    title: 'Shared parent',
    roundId: null,
    source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
  });
  log.emit('need.created', 'u-alex', {
    needId: 'n-child',
    projectId: 'p',
    kind: 'hyp',
    title: "Alex's secret idea",
    roundId: null,
    parentId: 'n-a',
    private: true,
    source: { src: 'chat', date: '2026-11-02', quote: 'q', ref: 'r' },
  });
  return log;
}

describe('PromptBox', () => {
  it('the prompt names the meetless link and the report instruction', () => {
    const live = sample('en').state;
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const html = promptHtml(live, 'u-alex', 'en', ATLAS, n2.id);
    const t = createTranslator('en').t;

    expect(html).toContain('data-testid="lk-prompt"');
    expect(html).toContain(`meetless://${ATLAS}/N2`);
    expect(html).toContain(t('lk.prompt2'));
    expect(html).toContain(t('lk.copy'));
  });

  it('the open preview shows the shareable context with its version', () => {
    const live = sample('en').state;
    const n2 = needByCode(live, ATLAS, 'N2')!;
    expect(needVersion(n2)).toBe(2);
    const html = promptHtml(live, 'u-alex', 'en', ATLAS, n2.id, true);
    const t = createTranslator('en').t;

    expect(html).toContain('data-testid="lk-context"');
    expect(html).toContain(t('lk.gen', { t: t('lk.now'), v: 2 }));
    expect(html).toContain('data-testid="lk-refresh"');
  });

  it('a private need gives no prompt', () => {
    const log = sharedParentPrivateChild();
    const t = createTranslator('en').t;
    const html = promptHtml(log.state, 'u-alex', 'en', 'p', 'n-child');

    expect(html).toContain(t('lk.privateFirst'));
    expect(html).not.toContain('data-testid="lk-prompt"');
    expect(html).not.toContain('data-testid="lk-copy"');
    expect(html).not.toContain('data-testid="lk-context"');
  });

  it("Alex's preview of a parent never shows his private child", () => {
    const log = sharedParentPrivateChild();
    const html = promptHtml(log.state, 'u-alex', 'en', 'p', 'n-a', true);

    expect(html).toContain('data-testid="lk-context"');
    expect(html).not.toContain('secret idea');
  });
});

describe('copyText', () => {
  it('reports false without a clipboard', async () => {
    expect(await copyText('x')).toBe(false);
  });
});

describe('LinkModal', () => {
  it('renders the title and the prompt box for a visible need', () => {
    const live = sample('en').state;
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const html = modalHtml(live, 'u-alex', 'en', ATLAS, n2.id);
    const t = createTranslator('en').t;

    expect(html).toContain('data-testid="overlay-link"');
    expect(html).toContain(t('lk.btn'));
    expect(html).toContain('data-testid="lk-prompt"');
  });

  it('a need not in live at all shows dr.missing and a close, without crashing', () => {
    const live = sample('en').state;
    const t = createTranslator('en').t;
    const html = modalHtml(live, 'u-alex', 'en', ATLAS, 'no-such-need');

    expect(html).toContain(t('dr.missing'));
    expect(html).not.toContain('data-testid="lk-prompt"');
    expect(html).toContain(t('close'));
  });

  it('a private need shows lk.privateFirst and a close, without crashing', () => {
    const log = sharedParentPrivateChild();
    const t = createTranslator('en').t;
    const html = modalHtml(log.state, 'u-alex', 'en', 'p', 'n-child');

    expect(html).toContain(t('lk.privateFirst'));
    expect(html).not.toContain('data-testid="lk-prompt"');
    expect(html).toContain(t('close'));
  });

  it.each(LOCALES)('the link modal has no dot symbol (%s)', (locale) => {
    const live = sample(locale).state;
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const n3 = needByCode(live, ATLAS, 'N3')!;

    // The closed modal and the private-need fallback carry no raw markdown, so they get the
    // full markup guard (dots, marks before codes, inline styles).
    guards(`link modal closed ${locale}`, modalHtml(live, 'u-alex', locale, ATLAS, n3.id));
    const log = sharedParentPrivateChild();
    guards(`link modal private ${locale}`, promptHtml(log.state, 'u-alex', locale, 'p', 'n-child'));

    // The open preview embeds the need's raw markdown (headings start with "# <code>"), which
    // the mark-before-code guard would misread as a kind mark, so it only gets the dot check.
    const open = promptHtml(live, 'u-alex', locale, ATLAS, n2.id, true);
    expect(DOT_RE.test(open), `link modal open ${locale}: dot character`).toBe(false);
  });
});
