import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_KINDS,
  DOT_RE,
  EXT_STATUSES,
  HYP_STATUSES,
  INPUT_KINDS,
  SEP,
  SOURCE_KINDS,
  WORK_EFFECTS,
  emptyState,
  type Need,
  type NeedStatus,
  type Project,
  type Risk,
  type Round,
  type State,
} from '@meetless/core';
import { createTranslator, type Locale, type MessageKey } from '@meetless/i18n';
import { AppCtx, type AppApi } from '../src/renderer/app/AppContext';
import type { View } from '../src/renderer/app/routes';
import { Modal } from '../src/renderer/ui/Modal';
import { Placeholder } from '../src/renderer/ui/Placeholder';
import { closesOnClick, FOCUSABLE, trapTab } from '../src/renderer/ui/focus';
import { Avatar, Btn, FileKind, NeedChip, Pill, RulesMark, SourceTag, Status } from '../src/renderer/ui/primitives';
import * as primitives from '../src/renderer/ui/primitives';
import { Timeline } from '../src/renderer/ui/Timeline';
import * as tone from '../src/renderer/ui/tone';
import { EF_TONE, KIND_LABEL, SRC_LABEL_KEY, ST_TONE, avatarTone, riskTone, type Tone } from '../src/renderer/ui/tone';

const TONES: Tone[] = ['neutral', 'info', 'success', 'warning', 'danger', 'ai', 'strong', 'muted'];
const LOCALES: Locale[] = ['zh-CN', 'en'];

function state(): State {
  const s = emptyState();
  s.users['u-alex'] = { id: 'u-alex', displayName: 'Alex Chen', locale: 'en' };
  s.users['u-lin'] = { id: 'u-lin', displayName: '林', locale: 'zh-CN' };
  s.projects.p1 = { id: 'p1', name: 'Paper', memberIds: ['u-alex', 'u-lin'] } as Project;
  s.needs.n1 = { id: 'n1', projectId: 'p1', code: 'N1', kind: 'ext', title: 'Camera-ready PDF with the new related-work section', status: 'doing' } as Need;
  s.needs.h1 = { id: 'h1', projectId: 'p1', code: 'H1', kind: 'hyp', title: 'Caching halves latency', status: 'refuted' } as Need;
  s.rounds.r1 = { id: 'r1', projectId: 'p1', n: 1, title: 'Draft', kind: 'cadence', start: '2026-11-02', due: '2026-11-13', status: 'delivered' } as Round;
  s.rounds.r2 = { id: 'r2', projectId: 'p1', n: 2, title: 'Submission', kind: 'hard', start: '2026-11-16', due: '2026-12-04', status: 'current' } as Round;
  return s;
}

function fake(locale: Locale = 'en', over: Partial<AppApi> = {}): AppApi {
  const tr = createTranslator(locale);
  return {
    live: state(),
    me: 'u-alex',
    today: '2026-11-24',
    locale,
    tr,
    t: tr.t,
    fmtDay: (d: string) => d.slice(5),
    openNeed: () => undefined,
    ...over,
  } as unknown as AppApi;
}

const html = (node: ReactNode, api: AppApi = fake()) => renderToStaticMarkup(<AppCtx.Provider value={api}>{node}</AppCtx.Provider>);

/** Renders a component function inside the provider and returns the element it produced (to call handlers). */
function produced<P extends object>(Comp: (p: P) => ReactNode, props: P, api: AppApi): ReactElement<Record<string, unknown>> {
  let out: ReactNode = null;
  const Probe = () => {
    out = Comp(props);
    return null;
  };
  html(<Probe />, api);
  return out as unknown as ReactElement<Record<string, unknown>>;
}

