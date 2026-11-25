import { describe, expect, it } from 'vitest';
import { answer, materialHits, search, viewFor, type AgentAnswer, type SearchHit, type State } from '../src/index';
import { atlas, P, U } from './log';

const today = '2026-11-24';
const SLIDE = 'Our churn baseline is four percent per month';

/** Atlas plus an unlinked PPTX artifact (two versions, same slide text) and an unlinked input. */
function withMaterials() {
  const log = atlas();
  log.emit('artifact.created', U.me, { artifactId: 'a-deck', projectId: P, kind: 'pptx', title: 'Kickoff slides', where: 'local', needIds: [] });
  for (const v of ['v1', 'v2']) {
    log.emit('artifact.version_added', U.me, { artifactId: 'a-deck', versionId: `av-${v}`, label: v, date: v === 'v1' ? '2026-11-20' : '2026-11-22', note: '' });
    log.emit('artifactVersion.derived', 'system', { artifactId: 'a-deck', versionId: `av-${v}`, status: 'ready', pageHashes: [], texts: ['Kickoff', 'Agenda', SLIDE], error: null, converter: 'test' });
  }
  log.emit('input.imported', U.me, {
    inputId: 'in-vendor',
    projectId: P,
    kind: 'txt',
    title: 'Vendor quotation from Northwind',
    date: '2026-11-21',
    body: [{ id: 'p1', text: 'Thanks for the call yesterday.' }],
    extracts: [],
    detector: 'rules/1',
  });
  return log;
}

const ask = (view: State, userId: string, text: string): AgentAnswer => answer(view, { userId, scope: { kind: 'project', projectId: P }, text, today }).answer;

describe('the project agent answers from project materials', () => {
  it('cites an unlinked artifact by the text on one of its pages, at the newest version', () => {
    const log = withMaterials();
    const view = viewFor(log.state, U.ben);
    const hit = search(view, { text: 'churn baseline', projectId: P })[0]!;
    expect(hit).toMatchObject({ kind: 'artifact', id: 'a-deck', field: 'page', versionId: 'av-v2', page: 2, text: SLIDE, needId: null });

    const a = ask(view, U.ben, 'what is our churn baseline?');
    expect(a.intent).toBe('retrieval');
    if (a.intent !== 'retrieval') return;
    expect(a.needs).toEqual([]);
    expect(a.materials).toEqual([{ kind: 'artifact', id: 'a-deck', projectId: P, versionId: 'av-v2', page: 2, text: SLIDE, title: 'Kickoff slides' }]);
    // `cites` holds need ids only (M3); the material's own id is in `materials`.
    expect(a.cites).toEqual([]);
  });

  it('finds an input by its title alone', () => {
    const log = withMaterials();
    const view = viewFor(log.state, U.ben);
    expect(search(view, { text: 'Northwind quotation', projectId: P })[0]).toMatchObject({ kind: 'input', id: 'in-vendor', field: 'title', needId: null });

    const a = ask(view, U.ben, 'where is the Northwind quotation?');
    expect(a.intent).toBe('retrieval');
    if (a.intent !== 'retrieval') return;
    expect(a.materials[0]).toMatchObject({ kind: 'input', id: 'in-vendor', versionId: null, page: null, title: 'Vendor quotation from Northwind' });
    expect(a.materials[0]!.paraId).toBeUndefined();
    expect(a.cites).toEqual([]);
  });

  it('keeps need answers as they were and adds no materials when none match', () => {
    const a = ask(viewFor(withMaterials().state, U.me), U.me, 'did we try a cache table?');
    expect(a.intent).toBe('retrieval');
    if (a.intent !== 'retrieval') return;
    expect(a.cites).toEqual(['h-cache']);
    expect(a.materials).toEqual([]);
  });

  it('never reaches another user through a private artifact; its owner gets it', () => {
    const log = atlas();
    const secret = 'Zephyr acquisition shortlist';
    log.emit('artifact.created', U.me, { artifactId: 'a-secret', projectId: P, kind: 'pptx', title: 'Board memo', where: 'local', needIds: [], private: true });
    log.emit('artifact.version_added', U.me, { artifactId: 'a-secret', versionId: 'av-secret', label: 'v1', date: '2026-11-22', note: '' });
    log.emit('artifactVersion.derived', 'system', { artifactId: 'a-secret', versionId: 'av-secret', status: 'ready', pageHashes: [], texts: ['Cover', secret], error: null, converter: 'test' });
    const leaks = (x: unknown) => /Zephyr|Board memo|a-secret|av-secret/.test(JSON.stringify(x));

    const forBen = viewFor(log.state, U.ben);
    expect(search(forBen, { text: 'Zephyr acquisition', projectId: P })).toEqual([]);
    expect(leaks(answer(forBen, { userId: U.ben, scope: { kind: 'project', projectId: P }, text: 'any Zephyr acquisition shortlist?', today }))).toBe(false);

    const mine = ask(viewFor(log.state, U.me), U.me, 'any Zephyr acquisition shortlist?');
    expect(mine.intent).toBe('retrieval');
    if (mine.intent !== 'retrieval') return;
    expect(mine.materials[0]).toMatchObject({ kind: 'artifact', id: 'a-secret', versionId: 'av-secret', page: 1, text: secret, title: 'Board memo' });
    expect(mine.cites).toEqual([]);
  });
});

