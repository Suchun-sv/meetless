import { describe, expect, it } from 'vitest';
import { DETECTOR_ID, DomainError, detectExtracts, homeItems, looksLikeAdd, looksLikeQuestion, needVersion, openConflicts, riskList, toItems, toParagraphs, toConfirm, waitingCount, type DomainErrorCode, type ExtractInput } from '../src/index';
import { atlas, P, R, U } from './log';

const rejects = (fn: () => unknown, code: DomainErrorCode) => {
  try {
    fn();
  } catch (e) {
    expect((e as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
};

const doc = [
  '# Client requirements v2',
  'Exports must include all customer fields.',
  'Excel export would be welcome, please support it.',
  'We suspect the date index might keep filtering under 30 s.',
  'N2 should also offer a “last 7 days” shortcut.',
  'The office is closed on Friday.',
].join('\n');

function importDoc(log: ReturnType<typeof atlas>, opts: { private?: boolean; actor?: string; id?: string } = {}) {
  const body = toParagraphs(doc);
  const visibleNeeds = Object.values(log.state.needs).filter((n) => n.privateTo === null || n.privateTo === (opts.actor ?? U.me));
  const extracts = detectExtracts(body, visibleNeeds);
  log.emit('input.imported', opts.actor ?? U.me, {
    inputId: opts.id ?? 'in-1',
    projectId: P,
    kind: 'pdf',
    title: 'Client requirements v2.pdf',
    from: { name: 'Mr Wang (Client A)' },
    date: '2026-11-23',
    body,
    extracts,
    detector: DETECTOR_ID,
    private: opts.private,
  });
  return { body, extracts };
}

describe('rule-based detection', () => {
  it('finds revisions (by code or similarity), conflicts, new needs and hypotheses, and skips small talk', () => {
    const log = atlas();
    const body = toParagraphs(doc);
    expect(body.map((b) => b.text)[0]).toBe('Client requirements v2');
    const xs = detectExtracts(body, Object.values(log.state.needs));
    const byPara = (i: number) => xs.find((x) => x.paraId === body[i]!.id) as ExtractInput | undefined;
    expect(byPara(1)).toMatchObject({ type: 'rev', needId: 'n-export', conflict: true });
    expect(byPara(2)).toMatchObject({ type: 'new' });
    expect(byPara(3)).toMatchObject({ type: 'hyp' });
    expect(byPara(4)).toMatchObject({ type: 'rev', needId: 'n-filter', conflict: false });
    expect(byPara(5)).toBeUndefined();
    expect(byPara(0)).toBeUndefined();
  });

  it('works for Chinese text', () => {
    const log = atlas();
    log.emit('need.created', U.me, { needId: 'n-zh', projectId: P, kind: 'ext', title: '支持数据导出（12 个核心字段）', roundId: R.r1, accept: '可导出 CSV；首版 12 个核心字段', source: { src: 'meeting', date: '2026-11-02', quote: '', ref: '' } });
    const body = toParagraphs('导出需包含客户的全部字段。\n希望支持导出 Excel 格式。\n我怀疑 batch 太小导致结果波动。');
    const xs = detectExtracts(body, [log.state.needs['n-zh']!]);
    expect(xs.map((x) => [x.type, x.needId ?? null, x.conflict ?? false])).toEqual([
      ['rev', 'n-zh', true],
      ['new', null, false],
      ['hyp', null, false],
    ]);
  });
});

describe('accepting and ignoring extracts', () => {
  it('accept creates needs (linked to the source quote) or revises; ignore changes nothing; both are final', () => {
    const log = atlas();
    const { body, extracts } = importDoc(log);
    const xNew = extracts.find((x) => x.type === 'new')!;
    const xHyp = extracts.find((x) => x.type === 'hyp')!;
    const xRev = extracts.find((x) => x.type === 'rev' && !x.conflict)!;
    log.emit('extract.accepted', U.me, { inputId: 'in-1', extractId: xNew.id, needId: 'n-excel' });
    const n = log.state.needs['n-excel']!;
    expect(n).toMatchObject({ kind: 'ext', status: 'todo', code: 'N3', roundId: R.r1, requester: { name: 'Mr Wang (Client A)' } });
    expect(n.source).toMatchObject({ src: 'file', quote: body.find((b) => b.id === xNew.paraId)!.text, ref: 'Client requirements v2.pdf', inputId: 'in-1', extractId: xNew.id });
    expect(log.state.work['in-1:' + xNew.id]).toMatchObject({ needId: 'n-excel', effect: 'extract' });

    log.emit('extract.accepted', U.ben, { inputId: 'in-1', extractId: xHyp.id, needId: 'h-index', roundId: R.r2 });
    expect(log.state.needs['h-index']).toMatchObject({ kind: 'hyp', status: 'untested', code: 'H2', roundId: R.r2 });

    const v = needVersion(log.state.needs['n-filter']!);
    log.emit('extract.accepted', U.me, { inputId: 'in-1', extractId: xRev.id });
    expect(needVersion(log.state.needs['n-filter']!)).toBe(v + 1);
    expect(log.state.needs['n-filter']!.revisions.at(-1)).toMatchObject({ why: 'Client requirements v2.pdf', inputId: 'in-1' });

    rejects(() => log.emit('extract.accepted', U.me, { inputId: 'in-1', extractId: xNew.id, needId: 'again' }), 'ALREADY_DECIDED');
    const before = Object.keys(log.state.needs).length;
    const other = importDoc(log, { id: 'in-2' });
    log.emit('extract.ignored', U.me, { inputId: 'in-2', extractId: other.extracts.find((x) => x.type === 'new')!.id });
    expect(Object.keys(log.state.needs).length).toBe(before);
  });

  it('accepting without a round fills the current round and marks it rule-filled; setting the round clears the mark', () => {
    const log = atlas();
    const { extracts } = importDoc(log);
    const xNew = extracts.find((x) => x.type === 'new')!;
    log.emit('extract.accepted', U.me, { inputId: 'in-1', extractId: xNew.id, needId: 'n-excel' });
    const n = log.state.needs['n-excel']!;
    expect(n.roundId).toBe(R.r1);
    expect(n.autoRound).toBe(true);
    log.emit('need.updated', U.me, { needId: 'n-excel', roundId: R.r2 });
    expect(log.state.needs['n-excel']!.autoRound).toBe(false);
    expect(log.state.needs['n-excel']!.roundId).toBe(R.r2);

    const xHyp = extracts.find((x) => x.type === 'hyp')!;
    log.emit('extract.accepted', U.ben, { inputId: 'in-1', extractId: xHyp.id, needId: 'h-index', roundId: R.r2 });
    expect(log.state.needs['h-index']!.autoRound).toBe(false);
  });

  it('a contradicting revision opens a conflict instead of being accepted in place', () => {
    const log = atlas();
    const { extracts } = importDoc(log);
    const xc = extracts.find((x) => x.conflict)!;
    const cs = openConflicts(log.state, P);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ needId: 'n-export', old: 'CSV export; 12 core fields in v1', neu: 'Exports must include all customer fields.', deciderId: U.me, status: 'open' });
    rejects(() => log.emit('extract.accepted', U.me, { inputId: 'in-1', extractId: xc.id }), 'CONFLICT_OPEN');
    rejects(() => log.emit('extract.ignored', U.me, { inputId: 'in-1', extractId: xc.id }), 'CONFLICT_OPEN');
    expect(toConfirm(log.state, U.me, P, '2026-11-24').conflicts.map((x) => x.id)).toEqual([cs[0]!.id]);
    expect(toConfirm(log.state, U.ben, P, '2026-11-24').conflicts).toEqual([]);
  });
});

describe('conflict resolution', () => {
  it('revise: the need takes the new wording as a revision', () => {
    const log = atlas();
    importDoc(log);
    const c = openConflicts(log.state, P)[0]!;
    rejects(() => log.emit('conflict.resolved', U.ben, { conflictId: c.id, resolution: 'revise' }), 'NOT_AUTHORISED');
    log.emit('conflict.resolved', U.me, { conflictId: c.id, resolution: 'revise' });
    const n = log.state.needs['n-export']!;
    expect(n.accept).toBe('Exports must include all customer fields.');
    expect(needVersion(n)).toBe(2);
    expect(log.state.conflicts[c.id]!.status).toBe('resolved');
    expect(log.state.inputs['in-1']!.extracts.find((x) => x.id === c.extractId)!.state).toBe('accepted');
    rejects(() => log.emit('conflict.resolved', U.me, { conflictId: c.id, resolution: 'revise' }), 'ALREADY_DECIDED');
  });

  it('park: keeps the need and records the new request in a later round', () => {
    const log = atlas();
    importDoc(log);
    const c = openConflicts(log.state, P)[0]!;
    log.emit('conflict.resolved', U.me, { conflictId: c.id, resolution: 'park', needId: 'n-all', roundId: R.r2 });
    expect(log.state.needs['n-export']!.accept).toBe('CSV export; 12 core fields in v1');
    expect(log.state.needs['n-all']).toMatchObject({ roundId: R.r2, status: 'todo', title: 'Exports must include all customer fields.', source: { inputId: 'in-1' } });
  });

  it('handoff: hands the decision to someone; only they can then decide', () => {
    const log = atlas();
    importDoc(log);
    const c = openConflicts(log.state, P)[0]!;
    log.emit('conflict.resolved', U.me, { conflictId: c.id, resolution: 'handoff', handoffId: 'ho-c', toId: U.lin, ask: 'Client asks for all fields; your call.', due: '2026-11-26' });
    expect(log.state.conflicts[c.id]).toMatchObject({ status: 'delegated', deciderId: U.lin });
    expect(log.state.handoffs['ho-c']).toMatchObject({ fromId: U.me, toId: U.lin, needId: 'n-export', state: 'sent', conflictId: c.id });
    expect(toConfirm(log.state, U.lin, P, '2026-11-24').count).toBe(1);
    rejects(() => log.emit('conflict.resolved', U.me, { conflictId: c.id, resolution: 'revise' }), 'NOT_AUTHORISED');
    log.emit('conflict.resolved', U.lin, { conflictId: c.id, resolution: 'park', needId: 'n-all', roundId: null });
    expect(log.state.needs['n-all']!.status).toBe('moved');
    expect(log.state.conflicts[c.id]!.status).toBe('resolved');
  });

  it('the delegate deciding the conflict closes the handoff that delegated it (I1)', () => {
    for (const resolution of ['park', 'revise'] as const) {
      const log = atlas();
      importDoc(log);
      const c = openConflicts(log.state, P)[0]!;
      log.emit('conflict.resolved', U.me, { conflictId: c.id, resolution: 'handoff', handoffId: 'ho-c', toId: U.lin, ask: 'Your call.', due: '2026-11-26' });
      if (resolution === 'park') log.emit('conflict.resolved', U.lin, { conflictId: c.id, resolution, needId: 'n-all', roundId: R.r2 });
      else log.emit('conflict.resolved', U.lin, { conflictId: c.id, resolution });
      const h = log.state.handoffs['ho-c']!;
      expect(h.state, resolution).toBe('done');
      expect(h.history.at(-1)).toMatchObject({ state: 'done', by: U.lin });
      const today = '2026-11-24';
      expect(homeItems(log.state, U.lin, today).toMe).toEqual([]);
      expect(homeItems(log.state, U.me, today).byMe).toEqual([]);
      expect(riskList(log.state, U.lin, P, today).some((r) => r.code === 'waitMe')).toBe(false);
      expect(riskList(log.state, U.me, P, today).some((r) => r.code === 'wait')).toBe(false);
      expect(waitingCount(log.state, U.lin, today)).toBe(0);
    }
  });

  it('the need owner may decide an open conflict; a third member may not', () => {
    const log = atlas();
    importDoc(log);
    const c = openConflicts(log.state, P)[0]!;
    log.emit('need.updated', U.me, { needId: 'n-export', ownerId: U.zhou });
    rejects(() => log.emit('conflict.resolved', U.ben, { conflictId: c.id, resolution: 'revise' }), 'NOT_AUTHORISED');
    log.emit('conflict.resolved', U.zhou, { conflictId: c.id, resolution: 'revise' });
    expect(log.state.conflicts[c.id]!.status).toBe('resolved');
    expect(log.state.needs['n-export']!.accept).toBe('Exports must include all customer fields.');
  });
});

describe('content to add: looksLikeAdd, looksLikeQuestion, toItems', () => {
  const SENTENCE = '需要：1. 做一个research talk的slides； 2. 准备一下leetcode的题目';
  it('the user sentence is an add, split into its two items, each a new need', () => {
    expect(looksLikeAdd(SENTENCE)).toBe(true);
    const { paras, lead } = toItems(SENTENCE, 'p');
    expect(paras.map((p) => p.text)).toEqual(['做一个research talk的slides', '准备一下leetcode的题目']);
    expect(detectExtracts(paras, [], 8, lead).map((x) => [x.type, x.text])).toEqual([
      ['new', '做一个research talk的slides'],
      ['new', '准备一下leetcode的题目'],
    ]);
  });
  it('other add shapes; questions are never adds', () => {
    expect(looksLikeAdd('TODO: write the abstract')).toBe(true);
    expect(looksLikeAdd('1、整理数据 2、跑基线')).toBe(true);
    expect(looksLikeAdd('补实验；改摘要')).toBe(true);
    expect(looksLikeAdd('需要：搞清楚为什么慢')).toBe(true);
    expect(looksLikeAdd('为什么要做消融实验？')).toBe(false);
    expect(looksLikeAdd('Why do we need the ablation study')).toBe(false);
    expect(looksLikeAdd('added the export yesterday')).toBe(false);
    expect(looksLikeQuestion('N2 为什么改了')).toBe(true);
  });
  it('a list under an add line, one item per line; a decimal is not a marker', () => {
    const { paras, lead } = toItems('需要：\n1. 跑 1.5 倍学习率\n2. 画图', 'p');
    expect(paras.map((p) => p.text)).toEqual(['跑 1.5 倍学习率', '画图']);
    expect([...lead]).toEqual(['p1', 'p2']);
  });
});
