import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { inviteFormError, signInMessage } from '@renderer/setup/model';
import { ASKS_SERVER, DEFAULT_SERVER_URL } from '@/bridge';
import { LANG_LABEL, SUPPORTED_LOCALES, type Locale } from '@/i18n';
import { colors, radius, shadow, space } from '@/theme';
import { Button, Segmented, Text, TextField } from '@/components/ui';
import { useApp } from '@/state';

type Mode = 'token' | 'invite';

/**
 * Screenshot builds only (EXPO_PUBLIC_DEEPLINK_SIGNIN=1 at bundle time): `meetless://sign-in?server=&token=`
 * fills the form and signs in, so a headless simulator run can get past sign-in. Off in normal builds.
 */
const DEEPLINK_SIGNIN = process.env.EXPO_PUBLIC_DEEPLINK_SIGNIN === '1';
/** Screenshot builds only: a token inlined at bundle time signs in on start (never set in committed config). */
const SCREENSHOT_TOKEN = DEEPLINK_SIGNIN ? (process.env.EXPO_PUBLIC_SCREENSHOT_TOKEN ?? '') : '';

/**
 * Sign-in: a personal token, or an invite code with a name (`invites.redeem`). Native also asks for
 * the server (prefilled); the web uses the page's own origin. Errors name the server tried.
 */
export function SignInScreen() {
  const app = useApp();
  const { bridge, t, tr, errorText, locale, setLocale } = app;
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>(DEEPLINK_SIGNIN ? 'token' : 'invite');
  const [server, setServer] = useState(DEFAULT_SERVER_URL);
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const params = useLocalSearchParams<{ server?: string; token?: string }>();
  const linked = useRef(false);

  const run = async (fn: () => Promise<{ ok: true } | { ok: false; code: string; details?: unknown }>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(signInMessage(t, tr, errorText, r, server));
    } catch (e) {
      setError(t('signin.failed', { url: server, reason: t('signin.bridgeError', { message: String((e as Error)?.message ?? e) }) }));
    } finally {
      setBusy(false);
    }
  };

  const submitToken = () => {
    if (!token.trim()) return setError(t('web.tokenMissing'));
    void run(() => bridge.signIn(server, token));
  };
  const submitInvite = () => {
    const invalid = inviteFormError(t, { server, name, code });
    if (invalid) return setError(invalid);
    void run(() => bridge.redeemInvite(server, code, name));
  };

  useEffect(() => {
    const linkedToken = params.token || SCREENSHOT_TOKEN;
    if (!DEEPLINK_SIGNIN || linked.current || !linkedToken) return;
    linked.current = true;
    const url = params.server || server;
    setServer(url);
    setToken(linkedToken);
    // A screenshot build waits a moment so the sign-in screen itself can be captured.
    setTimeout(() => void run(() => bridge.signIn(url, linkedToken)), params.token ? 0 : 6000);
  });

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[8] }]} keyboardShouldPersistTaps="handled">
        <View style={styles.card} testID="signin">
          <View style={styles.brand}>
            <View style={styles.mark} />
            <Text size="lg" weight="semibold" tight>
              {t('app.name')}
            </Text>
            <View style={{ flex: 1 }} />
            <Segmented<Locale> size="sm" accessibilityLabel={t('user.language')} value={locale} options={SUPPORTED_LOCALES.map((l) => ({ value: l, label: LANG_LABEL[l] }))} onChange={setLocale} />
          </View>
          <Text size="xl" weight="semibold" tight>
            {t('signin.title')}
          </Text>
          <Segmented<Mode>
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
            options={[
              { value: 'invite', label: t('signin.code'), testID: 'signin-mode-invite' },
              { value: 'token', label: t('web.tokenLabel'), testID: 'signin-mode-token' },
            ]}
          />
          {ASKS_SERVER ? (
            <TextField label={t('signin.server')} value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" testID="signin-server" />
          ) : null}
          {mode === 'token' ? (
            <>
              <TextField
                label={t('web.tokenLabel')}
                hint={t('web.tokenHint')}
                value={token}
                onChangeText={setToken}
                autoCapitalize="none"
                secureTextEntry
                mono
                onSubmitEditing={submitToken}
                testID="signin-token"
              />
              <Button label={busy ? t('signin.busyShort') : t('signin.submit')} variant="primary" busy={busy} block onPress={submitToken} testID="signin-submit" />
            </>
          ) : (
            <>
              <TextField label={t('signin.name')} value={name} onChangeText={setName} testID="signin-name" />
              <TextField label={t('signin.code')} value={code} onChangeText={setCode} autoCapitalize="characters" mono onSubmitEditing={submitInvite} testID="signin-code" />
              <Button label={busy ? t('signin.busyShort') : t('signin.redeem')} variant="primary" busy={busy} block onPress={submitInvite} testID="signin-redeem" />
              <Text size="xs" color="textTertiary">
                {t('signin.inviteHint')}
              </Text>
            </>
          )}
          {busy ? (
            <Text size="sm" color="textSecondary" testID="signin-busy">
              {t('signin.busy', { url: server })}
            </Text>
          ) : null}
          {error ? (
            <View style={styles.error} testID="signin-error">
              <Text size="sm" color="danger">
                {error}
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.sidebar },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[4] },
  card: { width: '100%', maxWidth: 420, backgroundColor: colors.bg, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: space[6], gap: space[4], ...shadow.md },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  mark: { width: 20, height: 20, borderRadius: radius.sm, backgroundColor: colors.text },
  error: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: space[3] },
});
