import { describe, expect, it } from 'vitest';
import { createTranslator } from '@meetless/i18n';
import { SignIn } from '../../src/renderer/setup/SignIn';
import { fakeApi, render, sample } from '../support/app';
import { guards } from '../support/guards';
import { LOCALES } from '../shell/u1';

function signIn(locale: 'zh-CN' | 'en', host: 'web' | 'dev-bridge'): string {
  const api = fakeApi({ live: sample(locale).state, me: 'u-alex', locale });
  api.snapshot = { ...api.snapshot, host };
  return render(api, <SignIn />);
}

describe('SignIn on the web', () => {
  it.each(LOCALES)('(%s) no server field, both forms, a personal-token heading and no dev-only note', (l) => {
    const t = createTranslator(l).t;
    const html = signIn(l, 'web');
    expect(html).not.toContain('data-testid="signin-server"');
    for (const id of ['signin-name', 'signin-code', 'signin-redeem', 'signin-token', 'signin-submit']) expect(html).toContain(`data-testid="${id}"`);
    expect(html).toContain(t('signin.tokenTitle'));
    expect(html).not.toContain(t('signin.devOnly'));
    expect(html).not.toContain(t('signin.devTitle'));
    expect(html).not.toContain('type="password"');
    guards(`${l} web signin`, html);
  });

  it.each(LOCALES)('(%s) behind the dev bridge the page is as before', (l) => {
    const t = createTranslator(l).t;
    const html = signIn(l, 'dev-bridge');
    expect(html).toContain('data-testid="signin-server"');
    expect(html).toContain(t('signin.devTitle'));
    expect(html).toContain(t('signin.devOnly'));
    expect(html).not.toContain(t('signin.tokenTitle'));
  });
});
