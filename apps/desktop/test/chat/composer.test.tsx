import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { answer, SEP, viewFor, type AgentReply, type Id, type MaterialCite, type State, type Suggestion } from '@meetless/core';
import { createTranslator, type Locale } from '@meetless/i18n';
import type { AppApi } from '../../src/renderer/app/AppContext';
import { materialRoute } from '../../src/renderer/app/routes';
import { chipsFor, recordSentPriv, sendCommands, setPriv, staleReply } from '../../src/renderer/chat/model';
import { Composer } from '../../src/renderer/chat/Composer';
import { Reply } from '../../src/renderer/chat/Reply';
import { fakeApi, render, sample } from '../support/app';
import { guards } from '../support/guards';
import { Log } from '../support/log';
import { alexApi, LOCALES, sampleWith, textOf, zhouApi } from '../shell/u1';

const tr = createTranslator;
const TODAY = '2026-11-24';
const NOW = '2026-11-24T10:00:00.000Z';

/** The rule-based reply recorded for a retrieval answer, with the given materials and no need hits. */
function materialsReply(materials: MaterialCite[]): AgentReply {
  return { provider: 'rules/1', simulated: true, answer: { intent: 'retrieval', needs: [], materials, cites: [] } };
}

/** `Reply`'s React element tree for `props`, rendered under `api` (contract: component tests probe the element tree directly, as primitives.test.tsx does). */
function producedReply(props: { reply: AgentReply; scope: 'home' | Id; messageId: Id }, api: AppApi): ReactElement<Record<string, unknown>> {
  let out: ReactNode = null;
  const Probe = () => {
    out = Reply(props);
    return null;
  };
  render(api, <Probe />);
  return out as unknown as ReactElement<Record<string, unknown>>;
}

/** Every `<button data-testid="material-chip">` in a `Reply` element tree, in document order. */
function materialChips(el: ReactElement<Record<string, unknown>>): ReactElement<Record<string, unknown>>[] {
  const out: ReactElement<Record<string, unknown>>[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object' && 'props' in node) {
      const e = node as ReactElement<Record<string, unknown>>;
      if (e.type === 'button' && e.props['data-testid'] === 'material-chip') out.push(e);
      walk(e.props.children);
    }
  };
  walk(el);
  return out;
}

/** A state with one chat message recorded for `scope`, asked by Alex. */
function withChat(locale: Locale, scope: Id, text: string): State {
  const { state } = sample(locale);
  return sampleWith(locale, sendCommands(state, 'u-alex', scope, text, TODAY, NOW, 'm1'));
}

