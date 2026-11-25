import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ClientNode, LocalCache } from '@meetless/client';
import { catalogue, createTranslator, FALLBACK_LOCALE, resolveLocale, SUPPORTED_LOCALES, type MessageKey } from '@meetless/i18n';

/**
 * Runtime checks for the headless smoke mode of the packaged app
 * (MEETLESS_SMOKE=1, see main.ts). This module has no Electron dependency so
 * the same checks also run under plain Node in the unit tests. In the
 * packaged app it proves that node:sqlite, the bundled client engine (with
 * ws) and the i18n resources resolve from inside app.asar.
 */
export interface SmokeCheck {
  name: string;
  ok: boolean;
  detail: unknown;
}

export interface SmokeCheckOptions {
  /** Writable scratch directory (a temp dir in smoke mode). */
  dataDir: string;
  systemLocales: string[];
}

const SAMPLE_KEYS: MessageKey[] = ['app.name', 'nav.home', 'nav.board'];

export async function runSmokeChecks(opts: SmokeCheckOptions): Promise<SmokeCheck[]> {
  const checks: SmokeCheck[] = [];
  const check = async (name: string, fn: () => unknown): Promise<void> => {
    try {
      checks.push({ name, ok: true, detail: await fn() });
    } catch (e) {
      checks.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  };
  const assert = (cond: unknown, msg: string): void => {
    if (!cond) throw new Error(msg);
  };

  await check('node:sqlite loads and runs SQL', () => {
    const db = new DatabaseSync(':memory:');
    const row = db.prepare('select sqlite_version() as v, 6 * 7 as answer').get() as { v: string; answer: number };
    db.close();
    assert(row.answer === 42, 'unexpected query result');
    return { sqliteVersion: row.v };
  });

  await check('local cache (SQLite file) persists across reopen', () => {
    const file = join(opts.dataDir, 'smoke-cache', 'cache.sqlite');
    const token = randomUUID();
    const a = new LocalCache(file);
    a.setSetting('smoke', token);
    a.close();
    const b = new LocalCache(file);
    const back = b.getSetting('smoke');
    const cursor = b.cursor;
    b.close();
    assert(back === token, 'setting not read back after reopen');
    return { kind: a.kind, cursor };
  });

  await check('client engine opens in the data dir (no session)', async () => {
    const node = await ClientNode.open({ dataDir: join(opts.dataDir, 'client'), systemLocales: opts.systemLocales, host: 'electron' });
    const snap = await node.snapshot();
    await node.close();
    assert(snap.cacheKind === 'sqlite', `cacheKind=${snap.cacheKind}`);
    assert(snap.session === null, 'unexpected session in a fresh data dir');
    return { cacheKind: snap.cacheKind, host: snap.host, state: snap.status.state };
  });

  const enKeys = Object.keys(catalogue(FALLBACK_LOCALE));
  for (const locale of SUPPORTED_LOCALES) {
    await check(`i18n ${locale} loads`, () => {
      const cat = catalogue(locale) as Record<string, string>;
      const missing = enKeys.filter((k) => !cat[k]);
      const t = createTranslator(locale);
      const samples = Object.fromEntries(SAMPLE_KEYS.map((k) => [k, t.t(k)]));
      assert(enKeys.length > 0, 'empty reference catalogue');
      assert(missing.length === 0, `${missing.length} missing keys`);
      return { keys: Object.keys(cat).length, missing: missing.length, samples };
    });
  }

  await check('i18n zh-CN and en differ, locale resolution works', () => {
    const zh = createTranslator('zh-CN').t('nav.home');
    const en = createTranslator('en').t('nav.home');
    assert(zh !== en, 'zh-CN text equals en text');
    const resolved = {
      'zh-Hans-CN': resolveLocale(['zh-Hans-CN']),
      'en-GB': resolveLocale(['en-GB']),
      system: resolveLocale(opts.systemLocales),
    };
    assert(resolved['zh-Hans-CN'] === 'zh-CN' && resolved['en-GB'] === 'en', JSON.stringify(resolved));
    return resolved;
  });

  return checks;
}
