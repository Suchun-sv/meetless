import { describe, expect, it } from 'vitest';
import { allRisks, cardsFor, homeItems, needByCode, questionId, questions, viewFor, type CardId, type Question } from '@meetless/core';
import { createTranslator } from '@meetless/i18n';
import {
  addCardPayload,
  cardStamp,
  confirmRows,
  isActivationKey,
  leftText,
  projectTag,
  refreshCardPayload,
  removeCardPayload,
  riskTarget,
  riskText,
  type ConfirmRow,
} from '../../src/renderer/dash/model';
import { sample } from '../support/app';
import { Log } from '../support/log';
import { LOCALES, sampleWith } from '../shell/u1';

const today = '2026-11-24';
const now = '2026-11-24T10:00:00.000Z';
const tr = createTranslator;

describe('card list payloads', () => {
  it('add, refresh and remove keep the full list and the other stamps', () => {
    const cur = { cards: ['progress', 'risks'] as CardId[], refreshed: { risks: 'T1' } };
    expect(addCardPayload(cur, 'p', 'sources', 'T2')).toEqual({ scope: 'p', cards: ['progress', 'risks', 'sources'], refreshed: { risks: 'T1', sources: 'T2' } });
    expect(addCardPayload(cur, 'p', 'risks', 'T3').cards).toEqual(['progress', 'risks']);
    expect(removeCardPayload(cur, 'p', 'risks')).toEqual({ scope: 'p', cards: ['progress'], refreshed: {} });
  });

  it('refreshCardPayload keeps the card list and only re-stamps the given card', () => {
    const cur = { cards: ['progress', 'risks'] as CardId[], refreshed: { risks: 'T1' } };
    expect(refreshCardPayload(cur, 'p', 'progress', 'T9')).toEqual({ scope: 'p', cards: ['progress', 'risks'], refreshed: { risks: 'T1', progress: 'T9' } });
  });

  it.each(LOCALES)('every payload passes the core reducer for its scope (%s)', (locale) => {
    const { state } = sample(locale);
    for (const scope of ['home', 'sample-atlas'] as const) {
      const cur = cardsFor(state, 'u-alex', scope);
      const card: CardId = scope === 'home' ? 'allRisks' : 'sources';
      const add = addCardPayload(cur, scope, card, now);
      expect(() => sampleWith(locale, [{ type: 'dashboard.set', payload: add }])).not.toThrow();

      const withCard = sampleWith(locale, [{ type: 'dashboard.set', payload: add }]);
      const curAfterAdd = cardsFor(withCard, 'u-alex', scope);
      const removed = removeCardPayload(curAfterAdd, scope, card);
      expect(() => sampleWith(locale, [{ type: 'dashboard.set', payload: add }, { type: 'dashboard.set', payload: removed }])).not.toThrow();

      const refreshed = refreshCardPayload(cur, scope, cur.cards[0]!, now);
      expect(() => sampleWith(locale, [{ type: 'dashboard.set', payload: refreshed }])).not.toThrow();
    }
  });
});

describe('cardStamp', () => {
  it('falls back to the time the page opened', () => {
    expect(cardStamp({}, 'progress', 'T0')).toBe('T0');
    expect(cardStamp({ progress: 'T5' }, 'progress', 'T0')).toBe('T5');
    expect(cardStamp({ risks: 'T5' }, 'progress', 'T0')).toBe('T0');
  });
});

describe('leftText', () => {
  it('covers days left, overdue and no round', () => {
    expect(leftText(tr('en').t, 7)).toBe(tr('en').t('round.left', { n: 7 }));
    expect(leftText(tr('en').t, -2)).toBe(tr('en').t('round.over', { n: 2 }));
    expect(leftText(tr('en').t, null)).toBe(tr('en').t('pg.noRound'));
  });

  it('treats zero days left as "left", not overdue', () => {
    expect(leftText(tr('en').t, 0)).toBe(tr('en').t('round.left', { n: 0 }));
  });
});

