import { describe, expect, it } from 'vitest';
import { DOT_RE, needByCode, type Id, type Need, type State } from '@meetless/core';
import type { Locale } from '@meetless/i18n';
import { ConfirmPanel } from '../../src/renderer/collab/ConfirmPanel';
import { HandoffModal } from '../../src/renderer/collab/HandoffModal';
import { LinkModal } from '../../src/renderer/collab/LinkModal';
import { PromptBox } from '../../src/renderer/collab/PromptBox';
import { BoardPage } from '../../src/renderer/needs/BoardPage';
import { Lineage } from '../../src/renderer/needs/Lineage';
import { NeedDrawer } from '../../src/renderer/needs/NeedDrawer';
import { NewNeedModal } from '../../src/renderer/needs/NewNeedModal';
import { fakeApi, render, sample } from '../support/app';
import { clientState, type ScopedLog } from '../support/client-state';
import { guards } from '../support/guards';
import { Log } from '../support/log';

/*
 * The privacy and dot sweep over every U2 screen (Task 12): for both locales and for Alex, Mia
 * and Zhou, each rendered from the state that user's client holds (clientState over the sample's
 * scoped log): the board in both modes, the new-need modal, the To confirm panel of each project
 * the user is in, and for every need the user holds its drawer, its handoff modal and its link
 * modal, plus the prompt box with its context preview open.
 */

const PAPER = 'sample-paper';
const TODAY = '2026-11-24';
const LOCALES: Locale[] = ['zh-CN', 'en'];
const noComposer = () => null;
const noop = () => undefined;

interface Screen {
  name: string;
  html: string;
  /** The open context preview: its textarea holds the need context's markdown (`# N2 …`). */
  preview?: boolean;
}

/** The sample, plus Zhou added to the paper by Alex, so Zhou receives every shared paper record (as in skeleton.spec.ts). */
function zhouInPaper(locale: Locale): ScopedLog {
  const s = sample(locale);
  const log = new Log({ initial: s.state, start: '2026-11-24T23:00:00Z' });
  log.emit('project.member_added', 'u-alex', { projectId: PAPER, userId: 'u-zhou' });
  expect(log.events).toHaveLength(1);
  return { events: [...s.events, ...log.events], scopes: [...s.scopes, ...log.scopes], state: log.state };
}

/** Every U2 screen `me` can reach, rendered from `live` (what `me`'s client holds). */
function screens(live: State, me: Id, locale: Locale): Screen[] {
  const out: Screen[] = [];
  const projects = Object.values(live.projects).filter((p) => p.memberIds.includes(me));
  expect(projects.length, `${me} is in a project`).toBeGreaterThan(0);
  for (const p of projects) {
    const at = (needId: Id | null = null) => fakeApi({ live, me, locale, today: TODAY, route: { view: 'board', projectId: p.id, needId } });
    const tag = `${locale} ${me} ${p.id}`;
    out.push({ name: `${tag} board`, html: render(at(), <BoardPage composer={noComposer} />) });
    out.push({ name: `${tag} lineage`, html: render(at(), <Lineage projectId={p.id} />) });
    out.push({ name: `${tag} new need`, html: render(at(), <NewNeedModal projectId={p.id} onClose={noop} />) });
    out.push({ name: `${tag} confirm`, html: render(at(), <ConfirmPanel overlay={{ kind: 'confirm', projectId: p.id }} />) });
    const needs = Object.values(live.needs).filter((n: Need) => n.projectId === p.id);
    expect(needs.length, `${tag} has needs`).toBeGreaterThan(0);
    for (const n of needs) {
      const nt = `${tag} ${n.code}`;
      out.push({ name: `${nt} drawer`, html: render(at(n.id), <NeedDrawer projectId={p.id} needId={n.id} />) });
      out.push({ name: `${nt} handoff`, html: render(at(n.id), <HandoffModal overlay={{ kind: 'handoff', projectId: p.id, needId: n.id }} />) });
      out.push({ name: `${nt} link`, html: render(at(n.id), <LinkModal overlay={{ kind: 'link', projectId: p.id, needId: n.id }} />) });
      out.push({ name: `${nt} preview`, html: render(at(n.id), <PromptBox projectId={p.id} needId={n.id} defaultOpen />), preview: true });
    }
  }
  return out;
}

/** The screens of `me` in `locale`, from the sample (or, with `zhouPaper`, the sample with Zhou added to the paper). */
function all(locale: Locale, me: Id, zhouPaper = false): Screen[] {
  const log = zhouPaper ? zhouInPaper(locale) : sample(locale);
  return screens(clientState(log, me), me, locale);
}

