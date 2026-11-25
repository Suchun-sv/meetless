import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_CARDS, DOT_RE, needByCode, type Id, type Suggestion } from '@meetless/core';
import { createTranslator } from '@meetless/i18n';
import {
  acceptsFile,
  agentScope,
  chipLabel,
  chipOutcome,
  chipsFor,
  continueAfterSubmit,
  fileImport,
  importCommand,
  importPriv,
  importResult,
  inputTitleFrom,
  onDashboardFor,
  recordSentPriv,
  recordSentPrivFor,
  sendCommands,
  setPriv,
  shouldSend,
  type ChipOutcome,
} from '../../src/renderer/chat/model';
import { sample } from '../support/app';
import { LOCALES } from '../shell/u1';

const s = sample('zh-CN').state; // the full sample record; every test below acts as u-alex
const today = '2026-11-24';
const now = '2026-11-24T10:00:00.000Z';
const tr = createTranslator;

/** The id of the need `code` in `projectId` (contract §8 test idiom). */
function needId(projectId: Id, code: string): Id {
  const n = needByCode(s, projectId, code);
  if (!n) throw new Error(`${code} not found in ${projectId}`);
  return n.id;
}

/** The intent of the reply carried by a chip outcome's `chat.asked` command. */
function intentOf(out: ChipOutcome): string {
  const c = out.commands.find((cmd) => cmd.type === 'chat.asked');
  if (!c || c.type !== 'chat.asked') throw new Error('no chat.asked command');
  return c.payload.reply.answer.intent;
}

describe('agentScope', () => {
  it('maps home to the home scope and a project id to the project scope', () => {
    expect(agentScope('home')).toEqual({ kind: 'home' });
    expect(agentScope('sample-atlas')).toEqual({ kind: 'project', projectId: 'sample-atlas' });
  });
});

describe('sendCommands', () => {
  it('a typed question becomes one private chat.asked with the rule-based reply', () => {
    const [c] = sendCommands(s, 'u-alex', 'sample-atlas', 'N2 为什么改了', today, now, 'm1');
    expect(c).toMatchObject({ type: 'chat.asked', payload: { messageId: 'm1', scope: 'sample-atlas', reply: { provider: 'rules/1', simulated: true, answer: { intent: 'retrieval' } } } });
    expect((c!.payload as { reply: { answer: { cites: Id[] } } }).reply.answer.cites).toContain(needId('sample-atlas', 'N2'));
  });

  it('asking for a card adds it with a refresh stamp; asking again keeps one copy', () => {
    const cmds = sendCommands(s, 'u-alex', 'sample-atlas', '加一张需求来源卡片', today, now, 'm2');
    expect(cmds.map((c) => c.type)).toEqual(['chat.asked', 'dashboard.set']);
    expect((cmds[1]!.payload as { cards: unknown }).cards).toEqual([...DEFAULT_PROJECT_CARDS, 'sources']);
    expect((cmds[1]!.payload as { refreshed: Record<string, string> }).refreshed.sources).toBe(now);
  });
});

