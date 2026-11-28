import { getLocales } from 'expo-localization';
import Constants from 'expo-constants';
import type { MeetlessBridge } from '@meetless/client/bridge';
import { createWebBridge } from '@meetless/client/web';
import type { Capability, DesktopShell } from './capabilities';

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

/**
 * Inside the desktop app (apps/desktop loads this export on app://meetless) the preload exposes the
 * Electron IPC bridge as `window.meetless` (ClientNode: sync, the offline SQLite cache, local git,
 * Overleaf, Notion MCP) and `window.meetlessShell` (what it can do). Used as is: never wrapped
 * (a Proxy over a contextBridge object breaks it).
 */
const w = (typeof window === 'undefined' ? {} : window) as { meetless?: MeetlessBridge; meetlessShell?: DesktopShell };
const desktop = w.meetless && typeof w.meetless.snapshot === 'function' ? w.meetless : null;

/** True in the desktop app. */
export const IS_DESKTOP = desktop !== null;

/** Web: the server is the page's own origin (4877 proxies /v1). Desktop: asked, prefilled like native. */
export const DEFAULT_SERVER_URL: string = IS_DESKTOP
  ? ((Constants.expoConfig?.extra as { serverUrl?: string } | undefined)?.serverUrl ?? '')
  : typeof location === 'undefined'
    ? ''
    : location.origin;
export const ASKS_SERVER = IS_DESKTOP;

/** Desktop-only capabilities (local git capture, Overleaf git, Notion MCP, folder picker, app updates, logs). */
const CAPS: ReadonlySet<Capability> = new Set(IS_DESKTOP && Array.isArray(w.meetlessShell?.capabilities) ? w.meetlessShell.capabilities : []);
export function hasCapability(c: Capability): boolean {
  return CAPS.has(c);
}

/** Desktop: the IPC bridge. Web: the cookie session (`/v1/web/session`), same-origin fetch and WebSocket. */
export function createBridge(): MeetlessBridge {
  return desktop ?? createWebBridge({ origin: location.origin, systemLocales: systemLocales() });
}