/** The markup outside the context preview's textarea (the markdown inside it is plain text, Task 7 ruling). */
const withoutContext = (html: string) => html.replace(/(<textarea[^>]*data-testid="lk-context"[^>]*>)[\s\S]*?(<\/textarea>)/g, '$1$2');

const hp1 = (locale: Locale): Need => {
  const n = needByCode(sample(locale).state, PAPER, 'Hp1');
  expect(n, 'the sample has Alex’s private hypothesis Hp1').toBeDefined();
  expect(n!.privateTo).toBe('u-alex');
  return n!;
};

describe('U2 sweep', () => {
  it.each(LOCALES)('no U2 markup contains a dot symbol, a mark before a code or a non-geometry style (%s)', (locale) => {
    const users: [Id, boolean][] = [
      ['u-alex', false],
      ['u-mia', false],
      ['u-zhou', false],
      ['u-zhou', true],
    ];
    let previews = 0;
    for (const [me, zp] of users) {
      const list = all(locale, me, zp);
      expect(list.length).toBeGreaterThan(10);
      for (const s of list) {
        const name = zp ? `${s.name} (in paper)` : s.name;
        if (s.preview) {
          if (s.html.includes('data-testid="lk-context"')) previews++;
          expect(DOT_RE.test(s.html), `${name}: dot character`).toBe(false);
          guards(name, withoutContext(s.html));
        } else guards(name, s.html);
      }
    }
    expect(previews, 'open previews were checked').toBeGreaterThan(0);
  });

  it('Mia and Zhou never see Alex’s private hypothesis anywhere in U2', () => {
    for (const locale of LOCALES) {
      const { id, title } = hp1(locale);
      // Positive control: Alex's own board shows Hp1, so the needles below are the right ones.
      const alexBoard = all(locale, 'u-alex').find((s) => s.name === `${locale} u-alex ${PAPER} board`)!;
      expect(alexBoard.html).toContain('Hp1');
      expect(alexBoard.html).toContain(title);

      const others = [...all(locale, 'u-mia'), ...all(locale, 'u-zhou'), ...all(locale, 'u-zhou', true)];
      expect(others.some((s) => s.name.startsWith(`${locale} u-zhou ${PAPER} board`)), 'Zhou’s paper board was swept').toBe(true);
      expect(others.some((s) => s.name.startsWith(`${locale} u-mia ${PAPER} board`)), 'Mia’s paper board was swept').toBe(true);
      for (const s of others) {
        expect(s.html, s.name).not.toContain('Hp1');
        expect(s.html, s.name).not.toContain(title);
        expect(s.html, s.name).not.toContain(id);
      }
    }
  });

  it('Alex’s own link previews and prompts never contain his private hypothesis', () => {
    for (const locale of LOCALES) {
      const { id, title, parentId } = hp1(locale);
      const live = clientState(sample(locale), 'u-alex');
      const shared = Object.values(live.needs).filter((n) => n.projectId === PAPER && n.privateTo === null);
      expect(shared.length).toBeGreaterThan(0);
      if (parentId) expect(shared.map((n) => n.id), 'Hp1’s parent is shared, so its preview is checked').toContain(parentId);
      const list = all(locale, 'u-alex').filter((s) => s.name.startsWith(`${locale} u-alex ${PAPER} `));
      let checked = 0;
      for (const n of shared) {
        for (const kind of ['preview', 'link', 'handoff']) {
          const s = list.find((x) => x.name === `${locale} u-alex ${PAPER} ${n.code} ${kind}`)!;
          expect(s, `${n.code} ${kind}`).toBeDefined();
          expect(s.html, s.name).toContain('data-testid="lk-prompt"');
          if (kind === 'preview') expect(s.html, s.name).toContain('data-testid="lk-context"');
          expect(s.html, s.name).not.toContain('Hp1');
          expect(s.html, s.name).not.toContain(title);
          expect(s.html, s.name).not.toContain(id);
          checked++;
        }
      }
      expect(checked).toBe(shared.length * 3);
      // Hp1's own link modal and prompt box give no prompt and no context: it must be shared first.
      for (const kind of ['preview', 'link']) {
        const s = list.find((x) => x.name === `${locale} u-alex ${PAPER} Hp1 ${kind}`)!;
        expect(s.html).not.toContain('data-testid="lk-prompt"');
        expect(s.html).not.toContain('data-testid="lk-context"');
      }
    }
  });
});
