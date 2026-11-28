import { getLocales } from 'expo-localization';
import Constants from 'expo-constants';
import type { MeetlessBridge } from '@meetless/client/bridge';
import type { Capability } from './capabilities';
import { createNativeBridge } from './native-bridge';

export type { MeetlessBridge } from '@meetless/client/bridge';
export type { Capability } from './capabilities';

export function systemLocales(): string[] {
  try {
    return getLocales()
      .map((l) => l.languageTag)
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Native: the server the sign-in form starts with (`extra.serverUrl`, from MEETLESS_SERVER_URL at build time; app.config.js). */
export const DEFAULT_SERVER_URL: string = (Constants.expoConfig?.extra as { serverUrl?: string } | undefined)?.serverUrl ?? '';

/** Whether the sign-in form asks for a server (native) or uses the page's own origin (web). */
export const ASKS_SERVER = true;

/** Native is never the desktop app, and has none of its capabilities (src/bridge/capabilities.ts). */
export const IS_DESKTOP = false;
export function hasCapability(_c: Capability): boolean {
  return false;
}

/** Native: bearer token from the keychain on HTTP and WS. */
export function createBridge(): MeetlessBridge {
  return createNativeBridge({ systemLocales: systemLocales() });
}
