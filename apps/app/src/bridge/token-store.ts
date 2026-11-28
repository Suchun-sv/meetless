import * as SecureStore from 'expo-secure-store';

/** The native session: server, personal token and who it is. Kept in the keychain (expo-secure-store). */
export interface StoredSession {
  serverUrl: string;
  token: string;
  userId: string;
  displayName: string;
}

const KEY = 'meetless.session';

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<StoredSession>;
    return s.serverUrl && s.token && s.userId ? { serverUrl: s.serverUrl, token: s.token, userId: s.userId, displayName: s.displayName ?? s.userId } : null;
  } catch {
    return null;
  }
}

export async function saveSession(s: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(s));
}

export async function clearSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Nothing stored.
  }
}
