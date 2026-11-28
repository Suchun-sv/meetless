import AsyncStorage from '@react-native-async-storage/async-storage';

/** The locale choice (not a secret). Same key as the web bridge, so both agree on the web. */
export const LOCALE_KEY = 'meetless.locale';

export async function loadLocale(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LOCALE_KEY);
  } catch {
    return null;
  }
}

export async function saveLocale(locale: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // Storage unavailable: the choice lasts for this run only.
  }
}
