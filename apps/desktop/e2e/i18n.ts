import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Locale, MessageKey, Params } from '@meetless/i18n';

/*
 * UI copy for e2e specs. Playwright's loader cannot import `@meetless/i18n` (its catalogues are JSON
 * modules imported without `with { type: 'json' }`), so this reads the same resource files and
 * mirrors `createTranslator`'s lookup: the locale's text, else the `en` text, with `{name}`
 * placeholders filled and a missing param shown as `…`. A key in neither catalogue throws, so a
 * spec never asserts on placeholder text.
 */
const RESOURCES = resolve(import.meta.dirname, '../../../packages/i18n/resources');
const cache = new Map<Locale, Record<string, string>>();
const catalogue = (locale: Locale): Record<string, string> => {
  let c = cache.get(locale);
  if (!c) {
    c = JSON.parse(readFileSync(resolve(RESOURCES, `${locale}.json`), 'utf8')) as Record<string, string>;
    cache.set(locale, c);
  }
  return c;
};

export function text(locale: Locale, key: MessageKey, params?: Params): string {
  const template = catalogue(locale)[key] || catalogue('en')[key];
  if (!template) throw new Error(`no copy for ${key} in ${locale} or en`);
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params?.[name];
    return v === undefined ? '…' : String(v);
  });
}