describe('Composer', () => {
  it.each(LOCALES)('composer (%s) on a project page: every hot chip, attach, privacy switch, hint', (l) => {
    // board: not a dashboard, so all hot chips show (dashboards show two)
    const html = render(alexApi(l, { route: { view: 'board', projectId: 'sample-atlas' } }), <Composer scope="sample-atlas" />);
    for (const id of ['composer-text', 'composer-send', 'composer-attach', 'pv-project', 'pv-only']) expect(html).toContain(`data-testid="${id}"`);
    expect(html).toMatch(/class="chip hot"[^>]*data-chip="stale-/);
    expect(html).toContain(tr(l).t('cm.hint'));
  });

  it('on Home there is no attach and no privacy switch, and the placeholder is ch.phHome', () => {
    const html = render(alexApi('en'), <Composer scope="home" />);
    expect(html).not.toContain('data-testid="composer-attach"');
    expect(html).not.toContain('data-testid="pv-project"');
    expect(html).not.toContain('data-testid="pv-only"');
    expect(html).toContain(tr('en').t('ch.phHome'));
  });

  it('a stored question renders the user text and a rule-labelled reply with the need chip', () => {
    const html = render(alexApi('en', { state: withChat('en', 'sample-atlas', 'why did N2 change') }), <Composer scope="sample-atlas" />);
    expect(textOf(html)).toContain('why did N2 change');
    expect(textOf(html)).toContain('Rule-based');
    expect(textOf(html)).toContain('N2');
  });

  /** One text per intent, chosen from the agent's own keyword rules (packages/core/src/agent.ts). */
  const INTENT_TEXT: Record<string, string> = {
    today: 'what should I do first today',
    deadlines: 'what are the deadlines',
    weekly: 'what happened this week',
    delivery: 'draft the delivery note',
    addCard: 'add a sources card',
    asInput: 'Paragraph one.\nParagraph two, long enough that this reads as a new input rather than a question to the agent.',
    handoff: 'hand N2 over to Zhou Yu',
    stale: 'list stale handoffs',
    summary: 'hello there',
  };

  it.each(Object.keys(INTENT_TEXT))('Reply renders the %s intent with its ans.* text', (intent) => {
    const t = tr('en').t;
    const html = render(alexApi('en', { state: withChat('en', 'sample-atlas', INTENT_TEXT[intent]!) }), <Composer scope="sample-atlas" />);
    const plain = textOf(html);
    switch (intent) {
      case 'today':
        expect(plain).toContain(t('ans.today'));
        break;
      case 'deadlines':
        expect(plain).toContain(t('ans.deadlines'));
        break;
      case 'weekly':
        expect(plain).toContain(t('ans.weekly'));
        break;
      case 'delivery':
        expect(plain).toContain(t('ans.delivery', { round: t('round', { n: 3 }) }));
        break;
      case 'addCard':
        expect(plain).toContain(t('ch.cardOn', { name: t('w.sources') }));
        break;
      case 'asInput':
        expect(plain).toContain(t('ch.asInput'));
        expect(plain).toContain(t('ch.import'));
        break;
      case 'handoff':
        expect(plain).toContain(t('ans.handoff', { need: 'N2', who: 'Zhou Yu' }));
        break;
      case 'stale':
        expect(plain).toContain(t('ans.stale', { n: 1 }));
        break;
      case 'summary':
        expect(plain).toContain(t('ans.summary', { round: t('round', { n: 3 }), d: 4, doing: 3, todo: 2, met: 0 }));
        break;
    }
  });

  it('a stale row whose handoff is already reminded shows ho.reminded, not the button', () => {
    const { state } = sample('en');
    const chip = chipsFor(state, 'u-alex', 'sample-atlas', false, TODAY).find((c): c is Extract<Suggestion, { kind: 'stale' }> => c.kind === 'stale')!;
    expect(chip).toBeDefined();
    const reply = staleReply(state, 'u-alex', chip.handoffId);
    const withState = sampleWith('en', [
      { type: 'handoff.refresh_requested', payload: { handoffId: chip.handoffId } },
      { type: 'chat.asked', payload: { messageId: 'm1', scope: 'sample-atlas', text: 'remind', reply } },
    ]);
    const plain = textOf(render(alexApi('en', { state: withState }), <Composer scope="sample-atlas" />));
    expect(plain).toContain(tr('en').t('ho.reminded'));
    expect(plain).not.toContain(tr('en').t('ho.remind'));
  });

  it("Zhou's composer shows no thread of Alex's", () => {
    expect(textOf(render(zhouApi('en', { state: withChat('en', 'sample-atlas', 'alex secret question') }), <Composer scope="sample-atlas" />))).not.toContain('alex secret question');
  });

  it.each(LOCALES)('no dot symbol in the composer, thread and every reply (%s)', (l) => {
    const texts: Record<Locale, string[]> = {
      'zh-CN': ['今天先做什么', '所有截止日', '本周进展', '交付说明', '加一张需求来源卡片', '把 N2 交给 周屿', '过时的交接', '你好'],
      en: Object.values(INTENT_TEXT),
    };
    const base = sample(l).state;
    const cmds = texts[l].flatMap((text, i) => sendCommands(base, 'u-alex', 'sample-atlas', text, TODAY, NOW, `m${i}`));
    const html = render(alexApi(l, { state: sampleWith(l, cmds) }), <Composer scope="sample-atlas" />);
    guards(`composer (${l})`, html);
  });

  describe('material citations', () => {
    /** A real input and a real artifact of sample-atlas, used as the materials' ids (so `live` has them). */
    function sampleMaterialIds(locale: Locale): { inputId: Id; paraId: Id; artifactId: Id; versionId: Id } {
      const { state } = sample(locale);
      const input = Object.values(state.inputs).find((i) => i.projectId === 'sample-atlas' && i.body.length > 0)!;
      const artifact = Object.values(state.artifacts).find((a) => a.projectId === 'sample-atlas' && a.versions.length > 0)!;
      return { inputId: input.id, paraId: input.body[0]!.id, artifactId: artifact.id, versionId: artifact.versions[0]!.id };
    }

    it.each(LOCALES)('a stored retrieval reply with one input and one artifact material renders two chips, the heading, both texts, and the artifact page as page + 1 (%s)', (l) => {
      const { inputId, paraId, artifactId, versionId } = sampleMaterialIds(l);
      const reply = materialsReply([
        { kind: 'input', id: inputId, projectId: 'sample-atlas', versionId: null, page: null, paraId, text: 'the input material snippet', title: 'Input material' },
        { kind: 'artifact', id: artifactId, projectId: 'sample-atlas', versionId, page: 2, text: 'the artifact material snippet', title: 'Artifact material' },
      ]);
      const withState = sampleWith(l, [{ type: 'chat.asked', payload: { messageId: 'm1', scope: 'sample-atlas', text: 'materials?', reply } }]);
      const html = render(alexApi(l, { state: withState }), <Composer scope="sample-atlas" />);
      const plain = textOf(html);
      const t = tr(l).t;
      expect(plain).toContain(t('ans.materials'));
      expect(html.match(/data-testid="material-chip"/g) ?? []).toHaveLength(2);
      expect(html).toContain('data-kind="input"');
      expect(html).toContain('data-kind="artifact"');
      expect(plain).toContain('the input material snippet');
      expect(plain).toContain('the artifact material snippet');
      // page: 2 is zero-based (the third page); the chip shows the 1-based number, 3, SEP-joined
      // (contract: facts on one line are joined with core SEP, never an ASCII space).
      expect(plain).toContain(`${t('ans.f.page')}${SEP}3`);
      expect(plain).toContain(`Artifact material${SEP}${t('ans.f.page')}${SEP}3`);
      guards(`material chips (${l})`, html);
    });

    it('a retrieval reply with needs: [] and one material shows the materials section and no "nothing found" text', () => {
      const { inputId, paraId } = sampleMaterialIds('en');
      const reply = materialsReply([{ kind: 'input', id: inputId, projectId: 'sample-atlas', versionId: null, page: null, paraId, text: 'only a material matched', title: 'Input material' }]);
      const withState = sampleWith('en', [{ type: 'chat.asked', payload: { messageId: 'm1', scope: 'sample-atlas', text: 'materials only?', reply } }]);
      const plain = textOf(render(alexApi('en', { state: withState }), <Composer scope="sample-atlas" />));
      expect(plain).toContain(tr('en').t('ans.found'));
      expect(plain).toContain(tr('en').t('ans.materials'));
      expect(plain).toContain('only a material matched');
      expect(plain).not.toContain(tr('en').t('ans.none'));
    });

    it('a material whose input or artifact is not in live is not rendered', () => {
      const reply = materialsReply([{ kind: 'input', id: 'ghost-input', projectId: 'sample-atlas', versionId: null, page: null, text: 'should never show', title: 'Ghost input title' }]);
      const withState = sampleWith('en', [{ type: 'chat.asked', payload: { messageId: 'm1', scope: 'sample-atlas', text: 'q', reply } }]);
      const html = render(alexApi('en', { state: withState }), <Composer scope="sample-atlas" />);
      expect(html).not.toContain('data-testid="material-chip"');
      expect(textOf(html)).not.toContain('Ghost input title');
      expect(textOf(html)).not.toContain('should never show');
    });

    it("Zhou's composer never shows Alex's private input title, even from a reply that cites it", () => {
      const { state } = sample('en');
      const log = new Log({ initial: state });
      log.emit('input.imported', 'u-alex', {
        inputId: 'priv-in-1',
        projectId: 'sample-atlas',
        kind: 'md',
        title: 'Zhou must never see this title',
        from: null,
        date: TODAY,
        body: [{ id: 'p1', text: 'a private paragraph' }],
        extracts: [],
        detector: 'rules/1',
        private: true,
      });
      // Zhou asks his own question; the hand-built reply cites Alex's private input (as real retrieval
      // could never do from Zhou's own search, but this isolates the render-time privacy guard).
      const reply = materialsReply([{ kind: 'input', id: 'priv-in-1', projectId: 'sample-atlas', versionId: null, page: null, paraId: 'p1', text: 'a private paragraph', title: 'Zhou must never see this title' }]);
      log.emit('chat.asked', 'u-zhou', { messageId: 'm1', scope: 'sample-atlas', text: 'materials?', reply });
      const html = render(zhouApi('en', { state: log.state }), <Composer scope="sample-atlas" />);
      expect(html).not.toContain('data-testid="material-chip"');
      expect(textOf(html)).not.toContain('Zhou must never see this title');
    });

    it('a real retrieval answer with an input material (no need) renders a chip, driven through core\'s own answer()', () => {
      const log = new Log();
      log.emit('user.registered', 'system', { userId: 'u-a', displayName: 'A', locale: 'en' });
      log.emit('project.created', 'u-a', { projectId: 'p1', name: 'P' });
      log.emit('input.imported', 'u-a', {
        inputId: 'in1',
        projectId: 'p1',
        kind: 'md',
        title: 'Kickoff notes',
        from: null,
        date: '2026-11-20',
        body: [{ id: 'p1', text: 'Churn baseline sits at four percent before launch.' }],
        extracts: [],
        detector: 'rules/1',
      });
      const live = viewFor(log.state, 'u-a');
      const reply = answer(live, { userId: 'u-a', scope: { kind: 'project', projectId: 'p1' }, text: 'what is the churn baseline', today: '2026-11-24' });
      expect(reply.answer.intent).toBe('retrieval');
      expect(reply.answer.intent === 'retrieval' && reply.answer.materials).toHaveLength(1);
      const html = render(fakeApi({ live, me: 'u-a' }), <Reply reply={reply} scope="p1" messageId="m1" />);
      expect(html).toContain('data-testid="material-chip"');
      expect(html).toContain('data-kind="input"');
      expect(html).toContain('data-material="in1"');
      expect(textOf(html)).toContain('Kickoff notes');
    });

    it('the input chip\'s route carries paraId; the artifact chip\'s route carries versionId and page', () => {
      const { inputId, paraId, artifactId, versionId } = sampleMaterialIds('en');
      const reply = materialsReply([
        { kind: 'input', id: inputId, projectId: 'sample-atlas', versionId: null, page: null, paraId, text: 'input text', title: 'Input material' },
        { kind: 'artifact', id: artifactId, projectId: 'sample-atlas', versionId, page: 2, text: 'artifact text', title: 'Artifact material' },
      ]);
      if (reply.answer.intent !== 'retrieval') throw new Error('expected a retrieval answer');
      const materials = reply.answer.materials;
      const api = alexApi('en', { state: sampleWith('en', [{ type: 'chat.asked', payload: { messageId: 'm1', scope: 'sample-atlas', text: 'materials?', reply } }]) });
      const chips = materialChips(producedReply({ reply, scope: 'sample-atlas', messageId: 'm1' }, api));
      expect(chips).toHaveLength(2);

      (chips[0]!.props.onClick as () => void)();
      expect(api.route).toEqual(materialRoute(materials[0]!));
      expect(api.route).toMatchObject({ view: 'inputs', focusId: inputId, paraId });

      (chips[1]!.props.onClick as () => void)();
      expect(api.route).toEqual(materialRoute(materials[1]!));
      expect(api.route).toMatchObject({ view: 'artifacts', focusId: artifactId, versionId, page: 2 });
    });
  });
});

/** The element with `testId` (a `Row`'s prop) in a `Reply` element tree, or throws. */
function rowByTestId(el: ReactElement<Record<string, unknown>>, testId: string): ReactElement<Record<string, unknown>> {
  let found: ReactElement<Record<string, unknown>> | null = null;
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object' && 'props' in node) {
      const e = node as ReactElement<Record<string, unknown>>;
      if (e.props.testId === testId) found = e;
      walk(e.props.children);
    }
  };
  walk(el);
  if (!found) throw new Error(`no ${testId}`);
  return found;
}