describe('chip labels and outcomes', () => {
  it.each(LOCALES)('every add-card chip label in %s maps to its own card', (l) => {
    for (const chip of chipsFor(s, 'u-alex', 'sample-atlas', true, today).filter((c) => c.kind === 'addCard'))
      expect(chipOutcome(s, 'u-alex', 'sample-atlas', chip, chipLabel(tr(l).t, s, chip), today, now, 'm').commands[1]).toMatchObject({ type: 'dashboard.set' });
  });

  it('the stale chip asks for a refresh and records a stale reply', () => {
    const chip = chipsFor(s, 'u-alex', 'sample-atlas', false, today).find((c): c is Extract<Suggestion, { kind: 'stale' }> => c.kind === 'stale')!;
    expect(chip).toBeDefined();
    const out = chipOutcome(s, 'u-alex', 'sample-atlas', chip, chipLabel(tr('en').t, s, chip), today, now, 'm');
    expect(out.commands.map((c) => c.type)).toEqual(['handoff.refresh_requested', 'chat.asked']);
    expect((out.commands[1]!.payload as { reply: { answer: unknown } }).reply.answer).toMatchObject({ intent: 'stale', items: [expect.objectContaining({ fetched: 1, current: 2 })] });
  });

  it('toMe opens the need; conflict and proposal open To confirm; none of them chats', () => {
    const toMe = chipsFor(s, 'u-alex', 'sample-atlas', false, today).find((c): c is Extract<Suggestion, { kind: 'toMe' }> => c.kind === 'toMe')!;
    expect(toMe).toBeDefined();
    const toMeOut = chipOutcome(s, 'u-alex', 'sample-atlas', toMe, chipLabel(tr('en').t, s, toMe), today, now, 'm');
    expect(toMeOut).toEqual({ commands: [], open: { projectId: toMe.projectId, needId: toMe.needId } });

    const conflict: Suggestion = { id: 'cf-x', kind: 'conflict', hot: true, projectId: 'sample-atlas', n: 2 };
    const conflictOut = chipOutcome(s, 'u-alex', 'sample-atlas', conflict, chipLabel(tr('en').t, s, conflict), today, now, 'm');
    expect(conflictOut).toEqual({ commands: [], overlay: { kind: 'confirm', projectId: 'sample-atlas' } });

    const proposal: Suggestion = { id: 'pr-x', kind: 'proposal', hot: true, projectId: 'sample-atlas', n: 1 };
    const proposalOut = chipOutcome(s, 'u-alex', 'sample-atlas', proposal, chipLabel(tr('en').t, s, proposal), today, now, 'm');
    expect(proposalOut).toEqual({ commands: [], overlay: { kind: 'confirm', projectId: 'sample-atlas' } });
  });

  it('ask chips send their label as a question (today, deadlines, delivery, weekly intents)', () => {
    const homeChips = chipsFor(s, 'u-alex', 'home', false, today);
    const atlasChips = chipsFor(s, 'u-alex', 'sample-atlas', false, today);
    const askToday = homeChips.find((c): c is Extract<Suggestion, { kind: 'ask' }> => c.kind === 'ask' && c.prompt === 'today')!;
    const askDeadlines = homeChips.find((c): c is Extract<Suggestion, { kind: 'ask' }> => c.kind === 'ask' && c.prompt === 'deadlines')!;
    const askDelivery = atlasChips.find((c): c is Extract<Suggestion, { kind: 'ask' }> => c.kind === 'ask' && c.prompt === 'delivery')!;
    const askWeekly = atlasChips.find((c): c is Extract<Suggestion, { kind: 'ask' }> => c.kind === 'ask' && c.prompt === 'weekly')!;
    expect(intentOf(chipOutcome(s, 'u-alex', 'home', askToday, tr('en').t('sg.ask.today'), today, now, 'm'))).toBe('today');
    expect(intentOf(chipOutcome(s, 'u-alex', 'home', askDeadlines, tr('en').t('sg.ask.deadlines'), today, now, 'm'))).toBe('deadlines');
    expect(intentOf(chipOutcome(s, 'u-alex', 'sample-atlas', askDelivery, tr('en').t('sg.ask.delivery'), today, now, 'm'))).toBe('delivery');
    expect(intentOf(chipOutcome(s, 'u-alex', 'sample-atlas', askWeekly, tr('en').t('sg.ask.weekly'), today, now, 'm'))).toBe('weekly');
  });

  it('no chip label contains a dot symbol in either language', () => {
    for (const l of LOCALES) {
      const t = tr(l).t;
      for (const scope of ['home', 'sample-atlas'] as const) {
        for (const onDash of [false, true]) {
          for (const chip of chipsFor(s, 'u-alex', scope, onDash, today)) expect(DOT_RE.test(chipLabel(t, s, chip))).toBe(false);
        }
      }
    }
  });
});

describe('shouldSend', () => {
  it('refuses whitespace and an open IME composition', () => {
    expect(shouldSend('  \n ', false)).toBe(false);
    expect(shouldSend('N2', true)).toBe(false);
    expect(shouldSend('N2', false)).toBe(true);
  });
});

