import { codesIn, tokens } from './text';
import type { Id, State } from './types';

export type HitKind = 'need' | 'revision' | 'work' | 'input' | 'artifact';
/** `title` is a need's or an input's title (see `kind`); `page` is one text block of an artifact version (`versionId`, `page`). */
export type HitField = 'code' | 'title' | 'accept' | 'expect' | 'verify' | 'verdict' | 'quote' | 'revision' | 'work' | 'paragraph' | 'artifact' | 'page';

export interface SearchHit {
  kind: HitKind;
  /** Id of the matched object (need, revision, work item, input, artifact). */
  id: Id;
  projectId: Id;
  /** The need this hit is about (citation), when there is one. */
  needId: Id | null;
  field: HitField;
  text: string;
  /** Explanation attached to the text (revision reason, work "why"). */
  why: string | null;
  date: string | null;
  score: number;
  /** Artifact page hits: the version whose `derived.texts` matched. */
  versionId?: Id | null;
  /** Artifact page hits: zero-based index into `derived.texts` (page, slide or block). */
  page?: number | null;
  /** Input paragraph hits: the matched paragraph's id. */
  paraId?: Id | null;
}

const WEIGHT: Record<HitField, number> = {
  code: 6,
  title: 3,
  accept: 2,
  expect: 2,
  verify: 1,
  verdict: 2,
  quote: 2,
  revision: 3,
  work: 1.5,
  paragraph: 1,
  artifact: 1.5,
  page: 1,
};

/**
 * Keyword retrieval over the project record the viewer can see: needs (title,
 * criteria, verdict), source quotes, revisions, work, input titles and
 * paragraphs, artifact titles and the extracted text of every artifact
 * version (`derived.texts`, one hit per page or block). `view` must already be the viewer's view (viewFor / client
 * state), so private items of others can never match.
 */
