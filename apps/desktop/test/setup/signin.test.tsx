import { describe, expect, it } from 'vitest';
import { createTranslator } from '@meetless/i18n';
import { SignIn } from '../../src/renderer/setup/SignIn';
import { fakeApi, render, sample } from '../support/app';
import { guards } from '../support/guards';
import { LOCALES } from '../shell/u1';

const api = (locale: 'zh-CN' | 'en') => fakeApi({ live: sample(locale).state, me: 'u-alex', locale });
const render1 = (locale: 'zh-CN' | 'en') => render(api(locale), <SignIn />);

describe('SignIn', () => {
  it.each(LOCALES)('(%s) both forms are visible with the stable testids', (l) => {
    const html = render1(l);
    for (const id of ['signin', 'signin-server', 'signin-name', 'signin-code', 'signin-redeem', 'signin-token', 'signin-submit']) expect(html).toContain(`data-testid="${id}"`);
    // No extra click: both forms render together, not behind a tab.
    expect(html.indexOf('data-testid="signin-name"')).toBeLessThan(html.indexOf('data-testid="signin-token"'));
  });

  it.each(LOCALES)('no dot symbol on sign-in (%s)', (l) => {
    guards(`${l} signin`, render1(l));
  });

  it.each(LOCALES)('(%s) the invite form shows its title, hint, labels and the dev form its own title and dev-only note', (l) => {
    const t = createTranslator(l).t;
    const html = render1(l);
    expect(html).toContain(t('signin.inviteTitle'));
    expect(html).toContain(t('signin.inviteHint'));
    expect(html).toContain(t('signin.name'));
    expect(html).toContain(t('signin.code'));
    expect(html).toContain(t('signin.redeem'));
    expect(html).toContain(t('signin.devTitle'));
    expect(html).toContain(t('signin.devOnly'));
    expect(html).toContain(t('signin.submit'));
  });

  it('no error or busy indicator shows before any submit', () => {
    const html = render1('en');
    expect(html).not.toContain('data-testid="signin-error"');
    expect(html).not.toContain('data-testid="signin-busy"');
  });

  it('the server field defaults to the loopback dev address with no ?server= query', () => {
    expect(render1('en')).toContain('value="http://127.0.0.1:4870"');
  });

  it('the brand and the language switcher render, with the current locale marked', () => {
    const html = render1('en');
    expect(html).toContain('Meetless');
    expect(html).toContain('class="seg seg-xs"');
    expect(/data-lang="en"[^>]*class="on"/.test(html)).toBe(true);
    expect(html).toContain('data-lang="zh-CN"');
  });
});
