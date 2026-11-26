import type { ExtractInput } from './events';
import { clip, codesIn, overlap, tokenSet } from './text';
import type { Id, Need, Scene } from './types';

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

/** A leading "add this" word: 需要：, 新增, TODO:, add:, ... (bare 要 / 加 only with a colon). */
const ADD_LEAD = /^\s*(?:(?:需要|新增|添加|增加|加上|待办)\s*[:：]?|(?:todo|to-?do|add|needs?(?:\s+to)?)(?![a-z])\s*[:：]?|(?:要|加)\s*[:：])\s*/i;
/** An item marker inside a line: 1. 2、 3) （4） ①, not a decimal like 1.5. */
const ENUM = /(?:^|(?<=[\s；;，,：:。]))(?:[（(]\d{1,2}[)）]|\d{1,2}[.、)）](?!\d)|[①②③④⑤⑥⑦⑧⑨⑩])\s*/g;
const LIST_LINE = /^\s*(?:[-*+•]\s+|[（(]?\d{1,2}[.、)）](?!\d)|[①②③④⑤⑥⑦⑧⑨⑩])/;
const QUESTION_ZH = /(为什么|为何|怎么|怎样|如何|什么|哪|谁|是否|有没有|能不能|可不可以|要不要|是不是|多少|几个|吗|呢)/;
const QUESTION_EN = /^\s*(?:why|what|how|when|where|who|whom|whose|which|is|are|was|were|do|does|did|can|could|should|would|will|has|have|any)\b/i;

/** A question to the agent, by its shape: a question mark at the end, a Chinese question word, or a leading English one. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  return /[?？]\s*$/.test(t) || QUESTION_ZH.test(t) || QUESTION_EN.test(t);
}

/** The pieces of one line: split at item markers (two or more), else at ；/; when `split` (an add context). */
function splitLine(line: string, split: boolean): string[] {
  const marks = [...line.matchAll(ENUM)];
  let parts: string[];
  if (marks.length >= 2) {
    parts = [];
    const head = line.slice(0, marks[0]!.index).trim();
    // A heading before the list ("下周：") is not an item.
    if (head && !/[:：]$/.test(head)) parts.push(head);
    marks.forEach((m, i) => parts.push(line.slice(m.index + m[0].length, marks[i + 1]?.index ?? line.length)));
  } else if (split) {
    parts = line.split(/[；;]/);
  } else {
    parts = [line];
  }
  return parts.map((x) => x.replace(/^[\s,，、]+|[\s；;，,、。]+$/g, '').trim()).filter((x) => x.length > 0);
}

/**
 * Text someone gives the agent to add, not to ask about: a leading add word (需要：, TODO:, add:),
 * two or more numbered items, or several ；-separated parts. Never a question.
 */
export function looksLikeAdd(text: string): boolean {
  const t = text.trim();
  if (!t || /[?？]\s*$/.test(t)) return false;
  const lead = ADD_LEAD.exec(t)?.[0] ?? '';
  // An add word with a colon, or a numbered list, wins over a question word inside an item.
  if (/[:：]\s*$/.test(lead) || [...t.matchAll(ENUM)].length >= 2) return true;
  if (looksLikeQuestion(t)) return false;
  if (lead.trim()) return true;
  return t.split(/[；;]/).filter((x) => x.trim().length > 1).length >= 2;
}

/**
 * Paragraphs for an import, one per item: one per line as in `toParagraphs`, and a line that
 * enumerates (1. a 2. b, 1、a；2、b) one per item. `lead` holds the items that come under an add
 * word (需要：...), or every item when `addAll` (text the user gave the agent to add); the
 * detector proposes those as new needs even without a need word.
 */
export function toItems(text: string, idPrefix = 'p', opts: { addAll?: boolean } = {}): { paras: Paragraph[]; lead: Set<string> } {
  const paras: Paragraph[] = [];
  const lead = new Set<string>();
  let under = false;
  for (const raw of text.split(/\r?\n+/)) {
    let line = raw.trim();
    if (!line) continue;
    const m = ADD_LEAD.exec(line);
    const isList = LIST_LINE.test(line);
    if (m && /[:：]\s*$/.test(m[0])) {
      under = true;
      line = line.slice(m[0].length);
    } else if (!isList) {
      under = false;
    }
    line = line.replace(/^\s*(#{1,6}\s+|>\s*|[-*+•]\s+)/, '').trim();
    const addCtx = opts.addAll === true || under;
    const pieces = splitLine(line, addCtx);
    // A lone list line ("1. 做 slides") loses its marker, as `toParagraphs` drops "1. ".
    for (const piece of pieces.length === 1 ? [pieces[0]!.replace(/^\s*(?:[（(]?\d{1,2}[.、)）](?!\d)|[①②③④⑤⑥⑦⑧⑨⑩])\s*/, '')] : pieces) {
      if (!piece) continue;
      const id = `${idPrefix}${paras.length + 1}`;
      paras.push({ id, text: piece });
      if (addCtx) lead.add(id);
    }
  }
  return { paras, lead };
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
export function detectExtracts(paras: Paragraph[], needs: Need[], max = 8, lead: ReadonlySet<string> = new Set()): ExtractInput[] {
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
    if (NEED_WORDS.test(t) || lead.has(p.id)) {
      out.push({ id, type: 'new', text: clip(t, 160), paraId: p.id, accept: null });
      continue;
    }
    if (ACTION_WORDS.test(t)) out.push({ id, type: 'action', text: clip(t, 160), paraId: p.id });
  }
  return out;
}

/**
 * The scene of pasted or typed text: a chat (several 「张三：…」 lines, or chat timestamps), an email
 * (a From / 发件人 / Subject / 主题 header), otherwise `fallback` (the agent conversation, or a document).
 */
export function detectScene(text: string, fallback: Scene): Scene {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const mail = lines.slice(0, 12).filter((l) => /^(发件人|收件人|抄送|主题|发送时间|from|to|cc|subject|date|sent)\s*[:：]/i.test(l)).length;
  if (mail >= 2 || lines.slice(0, 12).some((l) => /^(主题|subject)\s*[:：]/i.test(l))) return 'mail';
  const speaker = lines.filter((l) => /^[^\s:：，。,.!?？！]{1,16}\s*[:：]\s*\S/.test(l) && !/^https?:/i.test(l)).length;
  const stamped = lines.filter((l) => /^(\[?\d{1,4}[-/.]\d{1,2}[-/.]\d{1,2}\s+)?\[?\d{1,2}:\d{2}(:\d{2})?\]?\s/.test(l) || /^\S{1,16}\s+\d{1,2}:\d{2}(:\d{2})?$/.test(l)).length;
  if (speaker >= 2 || stamped >= 2) return 'chat';
  return fallback;
}