describe('Import as input (ruling R21)', () => {
  const ASINPUT = 'Paragraph one.\nParagraph two, long enough that this reads as a new input rather than a question to the agent.';

  it.each(LOCALES)('(%s) with no send-time record (after a restart) the button says it imports as Only me', (l) => {
    const t = tr(l).t;
    const html = render(alexApi(l, { state: withChat(l, 'sample-atlas', ASINPUT) }), <Composer scope="sample-atlas" />);
    expect(html).toContain('data-testid="chat-import"');
    expect(textOf(html)).toContain(t('ch.importTo', { v: t('pv.only') }));
    expect(textOf(html)).not.toContain(t('ch.importTo', { v: t('pv.project') }));
    guards(`import row ${l}`, html);
  });

  it('a message sent under Project says Project, even with the switch now on Only me', () => {
    const t = tr('en').t;
    recordSentPriv('m1', false);
    setPriv('sample-atlas', true);
    try {
      const html = render(alexApi('en', { state: withChat('en', 'sample-atlas', ASINPUT) }), <Composer scope="sample-atlas" />);
      expect(textOf(html)).toContain(t('ch.importTo', { v: t('pv.project') }));
    } finally {
      recordSentPriv('m1', true);
      setPriv('sample-atlas', false);
    }
  });

  it('pressing it with no record imports private, and ALREADY_EXISTS opens that input with no error', async () => {
    const state = withChat('en', 'sample-atlas', ASINPUT);
    const api = alexApi('en', { state });
    const sent: unknown[] = [];
    api.api = (async (_name: string, input: unknown) => {
      sent.push(input);
      return { ok: false, code: 'ALREADY_EXISTS' };
    }) as unknown as AppApi['api'];
    const msg = answer(sample('en').state, { userId: 'u-alex', scope: { kind: 'project', projectId: 'sample-atlas' }, text: ASINPUT, today: TODAY });
    const row = rowByTestId(producedReply({ reply: msg, scope: 'sample-atlas', messageId: 'm1' }, api), 'chat-import');
    (row.props.onClick as () => void)();
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([expect.objectContaining({ inputId: 'in-m1', private: true })]);
    expect(api.route).toEqual({ view: 'inputs', projectId: 'sample-atlas', focusId: 'in-m1' });
    expect(api.notices).toEqual([]);
  });

  it('a server without the import route shows pj.unsupported, not a raw HTTP_404', async () => {
    const t = tr('en').t;
    const api = alexApi('en', { state: withChat('en', 'sample-atlas', ASINPUT) });
    api.api = (async () => ({ ok: false, code: 'HTTP_404' })) as unknown as AppApi['api'];
    const msg = answer(sample('en').state, { userId: 'u-alex', scope: { kind: 'project', projectId: 'sample-atlas' }, text: ASINPUT, today: TODAY });
    const row = rowByTestId(producedReply({ reply: msg, scope: 'sample-atlas', messageId: 'm1' }, api), 'chat-import');
    (row.props.onClick as () => void)();
    await new Promise((r) => setTimeout(r, 0));
    expect(api.notices.map((n) => n.text)).toEqual([t('pj.unsupported')]);
  });
});