describe('tone tables', () => {
  const statuses: NeedStatus[] = [...EXT_STATUSES, ...HYP_STATUSES];
  it('every status and effect maps to a Tone; none of them is violet', () => {
    expect(Object.keys(ST_TONE).sort()).toEqual([...statuses].sort());
    expect(Object.keys(EF_TONE).sort()).toEqual([...WORK_EFFECTS].sort());
    for (const t of [...Object.values(ST_TONE), ...Object.values(EF_TONE)]) {
      expect(TONES).toContain(t);
      expect(t).not.toBe('ai');
    }
  });

  it('riskTone maps by risk kind: proposals violet, waiting for you info, stale amber, conflicts red', () => {
    const codes: Risk['code'][] = ['stale', 'waitMe', 'wait', 'asked', 'conflict', 'inputs', 'todo', 'proposal'];
    const tones = (code: Risk['code'], t: Risk['tone']) => {
      const risk: Risk = { projectId: 'p1', code, tone: t };
      return riskTone(risk);
    };
    const expected: Record<Risk['code'], Tone> = { proposal: 'ai', waitMe: 'info', stale: 'warning', conflict: 'danger', asked: 'warning', wait: 'neutral', inputs: 'neutral', todo: 'danger' };
    for (const code of codes) {
      // The kind decides, whatever tone core attached (core marks both waitMe and proposal violet).
      for (const t of ['amber', 'violet', 'gray', 'red'] as const) expect(tones(code, t), `${code}/${t}`).toBe(expected[code]);
    }
    expect(codes.filter((c) => tones(c, 'violet') === 'ai')).toEqual(['proposal']);
    expect('RISK_TONE' in tone).toBe(false);
  });

  it('v4 moves testing and new hypothesis off violet', () => {
    expect(ST_TONE.testing).toBe('info');
    expect(EF_TONE.spawn).toBe('strong');
    expect(ST_TONE.refuted).toBe('muted');
  });

  it('sources are words, not glyphs: every source kind has a label in both locales', () => {
    expect(Object.keys(SRC_LABEL_KEY).sort()).toEqual([...SOURCE_KINDS].sort());
    expect('SRC_GLYPH' in tone).toBe(false);
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      for (const k of SOURCE_KINDS) {
        expect(SRC_LABEL_KEY[k]).toBe(`src.${k}`);
        expect(tr.has(SRC_LABEL_KEY[k])).toBe(true);
        expect(html(<SourceTag src={k} />, fake(locale))).toBe(`<span class="fk fk-src">${tr.t(SRC_LABEL_KEY[k])}</span>`);
      }
    }
  });

  it('file kind labels cover artifact and input kinds', () => {
    for (const k of [...ARTIFACT_KINDS, ...INPUT_KINDS]) expect(KIND_LABEL[k].length).toBeGreaterThan(0);
  });

  it('avatarTone is deterministic, in 1..8, and spreads users', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `u-${i}`);
    for (const id of ids) {
      const n = avatarTone(id);
      expect(n).toBe(avatarTone(id));
      expect(n >= 1 && n <= 8 && Number.isInteger(n)).toBe(true);
    }
    expect(new Set(ids.map(avatarTone)).size).toBeGreaterThan(4);
  });
});

