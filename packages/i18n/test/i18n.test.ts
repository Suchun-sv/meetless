import { describe, expect, it } from 'vitest';
import { ARTIFACT_KINDS, DOMAIN_ERROR_CODES, DOT_RE, EXT_STATUSES, HANDOFF_STATES, HOME_CARDS, HYP_STATUSES, PROJECT_CARDS, SOURCE_KINDS, WORK_EFFECTS } from '@meetless/core';
import { API_ERROR_CODES, MCP_TOOLS } from '@meetless/api';
import { catalogue, CONTEXT_LABEL_KEYS, contextLabels, createTranslator, formatDateTime, formatDay, formatNumber, NAMESPACE_OWNERS, resolveLocale, SUPPORTED_LOCALES, type Locale } from '../src/index';

const keys = (l: Locale) => Object.keys(catalogue(l)).sort();

describe('catalogues', () => {
  it('zh-CN and en have exactly the same keys and no empty values', () => {
    expect(keys('zh-CN')).toEqual(keys('en'));
    for (const l of SUPPORTED_LOCALES) {
      for (const [k, v] of Object.entries(catalogue(l))) expect(v.trim(), `${l}:${k}`).not.toBe('');
    }
  });

  it('every domain code the UI can show has text in every locale', () => {
    const required = [
      ...DOMAIN_ERROR_CODES.map((c) => `error.${c}`),
      ...[...EXT_STATUSES, ...HYP_STATUSES].map((s) => `st.${s}`),
      ...WORK_EFFECTS.map((e) => `ef.${e}`),
      ...SOURCE_KINDS.map((s) => `src.${s}`),
      ...HANDOFF_STATES.map((s) => `ho.st.${s}`),
      ...[...PROJECT_CARDS, ...HOME_CARDS].map((c) => `w.${c}`),
      ...ARTIFACT_KINDS.map((a) => `afk.${a}`),
      'kind.ext',
      'kind.hyp',
      'round.current',
      'round.planned',
      'round.delivered',
    ];
    for (const l of SUPPORTED_LOCALES) {
      const missing = required.filter((k) => !(k in catalogue(l)));
      expect(missing, l).toEqual([]);
    }
  });

  it('no translation contains a dot symbol (middle dot, bullet, katakana dot)', () => {
    for (const l of SUPPORTED_LOCALES) for (const [k, v] of Object.entries(catalogue(l))) expect(DOT_RE.test(v), `${l}:${k} = ${v}`).toBe(false);
  });

  it('each share-first refusal has its action copy (PRIVATE_SOURCE, PRIVATE_ITEM with details.needIds)', () => {
    expect([catalogue('zh-CN')['common.shareSourceFirst'], catalogue('en')['common.shareSourceFirst']]).toEqual(['先公开来源输入', 'Share the source input first']);
    expect([catalogue('zh-CN')['common.sharePrivateNeedFirst'], catalogue('en')['common.sharePrivateNeedFirst']]).toEqual(['先公开相关的私有需求', 'Share the related private need first']);
  });

  it('placeholders match between languages', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const en = catalogue('en') as Record<string, string>;
    const zh = catalogue('zh-CN') as Record<string, string>;
    for (const k of Object.keys(en)) expect(ph(zh[k]!), k).toEqual(ph(en[k]!));
  });
});

describe('namespaces', () => {
  it('every key belongs to a registered namespace', () => {
    for (const k of Object.keys(catalogue('en'))) expect(NAMESPACE_OWNERS[k.split('.')[0]!], k).toBeDefined();
  });

  it('context label keys exist in both locales', () => {
    for (const l of SUPPORTED_LOCALES) {
      const present = CONTEXT_LABEL_KEYS.filter((k) => !(k in catalogue(l)));
      expect(present, l).toEqual([]);
    }
  });

  it('every MCP tool has t.<tool>; every API error code has error.<code>; in both locales', () => {
    const required = [...MCP_TOOLS.map((t) => `t.${t}`), ...API_ERROR_CODES.map((c) => `error.${c}`)];
    for (const l of SUPPORTED_LOCALES) {
      const missing = required.filter((k) => !(k in catalogue(l)));
      expect(missing, l).toEqual([]);
    }
  });
});

describe('translator', () => {
  it('translates and interpolates', () => {
    expect(createTranslator('zh-CN').t('round.left', { n: 4 })).toBe('剩 4 天');
    expect(createTranslator('en').t('ho.stale', { v: 3 })).toBe('The need is now at v3');
    expect(createTranslator('zh-CN').tDynamic('error.CONFLICT_OPEN')).toBe('这条与现有需求冲突，请在「待确认」里决定。');
  });

  it('falls back to en, then to a placeholder, never the raw key', () => {
    const missing: string[] = [];
    const t = createTranslator('zh-CN', { onMissing: (k) => missing.push(k) });
    const unknown = t.tDynamic('nope.notAKey');
    expect(unknown).toBe('（文本缺失）');
    expect(missing).toEqual(['nope.notAKey']);
    expect(createTranslator('en').tDynamic('also.missing')).toBe('(text unavailable)');
    expect(createTranslator('en').t('round.left')).toBe('… days left');
  });

  it('resolves system locales', () => {
    expect(resolveLocale(['zh-Hans-CN', 'en-US'])).toBe('zh-CN');
    expect(resolveLocale(['zh_TW'])).toBe('zh-CN');
    expect(resolveLocale(['en-GB'])).toBe('en');
    expect(resolveLocale(['fr-FR', 'de'])).toBe('en');
    expect(resolveLocale([])).toBe('en');
  });

  it('context labels exist in both languages and contain no dots', () => {
    for (const l of SUPPORTED_LOCALES) {
      const L = contextLabels(l);
      expect(L.status('refuted')).not.toBe('');
      expect(DOT_RE.test(JSON.stringify(L) + L.round(3, 'x') + L.fetchHint('meetless://p/N1'))).toBe(false);
    }
    expect(contextLabels('zh-CN').round(3, '客户交付')).toBe('第 3 轮 客户交付');
  });
});

describe('regional formats', () => {
  it('the same instant renders per locale with an explicit time zone', () => {
    const iso = '2026-11-12T07:00:00Z';
    expect(formatDateTime(iso, 'zh-CN', 'Asia/Shanghai')).toContain('15:00');
    expect(formatDateTime(iso, 'en', 'Europe/London')).toMatch(/7:00/);
    expect(formatNumber(12345.5, 'en')).toBe('12,345.5');
    expect(formatDay('2026-11-28', 'en')).toBe('Nov 28');
    expect(formatDay('2026-11-28', 'zh-CN')).toBe('11月28日');
  });
});
