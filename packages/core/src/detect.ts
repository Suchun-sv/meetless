import type { ExtractInput } from './events';
import { clip, codesIn, overlap, tokenSet } from './text';
import type { Id, Need } from './types';

/**
 * Rule-based need detection (SIMULATED: no model is called). Every paragraph
 * of an input is checked against keyword rules; the user accepts or ignores
 * each proposal. Labelled "rule-based" in the UI.
 */
export const DETECTOR_ID = 'rules/1';

const NEED_WORDS = /(需要|要求|希望|应该|必须|建议|要|请|\bshould\b|\bneeds?\b|\bmust\b|\bwants?\b|\bplease\b|\brequires?\b|\brequired\b|has to|have to|\bsuggest|would like|\bexpect)/i;
const HYP_WORDS = /(假设|猜测|怀疑|可能|也许|或许|试试|试一下|估计|hypothes|\bsuspect|\bmight\b|\bmaybe\b|\bperhaps\b|could try|i think|\bprobably\b|\bguess)/i;
const CONTRAST = /(全部|所有|全量|不再|改为|改成|而不是|不要|取消|反而|只能|instead|rather than|\ball\b|\bevery\b|no longer|\bnot\b|don't|do not|cancel|replace)/i;
const REVISE_WORDS = /(增加|加上|补充|调整|扩展|再加|也要|另外|只比|只要|\badd\b|\balso\b|\bextend|\bupdate|\bchange|\badjust|\bonly\b)/i;
const ACTION_WORDS = /(截止|deadline|due|ddl|之前交|before)/i;

export interface Paragraph {
  id: string;
  text: string;
}

/** Splits text into paragraphs (one per non-empty line), stripping Markdown markers. */
export function toParagraphs(text: string, idPrefix = 'p'): Paragraph[] {
  return text
    .split(/\r?\n+/)
    .map((l) => l.replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '').trim())
    .filter((l) => l.length > 0)
    .map((t, i) => ({ id: `${idPrefix}${i + 1}`, text: t }));
}

function numbers(s: string): Set<string> {
  return new Set([...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]));
}

/** Most similar visible need of the same project (shared tokens >= 2 and >= 18% of the shorter text). */
function similarNeed(text: string, needs: Need[]): Need | null {
  const t = tokenSet(text);
  let best: { n: Need; score: number } | null = null;
  for (const n of needs) {
    const nt = tokenSet(`${n.title} ${n.accept ?? n.expect ?? ''}`);
    const shared = overlap(t, nt);
    const score = shared / Math.max(1, Math.min(t.size, nt.size));
    if (shared >= 2 && score >= 0.18 && (!best || score > best.score)) best = { n, score };
  }
  return best?.n ?? null;
}

/**
 * Matches free text (a commit message, a capture line) to a need: a named
 * code (N2, Hp1) wins; otherwise the same similarity rule as detection.
 */
export function matchNeed(text: string, needs: Need[]): { needId: Id; by: 'code' | 'keywords' } | null {
  for (const c of codesIn(text)) {
    const n = needs.find((x) => x.code === c);
    if (n) return { needId: n.id, by: 'code' };
  }
  const n = similarNeed(text, needs);
  return n ? { needId: n.id, by: 'keywords' } : null;
}

/**
 * Proposals for one input. `needs` are the needs the importer can see in the
 * project. A paragraph that names an existing need (N3) or closely matches one
 * and asks for a change becomes a revision; if it contradicts the need
 * ("all fields" vs "12 core fields") it is marked as a conflict.
 */
export function detectExtracts(paras: Paragraph[], needs: Need[], max = 8): ExtractInput[] {
  const out: ExtractInput[] = [];
  for (const p of paras) {
    if (out.length >= max) break;
    const t = p.text;
    const byCode = codesIn(t)
      .map((c) => needs.find((n) => n.code === c))
      .find((n): n is Need => !!n);
    const target = byCode ?? similarNeed(t, needs);
    const id = `x${out.length + 1}`;
    const contrast = CONTRAST.test(t);
    if (target && (byCode || contrast || REVISE_WORDS.test(t))) {
      const base = `${target.accept ?? target.expect ?? ''} ${target.title}`;
      const nums = numbers(t);
      const numClash = nums.size > 0 && [...numbers(base)].some((x) => !nums.has(x)) && ![...nums].some((x) => numbers(base).has(x));
      out.push({ id, type: 'rev', text: clip(t, 160), paraId: p.id, needId: target.id, conflict: contrast || numClash });
      continue;
    }
    if (HYP_WORDS.test(t)) {
      out.push({ id, type: 'hyp', text: clip(t, 160), paraId: p.id, expect: clip(t, 160), verify: null });
      continue;
    }
    if (NEED_WORDS.test(t)) {
      out.push({ id, type: 'new', text: clip(t, 160), paraId: p.id, accept: null });
      continue;
    }
    if (ACTION_WORDS.test(t)) out.push({ id, type: 'action', text: clip(t, 160), paraId: p.id });
  }
  return out;
}