export function search(view: State, q: { text: string; projectId?: Id | null; limit?: number }): SearchHit[] {
  const qt = [...new Set(tokens(q.text))];
  const codes = new Set(codesIn(q.text));
  if (qt.length === 0 && codes.size === 0) return [];
  const inScope = (pid: Id) => !q.projectId || pid === q.projectId;
  const hits: SearchHit[] = [];
  const score = (text: string | null | undefined, field: HitField): number => {
    if (!text) return 0;
    const t = new Set(tokens(text));
    let n = 0;
    for (const x of qt) if (t.has(x)) n++;
    return n * WEIGHT[field];
  };
  const add = (h: Omit<SearchHit, 'score'>, s: number) => {
    if (s > 0) hits.push({ ...h, score: s });
  };

  for (const n of Object.values(view.needs)) {
    if (!inScope(n.projectId)) continue;
    const base = { kind: 'need' as const, id: n.id, projectId: n.projectId, needId: n.id, why: null, date: null };
    const codeBoost = codes.has(n.code) ? WEIGHT.code : 0;
    if (codeBoost) add({ ...base, field: 'code', text: n.title }, codeBoost);
    add({ ...base, field: 'title', text: n.title }, score(n.title, 'title'));
    add({ ...base, field: n.kind === 'ext' ? 'accept' : 'expect', text: (n.kind === 'ext' ? n.accept : n.expect) ?? '' }, score(n.kind === 'ext' ? n.accept : n.expect, n.kind === 'ext' ? 'accept' : 'expect'));
    if (n.verify) add({ ...base, field: 'verify', text: n.verify }, score(n.verify, 'verify'));
    if (n.verdict) add({ ...base, field: 'verdict', text: n.verdict }, score(n.verdict, 'verdict') + (codeBoost ? 1 : 0));
    add({ ...base, field: 'quote', text: n.source.quote, why: n.source.ref, date: n.source.date }, score(`${n.source.quote} ${n.source.ref}`, 'quote'));
    for (const r of n.revisions) {
      add(
        { kind: 'revision', id: r.id, projectId: n.projectId, needId: n.id, field: 'revision', text: r.text, why: r.why, date: r.date },
        score(`${r.text} ${r.why}`, 'revision') + (codeBoost ? 2 : 0),
      );
    }
  }
  for (const w of Object.values(view.work)) {
    if (!inScope(w.projectId)) continue;
    const linked = (w.needId && codes.has(view.needs[w.needId]?.code ?? '')) ? 1 : 0;
    add({ kind: 'work', id: w.id, projectId: w.projectId, needId: w.needId, field: 'work', text: w.text, why: w.why, date: w.date }, score(`${w.text} ${w.why ?? ''}`, 'work') + linked);
  }
  for (const i of Object.values(view.inputs)) {
    if (!inScope(i.projectId)) continue;
    add({ kind: 'input', id: i.id, projectId: i.projectId, needId: null, field: 'title', text: i.title, why: null, date: i.date }, score(i.title, 'title'));
    for (const p of i.body) {
      const x = i.extracts.find((e) => e.paraId === p.id);
      // A shared input may name a need the viewer cannot see (accepted while the input was private): cite no need then.
      const xNeed = x?.resultNeedId ?? x?.needId ?? null;
      add({ kind: 'input', id: i.id, projectId: i.projectId, needId: xNeed !== null && view.needs[xNeed] ? xNeed : null, field: 'paragraph', text: p.text, why: i.title, date: i.date, paraId: p.id }, score(p.text, 'paragraph'));
    }
  }
  for (const a of Object.values(view.artifacts)) {
    if (!inScope(a.projectId)) continue;
    add(
      { kind: 'artifact', id: a.id, projectId: a.projectId, needId: a.needIds[0] ?? null, field: 'artifact', text: a.title, why: a.versions[0]?.note ?? null, date: a.versions[0]?.date ?? null },
      score(`${a.title} ${a.where} ${a.versions.map((v) => `${v.label} ${v.note}`).join(' ')}`, 'artifact'),
    );
    // Newest version first; a block whose text is unchanged from a newer version is cited there only.
    const seen = new Set<string>();
    for (const v of a.versions) {
      (v.derived?.texts ?? []).forEach((t, page) => {
        const key = `${page}|${t}`;
        if (seen.has(key)) return;
        seen.add(key);
        add({ kind: 'artifact', id: a.id, projectId: a.projectId, needId: a.needIds[0] ?? null, field: 'page', text: t, why: a.title, date: v.date, versionId: v.id, page }, score(t, 'page'));
      });
    }
  }
  hits.sort((a, b) => b.score - a.score || (a.date ?? '').localeCompare(b.date ?? ''));
  return hits.slice(0, q.limit ?? 20);
}

/**
 * The best input and artifact hits with no linked need (groupByNeed drops
 * them), one per (kind, id, versionId, page), best first.
 */
export function materialHits(hits: SearchHit[], max = 3): SearchHit[] {
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  for (const h of [...hits].sort((a, b) => b.score - a.score)) {
    if ((h.kind !== 'input' && h.kind !== 'artifact') || h.needId) continue;
    const key = JSON.stringify([h.kind, h.id, h.versionId ?? null, h.page ?? null]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

/** Hits grouped by cited need, best need first (hits without a need are dropped). */
export function groupByNeed(hits: SearchHit[], maxNeeds = 3, perNeed = 3): { needId: Id; score: number; hits: SearchHit[] }[] {
  const by = new Map<Id, { needId: Id; score: number; hits: SearchHit[] }>();
  for (const h of hits) {
    if (!h.needId) continue;
    const g = by.get(h.needId) ?? { needId: h.needId, score: 0, hits: [] };
    g.score += h.score;
    if (g.hits.length < perNeed && !g.hits.some((x) => x.field === h.field && x.text === h.text)) g.hits.push(h);
    by.set(h.needId, g);
  }
  return [...by.values()].sort((a, b) => b.score - a.score).slice(0, maxNeeds);
}
