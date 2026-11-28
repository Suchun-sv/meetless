import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { getLocales } from 'expo-localization';
import {
  createTranslator,
  formatClock,
  formatDateTime,
  formatDay,
  isSupportedLocale,
  resolveLocale,
  SUPPORTED_LOCALES,
  type Locale,
  type MessageKey,
  type Params,
  type Translator,
} from '@meetless/i18n';
import { loadLocale, saveLocale } from './storage';

export { SUPPORTED_LOCALES, type Locale, type MessageKey, type Params, type Translator };

/** Language names are shown in their own language, not translated. */
export const LANG_LABEL: Record<Locale, string> = { 'zh-CN': '中文', en: 'EN' };

export interface I18n {
  locale: Locale;
  setLocale(l: Locale): void;
  tr: Translator;
  t(key: MessageKey, params?: Params): string;
  /** `error.<code>` when the catalogue has it, else the generic error with the code. */
  errorText(code: string): string;
  timeZone: string;
  fmtDay(d: string): string;
  fmtClock(iso: string): string;
  fmtDateTime(iso: string): string;
}

function systemLocales(): string[] {
  try {
    return getLocales()
      .map((l) => l.languageTag)
      .filter(Boolean);
  } catch {
    return [];
  }
}

const Ctx = createContext<I18n | null>(null);

/**
 * The UI language, before and after sign-in: the stored choice, else the system preference.
 * `onChange` lets the app also record the choice for the signed-in user (best effort).
 */
export function I18nProvider({ children, onChange }: { children: ReactNode; onChange?: (l: Locale) => void }) {
  const [locale, setLocaleState] = useState<Locale>(() => resolveLocale(systemLocales()));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadLocale().then((stored) => {
      if (!alive) return;
      if (stored && isSupportedLocale(stored)) setLocaleState(stored);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    (l: Locale) => {
      setLocaleState(l);
      void saveLocale(l);
      onChange?.(l);
    },
    [onChange],
  );

  const value = useMemo<I18n>(() => {
    const tr = createTranslator(locale);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    return {
      locale,
      setLocale,
      tr,
      t: tr.t,
      errorText: (code) => (tr.has(`error.${code}`) ? tr.tDynamic(`error.${code}`) : tr.tDynamic('error.generic', { code })),
      timeZone,
      fmtDay: (d) => formatDay(d, locale),
      fmtClock: (iso) => formatClock(iso, locale, timeZone),
      fmtDateTime: (iso) => formatDateTime(iso, locale, timeZone),
    };
  }, [locale, setLocale]);

  if (!ready) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}

/** The translate function: `const t = useT(); t('nav.home')`. */
export function useT(): I18n['t'] {
  return useI18n().t;
}

/** For a stored string that may not be a supported locale. */
export function asLocale(x: string | null | undefined): Locale | null {
  return x && isSupportedLocale(x) ? x : null;
}
