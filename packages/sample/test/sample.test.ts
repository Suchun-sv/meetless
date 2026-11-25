import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  currentRound,
  daysLeft,
  DOT_RE,
  handoffForNeed,
  handoffStaleness,
  needByCode,
  openConflicts,
  projectNeeds,
  questions,
  toConfirm,
  viewFor,
  type State,
} from '@meetless/core';
import { buildSample, loadPrototype, PROTOTYPE_FILES, SAMPLE_PROJECT_IDS, sampleState } from '../src/index';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const TODAY = '2026-11-24';
const ME = 'u-alex';
const PAPER = SAMPLE_PROJECT_IDS.paper;
const ATLAS = SAMPLE_PROJECT_IDS.atlas;

const zh = sampleState({ locale: 'zh-CN', me: ME, today: TODAY, repoRoot });
const en = sampleState({ locale: 'en', me: ME, today: TODAY, repoRoot });
const state = zh.state;

/** Shared codes of a project in creation order. */
const codes = (projectId: string, s: State = state) => projectNeeds(s, projectId).filter((n) => n.privateTo === null).map((n) => n.code);
const need = (projectId: string, code: string, s: State = state) => {
  const n = needByCode(s, projectId, code);
  if (!n) throw new Error(`${projectId} ${code} missing`);
  return n;
};