describe('importing from chat', () => {
  it('importCommand keeps the privacy switch and a deterministic input id', () => {
    expect(importCommand({ projectId: 'p', messageId: 'm9', text: '# 周会\n要加导出', priv: true, today })).toEqual(
      expect.objectContaining({ inputId: 'in-m9', title: '周会', kind: 'md', private: true, blobHash: null }),
    );
  });

  it('inputTitleFrom strips leading list and quote marks and clips to 40 characters', () => {
    expect(inputTitleFrom('# 周会\n要加导出')).toBe('周会');
    expect(inputTitleFrom('\n  - a plan\nmore')).toBe('a plan');
    expect(inputTitleFrom('x'.repeat(50))).toBe(`${'x'.repeat(39)}…`);
  });

  it('fileImport picks the kind from the extension', () => {
    expect(fileImport({ projectId: 'p', name: 'Brief.DOCX', priv: false, today, inputId: 'i' })).toMatchObject({ kind: 'docx', readAsText: false });
    expect(fileImport({ projectId: 'p', name: 'notes.md', priv: false, today, inputId: 'i' })).toMatchObject({ kind: 'md', readAsText: true });
    expect(fileImport({ projectId: 'p', name: 'notes.txt', priv: true, today, inputId: 'i' })).toMatchObject({ kind: 'txt', readAsText: true, private: true });
    expect(fileImport({ projectId: 'p', name: 'scan.pdf', priv: false, today, inputId: 'i' })).toMatchObject({ kind: 'pdf', readAsText: false });
  });

  it('acceptsFile takes md, markdown, txt, docx and pdf in any case, and refuses a legacy .doc', () => {
    for (const name of ['a.md', 'a.markdown', 'a.TXT', 'Brief.DOCX', 'scan.pdf']) expect(acceptsFile(name), name).toBe(true);
    for (const name of ['old.doc', 'OLD.DOC', 'sheet.xlsx', 'noext', 'a.md.exe']) expect(acceptsFile(name), name).toBe(false);
  });
});

describe('import visibility (ruling R21)', () => {
  it('uses the switch the message was sent under, even after the switch is flipped', () => {
    setPriv('p-r21', true);
    recordSentPriv('m-r21-priv', true);
    setPriv('p-r21', false); // flipped back to Project for the next message
    expect(importPriv('m-r21-priv')).toBe(true);
    expect(importCommand({ projectId: 'p-r21', messageId: 'm-r21-priv', text: 'notes', priv: importPriv('m-r21-priv'), today }).private).toBe(true);

    recordSentPriv('m-r21-shared', false);
    setPriv('p-r21', true); // flipped to Only me after sending a shared message
    expect(importPriv('m-r21-shared')).toBe(false);
  });

  it('a message with no record (sent before a restart) imports as private', () => {
    expect(importPriv('m-r21-unknown')).toBe(true);
  });

  it('recordSentPrivFor records every chat.asked in a command chain, and nothing else', () => {
    const cmds = sendCommands(s, 'u-alex', 'sample-atlas', 'add a sources card', today, now, 'm-r21-chain');
    expect(cmds.map((c) => c.type)).toEqual(['chat.asked', 'dashboard.set']);
    recordSentPrivFor(cmds, false);
    expect(importPriv('m-r21-chain')).toBe(false);
  });
});

describe('importResult', () => {
  it('opens the new input on success', () => {
    expect(importResult({ ok: true, data: { inputId: 'in-m1' } }, 'p', 'in-m1')).toEqual({ route: { view: 'inputs', projectId: 'p', focusId: 'in-m1' } });
  });

  it('ALREADY_EXISTS (a second import of the same message) opens the existing input instead of an error', () => {
    expect(importResult({ ok: false, code: 'ALREADY_EXISTS' }, 'p', 'in-m1')).toEqual({ route: { view: 'inputs', projectId: 'p', focusId: 'in-m1' } });
  });

  it('any other code is an error to show', () => {
    expect(importResult({ ok: false, code: 'HTTP_404' }, 'p', 'in-m1')).toEqual({ code: 'HTTP_404' });
    expect(importResult({ ok: false, code: 'FORBIDDEN' }, 'p', 'in-m1')).toEqual({ code: 'FORBIDDEN' });
  });
});

describe('continueAfterSubmit', () => {
  it('continues on accepted, duplicate and queued; stops only on rejected', () => {
    expect(continueAfterSubmit({ kind: 'accepted', seq: 1 })).toBe(true);
    expect(continueAfterSubmit({ kind: 'duplicate', seq: 1 })).toBe(true);
    // Offline: the command is saved locally and will flush later in order, same as accepted.
    expect(continueAfterSubmit({ kind: 'queued' })).toBe(true);
    expect(continueAfterSubmit({ kind: 'rejected', code: 'NOT_AVAILABLE' })).toBe(false);
  });
});

describe('onDashboardFor', () => {
  it('is true only for home\'s own dashboard view or a project\'s dash view', () => {
    expect(onDashboardFor('home', 'home')).toBe(true);
    expect(onDashboardFor('home', 'dash')).toBe(false);
    expect(onDashboardFor('sample-atlas', 'dash')).toBe(true);
    expect(onDashboardFor('sample-atlas', 'board')).toBe(false);
    expect(onDashboardFor('sample-atlas', 'home')).toBe(false);
  });
});
