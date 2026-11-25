/*
 * Pure markup checks behind the page-level guards (contract §8). No test runner import, so the
 * vitest guards (guards.ts) and the Playwright e2e specs share them.
 */

const CODE = String.raw`(?<![\p{L}\p{N}_])(?:Np|Hp|N|H)\d+(?![\p{L}\p{N}])`;
const GLYPH = String.raw`[\p{So}\p{Sm}*#]`;
/** A class token that names a kind mark or marker: kind*, km / km-*, *marker*, mark / *-mark. */
const isMarkerClass = (cls: string) => cls.split(/\s+/).some((c) => /^kind/.test(c) || /^km(-|$)/.test(c) || /marker/.test(c) || /(^|-)mark$/.test(c));
/** A class token that names a badge-like element: badge, pill, tag, chip, label (alone or as a -part). */
const isBadgeClass = (cls: string) => cls.split(/\s+/).some((c) => /(^|-)(badge|pill|tag|chip|label)(-|$)/.test(c));
const TAG = /^<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>$/;

/**
 * The only keys a `style` prop may carry (contract §8): geometry. styles.test.ts checks the
 * renderer .tsx sources against it, and nonGeometryStyles checks rendered markup (kebab-case).
 * A `transform` may hold translate and scale functions only.
 */
export const GEOMETRY_STYLE_KEYS = ['left', 'top', 'right', 'bottom', 'inset', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'flexBasis', 'gridColumn', 'gridRow', 'gap', 'transform'] as const;
const GEOMETRY_CSS = new Set<string>(GEOMETRY_STYLE_KEYS.map((k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)));
const TRANSFORM_OK = /^\s*((translate(X|Y|Z|3d)?|scale(X|Y|Z|3d)?)\([^()]*\)\s*)+$/;

/** Words that name a need kind; right before a code, outside a heading, they are a kind badge. */
const KIND_WORDS = new Set(['需求', '假设', '假说', '外部']);
/** Elements whose text is a heading or a label for what follows, never a mark. */
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'th', 'label', 'legend', 'caption', 'dt']);

/**
 * A short, badge-like element right before a code:
 * - one character (even with a space after it);
 * - a short text (up to four characters) in a badge, pill, tag, chip or label class;
 * - with nothing between it and the code: two to four capital letters ("EXT"), the code's own
 *   letter prefix ("Np" before Np3), or a kind word ("假设") outside a heading.
 * Other two-character text stays allowed: a heading 「需求」, a label 「关联」 before a chip, a number
 * in a table cell. So does a label word followed by a space ("Owner N1") and a mixed-case name ("Lin").
 */
function isBadge(inner: string, spaced: boolean, cls: string, tag: string, code: string): boolean {
  if (/\s/.test(inner)) return false;
  const n = [...inner].length;
  if (n === 1) return true;
  if (isBadgeClass(cls) && n <= 4) return true;
  if (spaced) return false;
  if (/^[A-Z]{2,4}$/.test(inner)) return true;
  if (inner.toLowerCase() === /^\D+/.exec(code)![0].toLowerCase()) return true;
  return KIND_WORDS.has(inner) && !HEADING_TAGS.has(tag.toLowerCase());
}

/**
 * Anything that precedes a need code as a kind mark: a glyph, an empty or void element, a .kind /
 * .km / marker class, or a letter badge such as `<span>N</span>` or `<span>HYP</span>`.
 */
export function marksBeforeCodes(html: string): string[] {
  const bad: string[] = [];
  const text = html.replace(/<[^>]*>/g, ' ');
  for (const m of text.matchAll(new RegExp(`${GLYPH}\\s*${CODE}`, 'gu'))) bad.push(`glyph before a code: "${m[0]}"`);
  const toks = html.split(/(<[^>]+>)/).filter((t) => t !== '');
  const atStart = new RegExp(`^\\s*(${CODE})`, 'u');
  toks.forEach((tok, i) => {
    const code = tok.startsWith('<') ? null : atStart.exec(tok)?.[1];
    if (!code) return;
    let j = i - 1;
    // Skip the elements the code starts (its containers) and blank text.
    while (j >= 0 && ((/^<[a-zA-Z]/.test(toks[j]!) && !toks[j]!.endsWith('/>')) || toks[j]!.trim() === '')) j--;
    if (j < 0) return;
    const prev = toks[j]!;
    if (!prev.startsWith('<')) return; // text: the glyph check above covers it
    if (prev.endsWith('/>')) return void bad.push(`void element ${prev} before ${code}`);
    const name = TAG.exec(prev)![2]!;
    let depth = 0;
    let k = j;
    for (; k >= 0; k--) {
      const m = TAG.exec(toks[k]!);
      if (!m || m[4] === '/' || m[2] !== name) continue;
      if (m[1]) depth++;
      else if (--depth === 0) break;
    }
    const open = toks[k]!;
    const cls = /class="([^"]*)"/.exec(open)?.[1] ?? '';
    const texts = toks.slice(k + 1, j).filter((t) => !t.startsWith('<'));
    const inner = texts.join('').trim();
    // Is there any space between the element's text and the code?
    const spaced = /\s$/.test(texts.join('')) || toks.slice(j + 1, i).some((t) => !t.startsWith('<')) || /^\s/.test(tok);
    if (isMarkerClass(cls)) bad.push(`marker class "${cls}" before ${code}`);
    else if (inner === '') bad.push(`empty ${open} before ${code}`);
    else if (/^[^\p{L}\p{N}]{1,2}$/u.test(inner)) bad.push(`glyph element ${open}${inner} before ${code}`);
    else if (isBadge(inner, spaced, cls, name, code)) bad.push(`letter badge ${open}${inner} before ${code}`);
  });
  return bad;
}

/** Inline styles that carry anything but geometry (GEOMETRY_STYLE_KEYS), or a transform other than translate and scale. */
export function nonGeometryStyles(html: string): string[] {
  const bad: string[] = [];
  for (const m of html.matchAll(/\sstyle="([^"]*)"/g))
    for (const d of m[1]!.split(';').filter((x) => x.trim())) {
      const at = d.indexOf(':');
      const prop = d.slice(0, at).trim().toLowerCase();
      if (!GEOMETRY_CSS.has(prop) || (prop === 'transform' && !TRANSFORM_OK.test(d.slice(at + 1)))) bad.push(d.trim());
    }
  return bad;
}

/**
 * Avatar text that fits the 28px (and 20px) circle on one line: one CJK character, one or two
 * Latin letters or digits, or "?". `initials()` gives only these.
 */
export function avatarTextOk(text: string): boolean {
  return /^(?:[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\s]{1,2}|\?)$/u.test(text) && [...text].length <= 2;
}

/** The text of every avatar (`<span class="av …">`) in rendered markup that would not fit its circle. */
export function wrappingAvatars(html: string): string[] {
  const bad: string[] = [];
  for (const m of html.matchAll(/<span class="av(?: [^"]*)?"[^>]*>([^<]*)<\/span>/g)) if (!avatarTextOk(m[1]!)) bad.push(m[1]!);
  return bad;
}
