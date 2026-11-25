import { describe, expect, it } from 'vitest';
import { DOT_RE } from '@meetless/core';
import { createTranslator, NAMESPACE_OWNERS } from '@meetless/i18n';

const NEW = ['ask.xt.new','ask.xt.hyp','ask.xt.rev','ask.xt.action','ask.from','ask.accept','ask.ignore','ask.link','ask.linkOther','ask.newHyp','ask.skip','ask.park','ask.drop','ask.next','cf.pick','cf.send','ho.noRole','ho.nobody','ho.privateFirst','ho.note','ho.sendQuestion','ho.sendBack','lk.now','lk.copyFailed','lk.privateFirst','dr.via','dr.pending','dr.review','dr.missing','nn.manual'];

describe('U2 copy', () => {
  it('every new U2 key exists in both locales, has no dot and sits in a U2 namespace', () => {
    for (const l of ['zh-CN', 'en'] as const) for (const k of NEW) {
      const tr = createTranslator(l); expect(tr.has(k), `${l} ${k}`).toBe(true); expect(DOT_RE.test(tr.tDynamic(k)), k).toBe(false);
    }
    for (const k of NEW) expect(NAMESPACE_OWNERS[k.split('.')[0]!]).toBe('U2');
  });

  it('ask.sub names detected items and questions', () => {
    expect(createTranslator('en').t('ask.sub')).toMatch(/^Detected items/); expect(createTranslator('zh-CN').t('ask.sub')).toMatch(/^识别结果/);
  });
});
