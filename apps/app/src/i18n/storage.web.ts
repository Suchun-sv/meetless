/** The locale choice in localStorage, under the web bridge's own key. */
export const LOCALE_KEY = 'meetless.locale';

export async function loadLocale(): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(LOCALE_KEY) ?? null;
  } catch {
    return null;
  }
}

export async function saveLocale(locale: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(LOCALE_KEY, locale);
  } catch {
    // Storage disabled: the choice lasts for this page only.
  }
}
