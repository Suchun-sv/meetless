import { groupByNeed, noDots, search, type HitField, type Id, type SearchHit, type State } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';

/**
 * Search page model. Runs core `search` over the viewer's own state: the server already left out
 * other people's private items, so nothing is filtered here for privacy.
 */

export type SearchScope = 'project' | 'all';

export interface NeedGroup {
  needId: Id;
  projectId: Id;
  code: string;
  title: string;
  hits: SearchHit[];
}

export interface SearchResults {
  query: string;
  needs: NeedGroup[];
  /** Input paragraphs and titles, artifact titles and pages, with no linked need. */
  materials: SearchHit[];
  /** Work items with no linked need. */
  work: SearchHit[];
  total: number;
}

const EMPTY: SearchResults = { query: '', needs: [], materials: [], work: [], total: 0 };

export function runSearch(view: State, text: string, projectId: Id | null, limit = 60): SearchResults {
  const query = text.trim();
  if (!query) return EMPTY;
  const hits = search(view, { text: query, projectId, limit });
  const needs: NeedGroup[] = groupByNeed(hits, 12, 3).flatMap((g) => {
    const n = view.needs[g.needId];
    return n ? [{ needId: n.id, projectId: n.projectId, code: n.code, title: noDots(n.title), hits: g.hits }] : [];
  });
  const seen = new Set<string>();
  const once = (h: SearchHit) => {
    const key = JSON.stringify([h.kind, h.id, h.paraId ?? null, h.versionId ?? null, h.page ?? null]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const free = hits.filter((h) => !h.needId || !view.needs[h.needId]);
  const materials = free.filter((h) => (h.kind === 'input' || h.kind === 'artifact') && once(h));
  const work = free.filter((h) => h.kind === 'work' && once(h));
  return { query, needs, materials, work, total: needs.length + materials.length + work.length };
}

/** Where a hit opens, in the old renderer's route shape (the integrator maps it onto Expo routes). */
export type SearchTarget =
  | { view: 'board'; projectId: Id; needId: Id }
  | { view: 'inputs'; projectId: Id; focusId: Id; paraId?: Id }
  | { view: 'artifacts'; projectId: Id; focusId: Id; versionId?: Id; page?: number }
  | { view: 'stream'; projectId: Id };

export function hitTarget(h: SearchHit): SearchTarget {
  if (h.kind === 'input') return h.paraId ? { view: 'inputs', projectId: h.projectId, focusId: h.id, paraId: h.paraId } : { view: 'inputs', projectId: h.projectId, focusId: h.id };
  if (h.kind === 'artifact') {
    return h.versionId != null && h.page != null
      ? { view: 'artifacts', projectId: h.projectId, focusId: h.id, versionId: h.versionId, page: h.page }
      : { view: 'artifacts', projectId: h.projectId, focusId: h.id };
  }
  if (h.kind === 'work') return { view: 'stream', projectId: h.projectId };
  return { view: 'board', projectId: h.projectId, needId: h.needId ?? h.id };
}

export function needTarget(g: NeedGroup): SearchTarget {
  return { view: 'board', projectId: g.projectId, needId: g.needId };
}

/** The label for the field a hit matched in (new keys under `search.f.*`). */
export function hitFieldKey(field: HitField): MessageKey {
  return `search.f.${field}` as MessageKey;
}

/** Splits `text` into plain and matched runs for the query's words, case-insensitive. */
export function highlight(text: string, query: string): { text: string; hit: boolean }[] {
  const clean = noDots(text);
  const words = [...new Set(query.trim().split(/\s+/).filter((w) => w.length > 0))].map((w) => w.toLowerCase());
  if (words.length === 0) return [{ text: clean, hit: false }];
  const lower = clean.toLowerCase();
  const marks: boolean[] = new Array(clean.length).fill(false);
  for (const w of words) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(w, from);
      if (at < 0) break;
      for (let i = at; i < at + w.length; i++) marks[i] = true;
      from = at + w.length;
    }
  }
  const out: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < clean.length; i++) {
    const last = out[out.length - 1];
    if (last && last.hit === marks[i]) last.text += clean[i];
    else out.push({ text: clean[i]!, hit: marks[i]! });
  }
  return out;
}

/** Cuts a long hit text around its first match, so the snippet shows it. */
export function snippet(text: string, query: string, max = 140): string {
  const clean = noDots(text);
  if (clean.length <= max) return clean;
  const lower = clean.toLowerCase();
  const first = query
    .trim()
    .split(/\s+/)
    .map((w) => lower.indexOf(w.toLowerCase()))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];
  const start = first === undefined ? 0 : Math.max(0, Math.min(first - Math.floor(max / 3), clean.length - max));
  return `${start > 0 ? '…' : ''}${clean.slice(start, start + max)}${start + max < clean.length ? '…' : ''}`;
}
