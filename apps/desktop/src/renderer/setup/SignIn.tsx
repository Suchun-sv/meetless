import { useState } from 'react';
import { SUPPORTED_LOCALES } from '@meetless/i18n';
import { useApp, type AppApi } from '../app/AppContext';
import { isWeb } from '../ui/DesktopOnly';
import { Btn } from '../ui/primitives';
import { LANG_LABEL } from '../shell/Sidebar';
import { inviteFormError, signInMessage } from './model';
import './setup.css';

/**
 * The visible reason for a failed sign-in or invite redemption, with the URL tried (contract §12.8).
 * One rule for both forms: it is `setup/model.ts`'s `signInMessage`. `RATE_LIMITED` reads its wait
 * from `details.retryAfter`; without it, no wait is made up.
 */
export function signInError(app: Pick<AppApi, 't' | 'tr' | 'errorText'>, r: { ok: false; code: string; details?: unknown }, server: string): string {
  return signInMessage(app.t, app.tr, app.errorText, r, server);
}

/**
 * Sign-in (design §8.7): the first account comes from the admin invite, later ones from a member
 * invite, both redeemed with a name and a code, no password. The dev-token form stays alongside
 * it for tests and development. Both forms are visible with no extra click; either one's error
 * shows in `signin-error` and a request in flight shows `signin-busy`.
 */
export function SignIn() {
  const app = useApp();
  const { bridge, t, locale, setLocale } = app;
  const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  // On the web the server is the page's own origin: no server field (design 2026-11-25 §6).
  const web = isWeb(app);
  const origin = typeof location === 'undefined' ? '' : location.origin;
  const [typedServer, setServer] = useState(q.get('server') ?? 'http://127.0.0.1:4870');
  const server = web ? origin : typedServer;
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bridgeErrorMessage = (e: unknown) => t('signin.failed', { url: server, reason: t('signin.bridgeError', { message: String((e as Error)?.message ?? e) }) });

  const redeem = async () => {
    if (busy) return;
    const invalid = inviteFormError(t, { server, name, code });
    if (invalid) return setError(invalid);
    setBusy(true);
    setError(null);
    try {
      const r = await bridge.redeemInvite(server, code, name);
      if (!r.ok) setError(signInError(app, r, server));
    } catch (e) {
      setError(bridgeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const signInWithToken = async () => {
    if (busy) return;
    // Never fail silently: an empty token, a bad URL, a timeout or a transport error all show a reason.
    if (!token.trim()) return setError(web ? t('web.tokenMissing') : t('signin.tokenMissing'));
    setBusy(true);
    setError(null);
    try {
      const r = await bridge.signIn(server, token);
      if (!r.ok) setError(signInError(app, r, server));
    } catch (e) {
      setError(bridgeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin" data-testid="signin">
      <div className="signin-card">
        <div className="brand">
          <span className="brand-mark" />
          {t('app.name')}
        </div>
        {!web && (
          <label className="signin-field">
            <span className="small muted">{t('signin.server')}</span>
            <input
              className="inp"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                void signInWithToken();
              }}
              data-testid="signin-server"
            />
          </label>
        )}

        <form
          className="signin-form"
          onSubmit={(e) => {
            e.preventDefault();
            void redeem();
          }}
        >
          <h2>{t('signin.inviteTitle')}</h2>
          <label className="signin-field">
            <span className="small muted">{t('signin.name')}</span>
            <input className="inp" value={name} onChange={(e) => setName(e.target.value)} data-testid="signin-name" />
          </label>
          <label className="signin-field">
            <span className="small muted">{t('signin.code')}</span>
            <input className="inp" value={code} onChange={(e) => setCode(e.target.value)} data-testid="signin-code" autoComplete="off" />
          </label>
          <p className="small muted">{t('signin.inviteHint')}</p>
          <Btn kind="primary" type="submit" disabled={busy} testId="signin-redeem">
            {busy ? t('signin.busyShort') : t('signin.redeem')}
          </Btn>
        </form>

        <form
          className="signin-form signin-dev"
          onSubmit={(e) => {
            e.preventDefault();
            void signInWithToken();
          }}
        >
          {web ? (
            <h2 className="muted">{t('signin.tokenTitle')}</h2>
          ) : (
            <>
              <h2 className="muted">{t('signin.devTitle')}</h2>
              <p className="small tone-warning">{t('signin.devOnly')}</p>
            </>
          )}
          <label className="signin-field">
            <span className="small muted">{web ? t('web.tokenLabel') : t('signin.token')}</span>
            <input
              className="inp"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={web ? t('web.tokenHint') : t('signin.tokenHint')}
              data-testid="signin-token"
              autoComplete="off"
            />
          </label>
          <Btn kind="primary" type="submit" disabled={busy} testId="signin-submit">
            {busy ? t('signin.busyShort') : t('signin.submit')}
          </Btn>
        </form>

        {error && (
          <p className="small tone-danger" role="alert" data-testid="signin-error">
            {error}
          </p>
        )}
        {busy && (
          <p className="small muted" data-testid="signin-busy">
            {t('signin.busy', { url: server })}
          </p>
        )}

        <div className="seg seg-xs">
          {SUPPORTED_LOCALES.map((l) => (
            <button type="button" key={l} data-lang={l} className={l === locale ? 'on' : undefined} onClick={() => setLocale(l)}>
              {LANG_LABEL[l]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