describe('primitives', () => {
  it('Pill and Status render tone classes as coloured text, never a dot', () => {
    expect(html(<Pill tone="info" title="x">Active</Pill>)).toBe('<span class="pill tone-info" title="x">Active</span>');
    for (const locale of LOCALES) {
      for (const s of Object.keys(ST_TONE) as NeedStatus[]) {
        const out = html(<Status s={s} />, fake(locale));
        expect(out).toBe(`<span class="st tone-${ST_TONE[s]}">${createTranslator(locale).t(`st.${s}` as MessageKey)}</span>`);
        expect(DOT_RE.test(out)).toBe(false);
      }
    }
  });

  it('FileKind shows the kind label', () => {
    expect(html(<FileKind kind="pdf" />)).toBe('<span class="fk fk-pdf">PDF</span>');
    expect(html(<FileKind kind="code" />)).toBe('<span class="fk fk-code">GIT</span>');
  });

  it('Avatar uses a tone class and initials, no inline colour', () => {
    const out = html(<Avatar userId="u-alex" size="sm" />);
    expect(out).toBe(`<span class="av av-${avatarTone('u-alex')} av-sm" title="Alex Chen">AC</span>`);
    expect(out).not.toContain('style');
  });

  it('RulesMark labels rule output in violet with the no-AI tip; confirmed is plain', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const out = html(<RulesMark onFix={() => undefined} />, fake(locale));
      expect(out).toContain('class="ai tone-ai"');
      expect(out).toContain(`title="${tr.t('app.rulesTip')}"`);
      expect(out).toContain(tr.t('ai.rules'));
      expect(out).toContain(`<button type="button" class="ai-fix">${tr.t('ai.fix')}</button>`);
      expect(html(<RulesMark />, fake(locale))).not.toContain('ai-fix');
      expect(html(<RulesMark confirmed />, fake(locale))).toBe(`<span class="ai ai-ok">${tr.t('ai.confirmed')}</span>`);
    }
  });

  it('Btn maps kinds to base classes and carries the testid', () => {
    expect(html(<Btn>Go</Btn>)).toBe('<button type="button" class="btn">Go</button>');
    expect(html(<Btn kind="primary" testId="project-create">Go</Btn>)).toBe('<button type="button" class="btn btn-primary" data-testid="project-create">Go</button>');
    expect(html(<Btn kind="sm" disabled>Go</Btn>)).toBe('<button type="button" class="btn btn-sm" disabled="">Go</button>');
    expect(html(<Btn kind="ghost" className="x">Go</Btn>)).toBe('<button type="button" class="btn btn-ghost x">Go</button>');
  });

  it('NeedChip shows the code then the clipped title, and opens the need', () => {
    const opened: [string, string][] = [];
    const api = fake('en', { openNeed: (p: string, n: string) => void opened.push([p, n]) });
    const ext = html(<NeedChip projectId="p1" needId="n1" />, api);
    expect(ext).toMatch(/^<button type="button" class="needchip" title="[^"]+"><span class="mono faint">N1<\/span><span class="nc-t">Camera-ready/);
    const hyp = html(<NeedChip projectId="p1" needId="h1" />, api);
    expect(hyp).toMatch(/^<button type="button" class="needchip nc-hyp nc-ref" title="[^"]+"><span class="mono faint">H1<\/span><span class="nc-t">Caching halves latency<\/span><\/button>$/);
    const el = produced(NeedChip, { projectId: 'p1', needId: 'n1' }, api);
    let stopped = false;
    (el.props.onClick as (e: { stopPropagation(): void }) => void)({ stopPropagation: () => void (stopped = true) });
    expect(opened).toEqual([['p1', 'n1']]);
    expect(stopped).toBe(true);
    expect(html(<NeedChip projectId="p1" needId="nope" />, api)).not.toContain('nope');
  });

  it('no kind marks: nothing precedes a need code in any primitive that shows one', () => {
    expect('KindMark' in primitives).toBe(false);
    for (const locale of LOCALES) {
      for (const needId of ['n1', 'h1']) {
        const out = html(<NeedChip projectId="p1" needId={needId} />, fake(locale));
        const inner = out.replace(/^<button[^>]*>/, '');
        expect(inner.startsWith('<span class="mono faint">')).toBe(true);
        expect(out).not.toMatch(/\bkm\b|km-|aria-hidden/);
        const beforeCode = inner.slice(0, inner.indexOf(needId === 'n1' ? 'N1' : 'H1'));
        expect(beforeCode).toBe('<span class="mono faint">');
      }
    }
  });

  it('Modal renders the scrim, the dialog and the testid', () => {
    const out = html(
      <Modal onClose={() => undefined} wide testId="overlay-link">
        <p>hi</p>
      </Modal>,
    );
    expect(out).toBe('<div class="scrim"><div class="modal wide" role="dialog" aria-modal="true" tabindex="-1" data-testid="overlay-link"><p>hi</p></div></div>');
  });

  it('Modal focus: Tab wraps inside the dialog, and only a press and release on the scrim closes it', () => {
    expect(trapTab(3, 2, false)).toBe(0);
    expect(trapTab(3, 0, true)).toBe(2);
    expect(trapTab(3, 1, false)).toBeNull();
    expect(trapTab(3, 1, true)).toBeNull();
    expect(trapTab(3, -1, false)).toBe(0);
    expect(trapTab(3, -1, true)).toBe(2);
    expect(trapTab(0, -1, false)).toBe(-1);
    expect(trapTab(1, 0, false)).toBe(0);
    expect(closesOnClick(true, true)).toBe(true);
    expect(closesOnClick(false, true)).toBe(false);
    expect(closesOnClick(true, false)).toBe(false);
    for (const sel of ['button:not([disabled])', 'input:not([disabled])', 'textarea:not([disabled])', 'a[href]', '[tabindex]:not([tabindex="-1"])']) expect(FOCUSABLE).toContain(sel);
  });

  it('Placeholder renders page-<view> with the view title in both locales', () => {
    const views: [View, MessageKey][] = [['home', 'nav.home'], ['board', 'nav.board'], ['newProject', 'nav.newProject'], ['rounds', 'nav.rounds']];
    for (const locale of LOCALES)
      for (const [v, key] of views)
        expect(html(<Placeholder view={v} />, fake(locale))).toBe(`<div class="page" data-testid="page-${v}"><h1>${createTranslator(locale).t(key)}</h1></div>`);
  });

  it('Timeline draws the rounds with SEP-joined labels and a today line; inline styles are geometry only', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const out = html(<Timeline projectId="p1" selected={2} />, fake(locale));
      expect(out).toContain(tr.t('round', { n: 1 }) + SEP + 'Draft');
      expect(out).toContain(tr.t('round', { n: 2 }) + SEP + 'Submission');
      expect(out).toContain('class="tl-bar b-current on"');
      expect(out).toContain('class="tl-bar b-delivered"');
      expect(out).toContain('class="tl-today"');
      expect(out).toContain(tr.t('tl.today'));
      for (const m of out.matchAll(/style="([^"]*)"/g)) for (const d of m[1]!.split(';').filter(Boolean)) expect(d.split(':')[0]).toMatch(/^(left|width)$/);
      expect(DOT_RE.test(out)).toBe(false);
    }
    expect(html(<Timeline projectId="none" />)).toBe('');
  });

  it('Timeline calls onSelect with the round, or null to clear', () => {
    const picks: (number | null)[] = [];
    const api = fake();
    const el = produced(Timeline, { projectId: 'p1', selected: 2, onSelect: (n: number | null) => void picks.push(n) }, api);
    const buttons: ReactElement<Record<string, unknown>>[] = [];
    const collect = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(collect);
      if (node && typeof node === 'object' && 'props' in node) {
        const e = node as ReactElement<Record<string, unknown>>;
        if (e.type === 'button') buttons.push(e);
        collect(e.props.children);
      }
    };
    collect(el);
    expect(buttons.length).toBe(2);
    (buttons[0]!.props.onClick as () => void)();
    (buttons[1]!.props.onClick as () => void)();
    expect(picks).toEqual([1, null]);
  });
});