describe('material citations point at the paragraph and show the match', () => {
  it('an input paragraph hit and its citation carry the paragraph id (M4)', () => {
    const view = viewFor(withMaterials().state, U.ben);
    expect(search(view, { text: 'call yesterday', projectId: P })[0]).toMatchObject({ kind: 'input', id: 'in-vendor', field: 'paragraph', paraId: 'p1', needId: null });
    expect(search(view, { text: 'Northwind quotation', projectId: P })[0]!.paraId).toBeUndefined();
    const a = ask(view, U.ben, 'what about the call yesterday?');
    expect(a.intent).toBe('retrieval');
    if (a.intent !== 'retrieval') return;
    expect(a.materials[0]).toMatchObject({ kind: 'input', id: 'in-vendor', paraId: 'p1', text: 'Thanks for the call yesterday.' });
    expect(a.cites).toEqual([]);
  });

  it('every intent cites need ids only', () => {
    const log = withMaterials();
    const view = viewFor(log.state, U.me);
    for (const q of ['what is our churn baseline?', 'did we try a cache table?', 'Northwind quotation', 'export']) {
      const a = ask(view, U.me, q);
      for (const id of a.cites) expect(view.needs[id], `${q}: ${id}`).toBeDefined();
    }
  });

  // R69: the window centres on the first match (by character, not token), with an ellipsis on each cut side.
  const LONG_EN = `Intro. ${'lorem ipsum dolor sit amet '.repeat(16)}Our churn baseline is four percent per month. ${'consectetur adipiscing elit '.repeat(14)}End.`;
  // Astral Han characters (two UTF-16 units each) around the match: a code-unit slice would split one.
  const LONG_ZH = `前言。${'𠮷𠮷𡈽'.repeat(150)}我们的流失基线是每月百分之四。${'𠮷𡈽'.repeat(150)}完。`;
  const longPages = () => {
    const log = atlas();
    log.emit('artifact.created', U.me, { artifactId: 'a-long', projectId: P, kind: 'pdf', title: 'Long report', where: 'local', needIds: [] });
    log.emit('artifact.version_added', U.me, { artifactId: 'a-long', versionId: 'av-long', label: 'v1', date: '2026-11-22', note: '' });
    log.emit('artifactVersion.derived', 'system', { artifactId: 'a-long', versionId: 'av-long', status: 'ready', pageHashes: [], texts: [LONG_EN, LONG_ZH], error: null, converter: 'test' });
    return viewFor(log.state, U.ben);
  };
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it('a long English page: the snippet shows the match past character 240, cut on both sides', () => {
    expect(LONG_EN.indexOf('churn')).toBeGreaterThan(240);
    expect(LONG_EN.length - LONG_EN.indexOf('churn')).toBeGreaterThan(240);
    const a = ask(longPages(), U.ben, 'what is our churn baseline?');
    expect(a.intent).toBe('retrieval');
    if (a.intent !== 'retrieval') return;
    const m = a.materials[0]!;
    expect(m).toMatchObject({ kind: 'artifact', id: 'a-long', versionId: 'av-long', page: 0 });
    expect(m.text).toContain('churn baseline is four percent');
    expect(m.text.startsWith('…')).toBe(true);
    expect(m.text.endsWith('…')).toBe(true);
    expect([...m.text].length).toBeLessThanOrEqual(240);
    // Centred: about as much text before the match as after it.
    const at = m.text.indexOf('churn');
    expect(Math.abs(at - (m.text.length - at))).toBeLessThan(60);
  });

  it('a long Chinese page with astral characters: the snippet shows the match and never splits a character', () => {
    expect([...LONG_ZH].indexOf('流')).toBeGreaterThan(240);
    const a = ask(longPages(), U.ben, '流失基线是多少？');
    expect(a.intent).toBe('retrieval');
    if (a.intent !== 'retrieval') return;
    const m = a.materials[0]!;
    expect(m).toMatchObject({ kind: 'artifact', id: 'a-long', versionId: 'av-long', page: 1 });
    expect(m.text).toContain('流失基线是每月百分之四');
    expect(m.text.startsWith('…')).toBe(true);
    expect(m.text.endsWith('…')).toBe(true);
    expect([...m.text].length).toBeLessThanOrEqual(240);
    expect(lone.test(m.text)).toBe(false);
    const cps = [...m.text];
    const at = cps.indexOf('流');
    expect(Math.abs(at - (cps.length - at))).toBeLessThan(40);
  });

  it('a match near the start or end is cut on one side only; a short text is not cut', () => {
    const log = atlas();
    const head = `Churn baseline first. ${'lorem ipsum dolor sit amet '.repeat(20)}`;
    const tail = `${'lorem ipsum dolor sit amet '.repeat(20)}and last the churn baseline.`;
    log.emit('artifact.created', U.me, { artifactId: 'a-h', projectId: P, kind: 'pdf', title: 'Head', where: 'local', needIds: [] });
    log.emit('artifact.version_added', U.me, { artifactId: 'a-h', versionId: 'av-h', label: 'v1', date: '2026-11-22', note: '' });
    log.emit('artifactVersion.derived', 'system', { artifactId: 'a-h', versionId: 'av-h', status: 'ready', pageHashes: [], texts: [head, tail, 'Churn baseline, short.'], error: null, converter: 'test' });
    const a = ask(viewFor(log.state, U.ben), U.ben, 'churn baseline');
    expect(a.intent).toBe('retrieval');
    if (a.intent !== 'retrieval') return;
    const byPage = new Map(a.materials.map((m) => [m.page, m.text]));
    expect(byPage.get(0)!.startsWith('Churn baseline first.')).toBe(true);
    expect(byPage.get(0)!.endsWith('…')).toBe(true);
    expect(byPage.get(1)!.startsWith('…')).toBe(true);
    expect(byPage.get(1)!.endsWith('and last the churn baseline.')).toBe(true);
    expect(byPage.get(2)).toBe('Churn baseline, short.');
    for (const t of byPage.values()) expect([...t].length).toBeLessThanOrEqual(240);
  });
});

