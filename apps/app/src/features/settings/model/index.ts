import type { UpdateState } from '@meetless/client/bridge';
import { SUPPORTED_LOCALES, type Locale, type MessageKey, type Params } from '@meetless/i18n';

/** Language names in their own language, never translated. */
export const LANG_LABEL: Record<Locale, string> = { 'zh-CN': '中', en: 'EN' };
export const LANG_OPTIONS: readonly { locale: Locale; label: string }[] = SUPPORTED_LOCALES.map((locale) => ({ locale, label: LANG_LABEL[locale] }));

export type Platform = 'web' | 'ios' | 'desktop';

export function signOutKey(platform: Platform): MessageKey {
  return platform === 'desktop' ? 'user.signOut' : 'web.signOut';
}

/** `v<current>` plus the hot commit when there is one. */
export function versionText(state: Pick<UpdateState, 'current' | 'hot'>): string {
  return `v${state.current}${state.hot?.commit ? ` ${state.hot.commit}` : ''}`;
}

export interface StatusLine {
  key: MessageKey;
  params?: Params;
  /** Shown in the danger tone. */
  error: boolean;
}

/**
 * Where updates stand, ported from renderer shell/UpdateEntry.tsx (that file imports CSS, so it
 * is not imported here). `fmtClock` formats `lastChecked`.
 */
export function updateStatus(state: UpdateState, fmtClock: (iso: string) => string): StatusLine {
  const pending = state.hot?.pending;
  const error = !!state.checkError || state.phase === 'failed';
  if (state.checkError) return { key: 'upd.checkFailed', error };
  if (state.available && state.phase === 'downloading') return { key: 'upd.sFound', params: { v: `v${state.available.version}`, n: state.percent ?? 0 }, error };
  if (state.available && state.phase === 'failed') return { key: 'upd.cFailed', error };
  if (state.available) return { key: 'upd.sReady', params: { v: `v${state.available.version}` }, error };
  if (pending) return { key: 'upd.sReady', params: { v: `v${pending.version} ${pending.commit.slice(0, 7)}` }, error };
  if (state.lastChecked) return { key: 'upd.sUpToDate', params: { t: fmtClock(state.lastChecked) }, error };
  return { key: 'upd.sUpToDateNoTime', error };
}

/** What the update callout offers: a full release first, else a hot update (renderer UpdateEntry). */
export interface CalloutModel {
  /** Dismissal is per version: the next one shows again. */
  key: string;
  error: boolean;
  version: string;
  notes: string[];
  body: 'downloading' | 'ready' | 'installing' | 'failed';
  percent: number | null;
  primary: 'restart' | 'refresh' | 'download' | 'retry';
  disabled: boolean;
}

export function calloutModel(s: UpdateState | null): CalloutModel | null {
  if (!s) return null;
  if (s.available) {
    const v = `v${s.available.version}`;
    const base = { key: `full:${s.available.version}`, version: v, notes: s.available.notes, percent: s.percent };
    if (s.install === 'manual') return { ...base, error: false, body: 'ready', primary: 'download', disabled: false };
    if (s.phase === 'failed') return { ...base, error: true, body: 'failed', primary: 'retry', disabled: false };
    if (s.phase === 'downloading') return { ...base, error: false, body: 'downloading', primary: 'restart', disabled: true };
    if (s.phase === 'installing' || s.phase === 'restarting') return { ...base, error: false, body: 'installing', primary: 'restart', disabled: true };
    return { ...base, error: false, body: 'ready', primary: 'restart', disabled: false };
  }
  const p = s.hot?.pending;
  if (p) return { key: `hot:${p.commit}`, error: false, version: `v${p.version} ${p.commit.slice(0, 7)}`, notes: p.notes, body: 'ready', percent: null, primary: p.apply === 'reload' ? 'refresh' : 'restart', disabled: false };
  return null;
}

export function calloutPrimaryKey(m: CalloutModel): MessageKey {
  if (m.primary === 'refresh') return 'upd.refreshNow';
  if (m.primary === 'retry') return 'upd.retry';
  if (m.primary === 'download') return 'upd.download';
  return m.body === 'installing' ? 'upd.installing' : 'upd.restartUpdate';
}

/**
 * The settings page's update block. Web: the running build, plus 「有新版本，点此刷新」 after a
 * `newBuild` event. iOS: the app version only. Desktop: the full updater state.
 */
export type UpdateBlock =
  | { kind: 'web'; version: string | null; newBuild: boolean }
  | { kind: 'ios'; version: string | null }
  | { kind: 'desktop'; version: string; status: StatusLine; callout: CalloutModel | null };

export function updateBlock(
  platform: Platform,
  a: { appVersion: string | null; update: UpdateState | null; newBuild: boolean },
  fmtClock: (iso: string) => string,
): UpdateBlock {
  if (platform === 'desktop' && a.update) return { kind: 'desktop', version: versionText(a.update), status: updateStatus(a.update, fmtClock), callout: calloutModel(a.update) };
  if (platform === 'ios') return { kind: 'ios', version: a.appVersion ? `v${a.appVersion}` : null };
  return { kind: 'web', version: a.appVersion ? `v${a.appVersion}` : a.update ? versionText(a.update) : null, newBuild: a.newBuild };
}