describe('@meetless/sample', () => {
  it('replays without errors into two sample projects with prototype codes', () => {
    expect(codes('sample-paper')).toEqual(['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'H1', 'H2', 'H3', 'H4', 'H5']);
    expect(codes('sample-atlas')).toEqual(['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'H1', 'H2', 'H3']);
    expect(state.projects['sample-paper']!.sample).toBe(true);
    expect(state.projects['sample-atlas']!.sample).toBe(true);
    expect(Object.keys(state.projects).sort()).toEqual([ATLAS, PAPER]);
    expect(state.projects[PAPER]!.memberIds).toEqual([ME, 'u-prof', 'u-mia']);
    expect(state.projects[ATLAS]!.memberIds).toEqual([ME, 'u-lin', 'u-ruo', 'u-ben', 'u-zhou']);
    // Rounds 1 and 2 delivered, round 3 current, round 4 planned, in both projects.
    for (const pid of [PAPER, ATLAS]) {
      const rs = Object.values(state.rounds).filter((r) => r.projectId === pid).sort((a, b) => a.n - b.n);
      expect(rs.map((r) => r.status)).toEqual(['delivered', 'delivered', 'current', 'planned']);
    }
    // Clients and venues are requester names, not members.
    expect(need(ATLAS, 'N4').requester).toEqual({ name: '王经理（客户 A）' });
    expect(need(PAPER, 'N1').requester).toEqual({ userId: 'u-prof' });
    // A need from an accepted extract gets its requester from its input, whose `from` is who said it.
    expect(need(PAPER, 'N4').requester).toEqual({ userId: 'u-prof' });
    expect(need(PAPER, 'N5').requester).toEqual({ userId: 'u-prof' });
    // Known mismatch: N7 (Mia's) comes from the same minutes as N4 and N5, which are from Prof. Zhang.
    expect(need(PAPER, 'N7').requester).toEqual({ userId: 'u-prof' });
    expect(need(ATLAS, 'N1').requester).toEqual({ name: '王经理（客户 A）' });
    expect(need(PAPER, 'N6').requester).toEqual({ name: 'VLDB 投稿要求' });
    expect(need(ATLAS, 'N3').requester).toEqual({ userId: 'u-lin' });
    // A pending input keeps the prototype sender.
    expect(state.inputs['sample-paper:IN5']!.from).toEqual({ userId: 'u-mia' });
    // A need from an accepted extract links its quote to the input.
    expect(need(PAPER, 'N6').source.inputId).toBeDefined();
    expect(need(PAPER, 'N6').title).toBe('正文 12 页以内');
    expect(need(PAPER, 'N4').status).toBe('doing');
    expect(need(PAPER, 'N4').ownerId).toBe(ME);
  });

  it('Atlas: Zhou’s N2 handoff is stale (fetched v1, now v2); N1 has an open conflict that Alex decides', () => {
    const n2 = need(ATLAS, 'N2');
    const h = handoffForNeed(state, n2.id)!;
    expect(h).not.toBeNull();
    expect([h.fromId, h.toId, h.state]).toEqual([ME, 'u-zhou', 'doing']);
    expect(handoffStaleness(state, h)).toEqual({ fetched: 1, current: 2, reminded: false });
    const cs = openConflicts(state, ATLAS);
    expect(cs).toHaveLength(1);
    expect(cs[0]!.needId).toBe(need(ATLAS, 'N1').id);
    expect(cs[0]!.deciderId).toBe(ME);
    expect(toConfirm(state, ME, ATLAS, TODAY).conflicts.map((c) => c.id)).toEqual([cs[0]!.id]);
    // Lin's N3 handoff to Alex waits for an answer.
    const h3 = handoffForNeed(state, need(ATLAS, 'N3').id)!;
    expect([h3.fromId, h3.toId, h3.state]).toEqual(['u-lin', ME, 'sent']);
  });

  it('paper: Alex has exactly one question, the unlinked temperature commit; the parked H5 is not stale (I2)', () => {
    const qs = questions(state, ME, PAPER, TODAY);
    expect(qs).toHaveLength(1);
    const unlinked = qs.filter((q) => q.kind === 'unlinked');
    expect(unlinked).toHaveLength(1);
    const w = state.work[(unlinked[0] as { workId: string }).workId]!;
    expect(w.text).toContain('tweak temperature 0.7');
    expect(w.by).toBe(ME);
    // H5 sits in the current round, idle 13 days with 7 left, but it is parked: set aside on purpose.
    expect(need(PAPER, 'H5').status).toBe('parked');
    expect(qs.filter((q) => q.kind === 'stale')).toEqual([]);
    // Nobody gets a stale question: the stalest open external need, N5 (todo, idle 14, 7 left), is held by Prof. Zhang's open handoff.
    for (const u of Object.keys(state.users)) expect(questions(state, u, null, TODAY).filter((q) => q.kind === 'stale'), u).toEqual([]);
    const n5 = need(PAPER, 'N5');
    expect([n5.kind, n5.status, n5.ownerId, n5.source.date]).toEqual(['ext', 'todo', ME, '2026-11-10']);
    const h5 = handoffForNeed(state, n5.id)!;
    expect([h5.fromId, h5.toId, h5.state]).toEqual(['u-prof', ME, 'sent']);
    // Mia's N7 handoff, and agent reports through Codex.
    const h7 = handoffForNeed(state, need(PAPER, 'N7').id)!;
    expect([h7.fromId, h7.toId, h7.state]).toEqual([ME, 'u-mia', 'doing']);
    expect(h7.fetches.map((f) => [f.version, f.client])).toEqual([[1, 'codex']]);
    const agentWork = Object.values(state.work).filter((x) => x.projectId === PAPER && x.via);
    expect(agentWork.length).toBeGreaterThanOrEqual(2);
    for (const x of agentWork) expect(x.via).toEqual({ client: 'codex', tokenId: 'sample' });
    const zhouReport = Object.values(state.work).find((x) => x.projectId === ATLAS && x.via)!;
    expect([zhouReport.by, zhouReport.via]).toEqual(['u-zhou', { client: 'claude-code', tokenId: 'sample' }]);
  });

  it('the private hypothesis is Hp1 and only Alex’s stream carries it', () => {
    const hp = Object.values(state.needs).filter((n) => n.privateTo !== null);
    expect(hp.map((n) => [n.projectId, n.code, n.kind, n.privateTo])).toEqual([[PAPER, 'Hp1', 'hyp', ME]]);
    const id = hp[0]!.id;
    const carrying = zh.events.map((e, i) => ({ e, scope: zh.scopes[i]! })).filter(({ e }) => JSON.stringify(e).includes(id));
    expect(carrying.length).toBeGreaterThan(0);
    for (const { scope } of carrying) expect(scope.privateTo).toBe(ME);
    for (const other of ['u-prof', 'u-mia']) {
      expect(viewFor(state, other).needs[id]).toBeUndefined();
      const stream = zh.events.filter((_, i) => zh.scopes[i]!.privateTo === null || zh.scopes[i]!.privateTo === other);
      expect(JSON.stringify(stream)).not.toContain(id);
      expect(JSON.stringify(stream)).not.toContain('RoPE');
    }
    expect(viewFor(state, ME).needs[id]!.code).toBe('Hp1');
  });

  it('zh-CN and en samples contain no DOT_RE character and use the chosen language', () => {
    for (const s of [zh, en]) {
      expect(JSON.stringify(s.events)).not.toMatch(DOT_RE);
      expect(JSON.stringify(s.state)).not.toMatch(DOT_RE);
    }
    expect(zh.state.projects[PAPER]!.name).toBe('论文：长上下文缓存压缩');
    expect(en.state.projects[PAPER]!.name).toBe('Paper: long-context cache compression');
    expect(zh.state.projects[ATLAS]!.name).toBe('Atlas 数据平台 导出功能');
    expect(en.state.projects[ATLAS]!.name).toBe('Atlas data platform Export');
    expect(need(PAPER, 'N1', en.state).title).toBe('First show that existing cache methods break on long contexts');
    expect(need(PAPER, 'N1', zh.state).title).toBe('先证明现有缓存方法在长上下文下会失效');
    expect(JSON.stringify(en.events)).not.toMatch(/\p{Script=Han}/u);
    expect(codes(PAPER, en.state)).toEqual(codes(PAPER, zh.state));
  });

  it('dates follow today: with today 2026-12-01 the current Atlas round is due in 4 days', () => {
    const later = sampleState({ locale: 'en', me: ME, today: '2026-12-01', repoRoot }).state;
    const r = currentRound(later, ATLAS)!;
    expect(r.n).toBe(3);
    expect(daysLeft(r, '2026-12-01')).toBe(4);
    expect(r.due).toBe('2026-12-05');
    // The paper's questions move with the dates too.
    expect(questions(later, ME, PAPER, '2026-12-01').map((q) => q.kind)).toEqual(['unlinked']);
  });

  it('building twice yields identical command ids', () => {
    const data = loadPrototype(repoRoot);
    const opts = { locale: 'zh-CN', me: ME, today: TODAY } as const;
    const a = buildSample(data, opts).map((x) => x.cmd.id);
    const b = buildSample(loadPrototype(repoRoot), opts).map((x) => x.cmd.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    expect(a.filter((id) => !id.startsWith('register:'))).toEqual(a.filter((id) => !id.startsWith('register:')).map((_, i) => `sample:${i + 1}`));
    // Another language or another day builds the same commands under the same ids.
    expect(buildSample(data, { ...opts, locale: 'en', today: '2026-12-01' }).map((x) => x.cmd.id)).toEqual(a);
  });

  it('a me who is one of the sample people is refused', () => {
    const data = loadPrototype(repoRoot);
    for (const me of ['u-lin', 'u-ben', 'u-zhou', 'u-prof', 'u-mia', 'u-ruo']) {
      expect(() => buildSample(data, { locale: 'en', me, today: TODAY })).toThrow(`me (${me}) is one of the sample's own people`);
    }
  });

  it('every event is dated no later than today; round creation is dated at the project start', () => {
    const later = (e: { occurredAt?: string }) => (e.occurredAt ?? '') > `${TODAY}T23:59:59.999Z`;
    expect(zh.events.filter(later).map((e) => `${e.id} ${e.type}`)).toEqual([]);
    for (const e of zh.events.filter((x) => x.type === 'round.created')) {
      const p = zh.events.find((x) => x.type === 'project.created' && (x.payload as { projectId: string }).projectId === (e.payload as { projectId: string }).projectId)!;
      expect(e.occurredAt).toBe(p.occurredAt);
    }
  });

  it('the prototype runs without host objects in its context, under a timeout', () => {
    const fake = (paper: string) => {
      const root = mkdtempSync(join(tmpdir(), 'meetless-sample-'));
      PROTOTYPE_FILES.forEach((f, i) => {
        mkdirSync(dirname(join(root, f)), { recursive: true });
        writeFileSync(join(root, f), i === 0 ? paper : 'window.NeedsExtra = window.NeedsExtra || {}; window.NeedsCollab = {};');
      });
      return root;
    };
    const probe = (via: string) => `(function () { try { return typeof ${via}.constructor.constructor('return process')(); } catch (e) { return 'blocked'; } })()`;
    const escape = fake(`window.NeedsProjects = [{ id: 'probe', viaWindow: ${probe('window')}, viaThis: ${probe('this')} }];`);
    try {
      expect(loadPrototype(escape).projects).toEqual([{ id: 'probe', viaWindow: 'blocked', viaThis: 'blocked' }]);
    } finally {
      rmSync(escape, { recursive: true, force: true });
    }
    const loop = fake('while (true) {}');
    try {
      expect(() => loadPrototype(loop)).toThrow(/timed out/);
    } finally {
      rmSync(loop, { recursive: true, force: true });
    }
  });

  it('another me takes Alex’s place', () => {
    const s = sampleState({ locale: 'en', me: 'u-sam', today: TODAY, repoRoot }).state;
    expect(s.projects[PAPER]!.memberIds[0]).toBe('u-sam');
    expect(s.users['u-sam']!.displayName).toBe('Sam');
    expect(s.users['u-alex']).toBeUndefined();
    expect(questions(s, 'u-sam', PAPER, TODAY).map((q) => q.kind)).toEqual(['unlinked']);
  });
});