describe('riskText and riskTarget', () => {
  it.each(LOCALES)('risk texts name the need code and the person, and targets follow r.go (%s)', (locale) => {
    const { state } = sample(locale);
    const s = viewFor(state, 'u-alex');
    const t = tr(locale).t;
    const risks = allRisks(s, 'u-alex', today);

    const stale = risks.find((r) => r.code === 'stale' && r.projectId === 'sample-atlas')!;
    expect(stale).toBeDefined();
    const n2 = needByCode(s, 'sample-atlas', 'N2')!;
    expect(stale.needId).toBe(n2.id);
    expect(riskText(t, s, stale)).toBe(t('rk.stale', { need: 'N2', who: s.users[stale.userId!]!.displayName, v: stale.v ?? 0 }));
    expect(riskTarget(stale)).toEqual({ open: { projectId: 'sample-atlas', needId: n2.id } });

    const waitMe = risks.find((r) => r.code === 'waitMe' && r.projectId === 'sample-atlas')!;
    expect(waitMe).toBeDefined();
    expect(riskText(t, s, waitMe)).toBe(t('rk.waitMe', { need: s.needs[waitMe.needId!]!.code }));
    expect(riskTarget(waitMe)).toEqual({ open: { projectId: 'sample-atlas', needId: waitMe.needId } });

    const conflict = risks.find((r) => r.code === 'conflict' && r.projectId === 'sample-atlas')!;
    expect(conflict).toBeDefined();
    expect(riskText(t, s, conflict)).toBe(t('rk.conflict', { n: conflict.n ?? 0 }));
    expect(riskTarget(conflict)).toEqual({ overlay: { kind: 'confirm', projectId: 'sample-atlas' } });

    const inputs = risks.find((r) => r.code === 'inputs' && r.projectId === 'sample-atlas')!;
    expect(inputs).toBeDefined();
    expect(riskText(t, s, inputs)).toBe(t('rk.inputs', { n: inputs.n ?? 0 }));
    expect(riskTarget(inputs)).toEqual({ go: { view: 'inputs', projectId: 'sample-atlas' } });

    const todo = risks.find((r) => r.code === 'todo' && r.projectId === 'sample-atlas')!;
    expect(todo).toBeDefined();
    expect(riskText(t, s, todo)).toBe(t('rk.todo', { need: s.needs[todo.needId!]!.code, d: todo.days ?? 0 }));
    expect(riskTarget(todo)).toEqual({ open: { projectId: 'sample-atlas', needId: todo.needId } });
  });

  it.each(LOCALES)('rk.wait and rk.asked follow a handoff sent to someone else, and one they asked about (%s)', (locale) => {
    const { state } = sample(locale);
    const t = tr(locale).t;
    const n4 = needByCode(state, 'sample-atlas', 'N4')!;
    const log = new Log({ initial: state });
    // wait: a handoff from u-alex to u-zhou, still 'sent' — u-alex waits on u-zhou.
    log.emit('handoff.created', 'u-alex', { handoffId: 'ho-u1-wait', projectId: 'sample-atlas', needId: n4.id, toId: 'u-zhou', ask: 'test wait', due: null });
    // asked: a handoff from u-alex to u-zhou, which u-zhou answered with a question.
    log.emit('handoff.created', 'u-alex', { handoffId: 'ho-u1-asked', projectId: 'sample-atlas', needId: n4.id, toId: 'u-zhou', ask: 'test asked', due: null });
    log.emit('handoff.responded', 'u-zhou', { handoffId: 'ho-u1-asked', response: 'asked' });

    const s = viewFor(log.state, 'u-alex');
    const risks = allRisks(s, 'u-alex', today);

    const wait = risks.find((r) => r.code === 'wait' && r.handoffId === 'ho-u1-wait')!;
    expect(wait).toBeDefined();
    expect(riskText(t, s, wait)).toBe(t('rk.wait', { need: s.needs[wait.needId!]!.code, who: s.users[wait.userId!]!.displayName }));
    expect(riskTarget(wait)).toEqual({ open: { projectId: 'sample-atlas', needId: wait.needId } });

    const asked = risks.find((r) => r.code === 'asked' && r.handoffId === 'ho-u1-asked')!;
    expect(asked).toBeDefined();
    expect(riskText(t, s, asked)).toBe(t('rk.asked', { who: s.users[asked.userId!]!.displayName, need: s.needs[asked.needId!]!.code }));
    expect(riskTarget(asked)).toEqual({ open: { projectId: 'sample-atlas', needId: asked.needId } });
  });
});

describe('projectTag', () => {
  it('shortens "Atlas：数据导出" to "Atlas"', () => expect(projectTag('Atlas：数据导出')).toBe('Atlas'));
  it('shortens an English colon title the same way', () => expect(projectTag('Atlas: Data export')).toBe('Atlas'));
  it('clips a long single word to 12 characters', () => expect(projectTag('Supercalifragilistic')).toBe(projectTag('Supercalifragilistic').slice(0, 12)));
  it('clips a long single word to 12 characters (length check)', () => expect(projectTag('Supercalifragilistic').length).toBeLessThanOrEqual(12));
});