describe('materialHits', () => {
  const h = (over: Partial<SearchHit>): SearchHit => ({ kind: 'input', id: 'i', projectId: P, needId: null, field: 'paragraph', text: 't', why: null, date: null, score: 1, ...over });

  it('keeps the best unlinked input and artifact hits, one per (kind, id, version, page)', () => {
    const hits = [
      h({ kind: 'need', id: 'n', needId: 'n', field: 'title', score: 9 }),
      h({ kind: 'artifact', id: 'a', needId: 'n', field: 'page', versionId: 'v', page: 0, score: 8 }),
      h({ kind: 'artifact', id: 'a', field: 'page', versionId: 'v', page: 1, score: 5 }),
      h({ kind: 'artifact', id: 'a', field: 'page', versionId: 'v', page: 1, text: 'again', score: 4 }),
      h({ kind: 'input', id: 'i', field: 'title', score: 6 }),
      h({ kind: 'input', id: 'i', field: 'paragraph', text: 'other', score: 2 }),
      h({ kind: 'artifact', id: 'b', field: 'artifact', score: 3 }),
    ];
    expect(materialHits(hits).map((x) => [x.kind, x.id, x.versionId ?? null, x.page ?? null, x.score])).toEqual([
      ['input', 'i', null, null, 6],
      ['artifact', 'a', 'v', 1, 5],
      ['artifact', 'b', null, null, 3],
    ]);
    expect(materialHits(hits, 1)).toHaveLength(1);
  });
});
