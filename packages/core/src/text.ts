/**
 * Text helpers shared by detection, search and the UI rule "no dot symbols".
 */

/** Characters the UI never shows: middle dots, bullets, dot operators, katakana middle dot, circles used as status dots. */
export const DOT_CHARS = ['·', '•', '∙', '⋅', '●', '・', '‧', '◦', '⦁', '⸱', '･'] as const;
export const DOT_RE = new RegExp(`[${DOT_CHARS.join('')}]`);
const DOT_SEP = new RegExp(`\\s*[${DOT_CHARS.join('')}]+\\s*`, 'g');

/** Replaces dot separators in user content with a space (the UI separates facts with spacing). */
export function noDots(s: string): string {
  return s.replace(DOT_SEP, ' ');
}

/** Separator between inline facts in the UI: an em space, never a dot. */
export const SEP = ' ';

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'be', 'it', 'this', 'that', 'with', 'by', 'as', 'at',
  'we', 'you', 'i', 'do', 'does', 'did', 'why', 'what', 'who', 'how', 'when', 'which', 'there', 'any', 'can', 'should', 'need', 'our',
  'has', 'have', 'had', 'not', 'from', 'about', 'only', 'try', 'tried',
]);
const CJK_STOP = new Set(['我们', '你们', '什么', '为什', '么只', '是谁', '谁提', '一下', '这个', '那个', '有没', '没有', '可以', '是不', '不是', '的话']);

/** Very small English stemmer: exports -> export, filtering -> filter, exported -> export. */
function stem(w: string): string {
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}

/**
 * Tokens for matching: lower-cased Latin words and numbers (stop words removed),
 * Chinese as character bigrams (single characters for one-character runs),
 * need codes (n4, h2) kept whole.
 */
export function tokens(s: string): string[] {
  const out: string[] = [];
  const lower = s.toLowerCase();
  for (const m of lower.matchAll(/[a-z0-9_][a-z0-9_.-]*/g)) {
    const w = stem(m[0].replace(/[.-]+$/, ''));
    if (w.length >= 2 && !STOP.has(w)) out.push(w);
    else if (/^\d$/.test(w)) out.push(w);
  }
  for (const m of s.matchAll(/\p{Script=Han}+/gu)) {
    const run = [...m[0]];
    if (run.length === 1) out.push(run[0]!);
    for (let i = 0; i + 1 < run.length; i++) {
      const bg = run[i]! + run[i + 1]!;
      if (!CJK_STOP.has(bg)) out.push(bg);
    }
  }
  return out;
}

export function tokenSet(s: string): Set<string> {
  return new Set(tokens(s));
}

/** Need codes mentioned in a text (N4, H2, Np1), upper-cased. */
export function codesIn(s: string): string[] {
  return [...s.matchAll(/(?<![A-Za-z0-9])([NHnh]p?\d+)(?![A-Za-z0-9])/g)].map((m) => {
    const c = m[1]!;
    return c[0]!.toUpperCase() + c.slice(1);
  });
}

export function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

/** Whole days from `today` to `date` (both YYYY-MM-DD, noon UTC to avoid DST effects). */
export function daysBetween(today: string, date: string): number {
  const ms = (d: string) => Date.parse(`${d.slice(0, 10)}T12:00:00Z`);
  return Math.round((ms(date) - ms(today)) / 86_400_000);
}

export function clip(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