describe('confirmRows', () => {
  it.each(LOCALES)('confirm rows for the sample: Atlas conflict on N1 and the paper unlinked question, no stale question (%s)', (locale) => {
    const { state } = sample(locale);
    const s = viewFor(state, 'u-alex');
    const t = tr(locale).t;
    const items = homeItems(s, 'u-alex', today).confirm;
    const rows = confirmRows(t, s, 'u-alex', items, today);

    expect(rows.map((r) => r.tag)).toEqual(expect.arrayContaining(['conflict', 'extract', 'question']));
    expect(rows).toHaveLength(items.length);

    const n1 = needByCode(s, 'sample-atlas', 'N1')!;
    const conflictRow = rows.find((r) => r.tag === 'conflict' && r.projectId === 'sample-atlas')!;
    expect(conflictRow).toBeDefined();
    expect(conflictRow.needId).toBe(n1.id);
    expect(conflictRow.text).toContain('N1');
    expect(conflictRow.text).toContain(s.conflicts[conflictRow.key]!.neu.length > 60 ? s.conflicts[conflictRow.key]!.neu.slice(0, 59) : s.conflicts[conflictRow.key]!.neu);

    // The sample has no stale question (packages/sample/README.md): the parked H5 is set aside, N5 is held by HO2.
    expect(questions(s, 'u-alex', null, today).filter((q) => q.kind === 'stale')).toEqual([]);

    const unlinkedQ = questions(s, 'u-alex', null, today).find((q): q is Extract<Question, { kind: 'unlinked' }> => q.kind === 'unlinked')!;
    expect(unlinkedQ).toBeDefined();
    const unlinkedRow = rows.find((r) => r.tag === 'question' && r.key === questionId(unlinkedQ))!;
    expect(unlinkedRow).toBeDefined();
    expect(unlinkedRow.needId).toBeNull();
    expect(unlinkedRow.text).toBe(t('ask.q.unlinked', { work: s.work[unlinkedQ.workId]!.text }));

    const extractRow = rows.find((r) => r.tag === 'extract' && r.projectId === 'sample-atlas')!;
    expect(extractRow).toBeDefined();
    const extract = s.inputs['sample-atlas:IN3']!.extracts.find((x) => x.id === 'x2')!;
    expect(extractRow.text).toBe(extract.text);
    expect(extractRow.needId).toBeNull();
  });

  it.each(LOCALES)('a stale row reads its idle and left days from core: paper N5 once Alex declines HO2 (%s)', (locale) => {
    const t = tr(locale).t;
    const s = viewFor(sampleWith(locale, [{ type: 'handoff.responded', payload: { handoffId: 'sample-paper:HO2', response: 'declined' } }]), 'u-alex');
    const items = homeItems(s, 'u-alex', today).confirm;
    const rows = confirmRows(t, s, 'u-alex', items, today);
    // The stale row's idle/left days come from core's own `questions()`, never a hard-coded snapshot.
    const n5 = needByCode(s, 'sample-paper', 'N5')!;
    const staleQ = questions(s, 'u-alex', null, today).find((q): q is Extract<Question, { kind: 'stale' }> => q.kind === 'stale' && q.needId === n5.id)!;
    expect(staleQ).toBeDefined();
    const staleRow = rows.find((r) => r.tag === 'question' && r.key === questionId(staleQ))!;
    expect(staleRow).toBeDefined();
    expect(staleRow.needId).toBe(n5.id);
    expect(staleRow.text).toBe(t('ask.q.stale', { need: 'N5', idle: staleQ.idleDays, left: staleQ.daysLeft }));
  });

  it.each(LOCALES)('a proposal row shows its title (%s)', (locale) => {
    const t = tr(locale).t;
    const withProposal = sampleWith(locale, [
      { type: 'proposal.created', payload: { proposalId: 'p-u1-test', projectId: 'sample-atlas', kind: 'ext', title: 'Add CSV export option', via: null } },
    ]);
    const s = viewFor(withProposal, 'u-alex');
    const items: ReturnType<typeof homeItems>['confirm'] = [{ projectId: 'sample-atlas', kind: 'proposal', id: 'p-u1-test' }];
    const [row] = confirmRows(t, s, 'u-alex', items, today) as [ConfirmRow];
    expect(row).toEqual({ key: 'p-u1-test', projectId: 'sample-atlas', tag: 'proposal', text: 'Add CSV export option', needId: null });
  });
});

describe('isActivationKey', () => {
  it('Enter and Space run a focused risk row, as they would a native button; other keys do not', () => {
    expect(isActivationKey('Enter')).toBe(true);
    expect(isActivationKey(' ')).toBe(true);
    expect(isActivationKey('Spacebar')).toBe(true);
    for (const k of ['Tab', 'Escape', 'a', 'ArrowDown']) expect(isActivationKey(k), k).toBe(false);
  });
});
