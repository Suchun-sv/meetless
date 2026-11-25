import { describe, expect, it } from 'vitest';
import { createTranslator, SUPPORTED_LOCALES } from '@meetless/i18n';
import { signInError } from '../src/renderer/setup/SignIn';
import { fakeApi, sample } from './support/app';

const URL = 'http://127.0.0.1:4890';

describe('sign-in error text', () => {
  it('shows error.RATE_LIMITED with {seconds} from details.retryAfter, in both languages', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const tr = createTranslator(locale);
      const app = fakeApi({ live: sample(locale).state, me: 'u-alex', locale });
      for (const retryAfter of [42, 7]) {
        const text = signInError(app, { ok: false, code: 'RATE_LIMITED', details: { url: URL, retryAfter } }, URL);
        expect(text).toBe(tr.t('signin.failed', { url: URL, reason: tr.t('error.RATE_LIMITED', { seconds: retryAfter }) }));
        expect(text).toContain(String(retryAfter));
      }
    }
  });

  it('never shows a made-up wait when retryAfter is missing', () => {
    const tr = createTranslator('en');
    const app = fakeApi({ live: sample('en').state, me: 'u-alex', locale: 'en' });
    const text = signInError(app, { ok: false, code: 'RATE_LIMITED', details: { url: URL } }, URL);
    expect(text).toBe(tr.t('signin.failed', { url: URL, reason: tr.t('error.generic', { code: 'RATE_LIMITED' }) }));
    expect(text).not.toMatch(/\d+s\b/);
  });

  it('keeps the other reasons: a network message, a timeout and an unknown code', () => {
    const tr = createTranslator('en');
    const app = fakeApi({ live: sample('en').state, me: 'u-alex', locale: 'en' });
    expect(signInError(app, { ok: false, code: 'NETWORK', details: { url: URL, message: 'ECONNREFUSED' } }, URL)).toBe(
      tr.t('signin.failed', { url: URL, reason: `${tr.t('error.NETWORK')} (ECONNREFUSED)` }),
    );
    expect(signInError(app, { ok: false, code: 'TIMEOUT', details: { url: URL, seconds: 3 } }, URL)).toBe(tr.t('signin.failed', { url: URL, reason: tr.t('error.TIMEOUT', { seconds: 3 }) }));
    expect(signInError(app, { ok: false, code: 'HTTP_503', details: { url: URL, status: 503 } }, 'http://other')).toBe(
      tr.t('signin.failed', { url: URL, reason: tr.t('error.generic', { code: 'HTTP_503' }) }),
    );
  });
});
