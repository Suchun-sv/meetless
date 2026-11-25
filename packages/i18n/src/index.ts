import type { ContextLabels } from '@meetless/core';
import en from '../resources/en.json';
import zhCN from '../resources/zh-CN.json';

export { CONTEXT_LABEL_KEYS, NAMESPACE_OWNERS, type Owner } from './namespaces';

/**
 * UI language resources. Only application-owned text lives here; user content
 * (requirements, notes, decisions) is stored as entered and is never
 * translated in place — translations are separate derived views (see core).
 */

export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const FALLBACK_LOCALE: Locale = 'en';

/** `en` is the reference catalogue: its keys define the typed key space. */
export type MessageKey = keyof typeof en;
export type Catalogue = Record<MessageKey, string>;

const catalogues: Record<Locale, Partial<Catalogue>> = {
  en,
  'zh-CN': zhCN,
};

export function catalogue(locale: Locale): Readonly<Partial<Catalogue>> {
  return catalogues[locale];
}

export function isSupportedLocale(x: string): x is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(x);
}

/**
 * Pick a supported locale from the system's preference list
 * (e.g. `navigator.languages` / `app.getPreferredSystemLanguages()`).
 * Any Chinese variant maps to zh-CN for now; everything else falls back to en.
 */
export function resolveLocale(preferred: readonly string[]): Locale {
  for (const raw of preferred) {
    const tag = raw.replace('_', '-');
    const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const lang = tag.split('-')[0]?.toLowerCase();
    if (lang === 'zh') return 'zh-CN';
    if (lang === 'en') return 'en';
  }
  return FALLBACK_LOCALE;
}

export type Params = Record<string, string | number>;

export interface TranslatorOptions {
  /** Called when a key is missing in the requested locale (telemetry / CI). */
  onMissing?: (key: string, locale: Locale) => void;
}

export interface Translator {
  readonly locale: Locale;
  t(key: MessageKey, params?: Params): string;
  /** For keys built at runtime from core codes, e.g. `error.${code}`. Never returns the raw key. */
  tDynamic(key: string, params?: Params): string;
  has(key: string): boolean;
}

function interpolate(template: string, params: Params | undefined): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params?.[name];
    return v === undefined ? '…' : String(v);
  });
}

export function createTranslator(locale: Locale, opts: TranslatorOptions = {}): Translator {
  const primary = catalogues[locale] as Record<string, string | undefined>;
  const fallback = catalogues[FALLBACK_LOCALE] as Record<string, string | undefined>;
  const lookup = (key: string, params?: Params): string => {
    const own = primary[key];
    if (own !== undefined && own !== '') return interpolate(own, params);
    opts.onMissing?.(key, locale);
    const fb = fallback[key];
    if (fb !== undefined && fb !== '') return interpolate(fb, params);
    // Never expose a resource key to users.
    return primary['common.missingText'] ?? fallback['common.missingText'] ?? '…';
  };
  return {
    locale,
    t: (key, params) => lookup(key, params),
    tDynamic: (key, params) => lookup(key, params),
    has: (key) => primary[key] !== undefined || fallback[key] !== undefined,
  };
}

/**
 * Locale-aware date/time with an explicit time zone label, so that the same
 * underlying instant reads unambiguously in every client (PRD: 区域格式).
 */
export function formatDateTime(iso: string, locale: Locale, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid time ${iso}`);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(d);
}

export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(n);
}

/** Short calendar date (e.g. "Nov 24" / "11月24日") for a YYYY-MM-DD business date. */
export function formatDay(date: string, locale: Locale): string {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}

/** Clock time HH:MM in the user's time zone. */
export function formatClock(iso: string, locale: Locale, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false, ...(timeZone ? { timeZone } : {}) }).format(d);
}

/** Labels for the need context text (what a handoff link resolves to), in one language. */
export function contextLabels(locale: Locale): ContextLabels {
  const tr = createTranslator(locale);
  const d = (k: string, p?: Params) => tr.tDynamic(k, p);
  return {
    kind: (k) => d(`kind.${k}`),
    status: (s) => d(`st.${s}`),
    effect: (e) => d(`ef.${e}`),
    round: (n, title) => `${d('round', { n })} ${title}`,
    due: (date) => d('round.due', { d: date }),
    version: (v) => d('dr.version', { v }),
    date: (x) => formatDay(x, locale),
    accept: d('dr.accept'),
    expect: d('dr.expect'),
    verify: d('dr.verify'),
    verdict: d('dr.verdict'),
    source: d('dr.source'),
    revisions: d('dr.rev'),
    work: d('dr.work'),
    children: d('dr.children'),
    parent: d('dr.parent'),
    artifacts: d('dr.artifacts'),
    refuted: d('cp.refuted'),
    owner: d('cp.owner'),
    requester: d('dr.requester'),
    handoff: d('cp.handoff'),
    captured: d('cp.captured'),
    fetchHint: (link) => d('cp.mcp', { link }),
    report: d('cp.report'),
  };
}
