import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DOT_CHARS } from '@meetless/core';
import { TOKEN_NAMES } from '../src/renderer/styles/token-names';
import { GEOMETRY_STYLE_KEYS } from './support/guards';

/**
 * Guards the design-token layer (contract §8). Every stylesheet under src/renderer and every
 * .tsx style prop is checked; tokens.css is the only place a raw value may appear.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/renderer');

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'assets') walk(p, ext, out);
    } else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

interface Rule {
  file: string;
  selector: string;
  decls: [string, string][];
  media: string | null;
}

type Item = { decl: string } | { head: string; body: string };

/**
 * Splits a block's content at its top level into declarations (`k: v;`) and nested blocks
 * (`head { body }`). Quotes, parentheses and nested braces are respected, so `content: "{"`,
 * `url(a;b)` and nested rules do not break it, and a statement such as `@layer a, b;` never
 * leaks into the next rule's selector.
 */
function items(src: string): Item[] {
  const out: Item[] = [];
  let buf = '';
  let paren = 0;
  let quote: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quote) {
      buf += ch;
      if (ch === '\\') buf += src[++i] ?? '';
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') paren++;
    else if (ch === ')') paren--;
    else if (paren === 0 && ch === ';') {
      if (buf.trim()) out.push({ decl: buf.trim() });
      buf = '';
      continue;
    } else if (paren === 0 && ch === '{') {
      let depth = 1;
      let j = i + 1;
      let q: string | null = null;
      for (; j < src.length && depth > 0; j++) {
        const c = src[j]!;
        if (q) {
          if (c === '\\') j++;
          else if (c === q) q = null;
        } else if (c === '"' || c === "'") q = c;
        else if (c === '{') depth++;
        else if (c === '}') depth--;
      }
      out.push({ head: buf.trim(), body: src.slice(i + 1, j - 1) });
      buf = '';
      i = j - 1;
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push({ decl: buf.trim() });
  return out;
}

/** Splits at top-level `sep` characters, outside quotes, parentheses and brackets. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && ch === sep) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseDecls(body: string): [string, string][] {
  return items(body).flatMap((it) => {
    if (!('decl' in it)) return [];
    const k = it.decl.indexOf(':');
    return k > 0 ? [[it.decl.slice(0, k).trim().toLowerCase(), it.decl.slice(k + 1).trim()] as [string, string]] : [];
  });
}

/** Resolves a nested selector list against its parents: `&` is replaced, otherwise the parent is an ancestor. */
function resolveSelectors(head: string, parents: string[] | null): string[] {
  const own = splitTop(head, ',').map((s) => s.trim()).filter(Boolean);
  if (!parents) return own;
  return parents.flatMap((p) => own.map((s) => (s.includes('&') ? s.replace(/&/g, p) : `${p} ${s}`)));
}

/** Conditional group rules: their rules are recorded with the condition as `media`. */
const CONDITIONAL_AT = /^@(media|supports|container)\b/;
/** Group rules that do not change when a rule applies; the parser simply recurses into them. */
const TRANSPARENT_AT = /^@(layer|scope|starting-style|document|-moz-document)\b/;
const KEYFRAMES_AT = /^@(-webkit-)?keyframes\b/;

/**
 * Parses a stylesheet into flat rules. It recurses into `@media`, `@supports`, `@container`,
 * `@layer`, `@scope`, `@starting-style` and CSS nesting (`.a { &:hover { … } .b { … } }`), so
 * every rule is checked wherever it sits. A nested selector is resolved against its parent
 * (`.a .b`, `.a:hover`). `media` is the innermost `@media`, `@supports` or `@container` condition.
 */
function parseCss(css: string, file: string): Rule[] {
  const out: Rule[] = [];
  const walkBlock = (src: string, parent: { selector: string; list: string[] } | null, media: string | null) => {
    const all = items(src);
    if (parent) {
      const decls = parseDecls(all.flatMap((it) => ('decl' in it ? [it.decl] : [])).join(';'));
      if (decls.length > 0 || all.every((it) => 'decl' in it)) out.push({ file, selector: parent.selector, decls, media });
    }
    for (const it of all) {
      if ('decl' in it) continue;
      const h = it.head;
      if (CONDITIONAL_AT.test(h)) walkBlock(it.body, parent, h);
      else if (TRANSPARENT_AT.test(h)) walkBlock(it.body, parent, media);
      else if (KEYFRAMES_AT.test(h)) {
        for (const f of items(it.body)) if ('head' in f) out.push({ file, selector: `${h} ${f.head}`, decls: parseDecls(f.body), media });
      } else if (h.startsWith('@')) out.push({ file, selector: h, decls: parseDecls(it.body), media });
      else {
        const list = resolveSelectors(h, parent?.list ?? null);
        walkBlock(it.body, { selector: parent ? list.join(', ') : h, list }, media);
      }
    }
  };
  walkBlock(css.replace(/\/\*[\s\S]*?\*\//g, ''), null, null);
  return out;
}

const rel = (p: string) => relative(ROOT, p);
const CSS_FILES = walk(ROOT, '.css');
const TSX_FILES = walk(ROOT, '.tsx');
const SOURCES = new Map(CSS_FILES.map((f) => [rel(f), readFileSync(f, 'utf8')]));
const RULES = CSS_FILES.flatMap((f) => parseCss(SOURCES.get(rel(f))!, rel(f)));
const TOKENS_FILE = 'styles/tokens.css';
const FONTS_FILE = 'styles/fonts.css';
const OUTSIDE = RULES.filter((r) => r.file !== TOKENS_FILE);
const STYLE_RULES = OUTSIDE.filter((r) => r.selector !== '@font-face');
const decls = (rules: Rule[]) => rules.flatMap((r) => r.decls.map(([k, v]) => ({ rule: r, k, v })));

function definedTokens(file: string): string[] {
  return RULES.filter((r) => r.file === file).flatMap((r) => r.decls.filter(([k]) => k.startsWith('--')).map(([k]) => k));
}

/** Splits a value into top-level terms (whitespace and commas), keeping function calls whole. */
function terms(v: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of v) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && (ch === ' ' || ch === ',' || ch === '/')) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const NAMED_COLOURS =
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(
    ' ',
  );
const NAMED_RE = new RegExp(`(^|[\\s,(])(${NAMED_COLOURS.join('|')})(?=$|[\\s,)])`, 'i');
const RAW_COLOUR_RE = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|light-dark)\(/i;
/**
 * CSS system colours (current and deprecated) and Chromium's -webkit- colour keywords. They are
 * raw colours too: they follow the OS theme, not the tokens. `currentColor` stays allowed.
 */
const SYSTEM_COLOURS =
  'AccentColor AccentColorText ActiveText ButtonBorder ButtonFace ButtonText Canvas CanvasText Field FieldText GrayText Highlight HighlightText LinkText Mark MarkText SelectedItem SelectedItemText VisitedText ActiveBorder ActiveCaption AppWorkspace Background ButtonHighlight ButtonShadow CaptionText InactiveBorder InactiveCaption InactiveCaptionText InfoBackground InfoText Menu MenuText Scrollbar ThreeDDarkShadow ThreeDFace ThreeDHighlight ThreeDLightShadow ThreeDShadow Window WindowFrame WindowText -webkit-focus-ring-color -webkit-link -webkit-activelink -webkit-text'.split(
    ' ',
  );
const SYSTEM_RE = new RegExp(`(^|[\\s,(])(${SYSTEM_COLOURS.join('|')})(?=$|[\\s,)])`, 'i');
/** Properties whose values name properties, animations, areas or counters; a word like `background` there is not a colour. */
const IDENT_PROPS = /^(transition(-property)?|will-change|animation(-name)?|grid(-area|-template-areas|-row|-column)?(-start|-end)?|counter-(reset|increment|set)|content|view-transition-name|container(-name)?|anchor-name|position-anchor)$/;

/** color-mix() is allowed only when every colour argument is a token. */
function badColorMix(v: string): string | null {
  const re = /color-mix\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(v))) {
    let depth = 1;
    let j = m.index + m[0].length;
    while (j < v.length && depth > 0) {
      if (v[j] === '(') depth++;
      else if (v[j] === ')') depth--;
      j++;
    }
    const inner = v.slice(m.index + m[0].length, j - 1);
    const parts = inner.split(/,(?![^(]*\))/).map((s) => s.trim());
    if (!/^in [a-z-]+$/.test(parts[0] ?? '')) return `color-mix(${inner})`;
    for (const p of parts.slice(1)) if (!/^var\(--[a-z0-9-]+\)(\s+\d+(\.\d+)?%)?$/.test(p)) return `color-mix(${inner})`;
  }
  return null;
}
const stripColorMix = (v: string) => v.replace(/color-mix\((?:[^()]|\([^()]*\))*\)/g, 'var(--mixed)');

function rawColourIn(v: string, k = ''): string | null {
  const cm = badColorMix(v);
  if (cm) return cm;
  const s = stripColorMix(v).replace(/"[^"]*"|'[^']*'/g, '');
  const m = RAW_COLOUR_RE.exec(s) ?? NAMED_RE.exec(s) ?? (IDENT_PROPS.test(k) ? null : SYSTEM_RE.exec(s));
  return m ? m[0].replace(/^[\s,(]/, '').trim() : null;
}

const SHADOW_TOKEN = /^var\(--shadow-(sm|md|lg)\)$/;
/** box-shadow (and its prefixed forms) is `none` or a list of shadow tokens. */
const shadowOk = (v: string) => v === 'none' || splitTop(v, ',').every((p) => SHADOW_TOKEN.test(p.trim()));
/** A filter's drop-shadow() takes only a shadow token. */
function badDropShadow(v: string): string | null {
  for (const m of v.matchAll(/drop-shadow\(((?:[^()]|\([^()]*\))*)\)/gi)) if (!SHADOW_TOKEN.test(m[1]!.trim())) return m[0];
  return null;
}
const SHADOW_PROPS = /^(-(webkit|moz)-)?box-shadow$/;
const FILTER_PROPS = /^(-webkit-)?(backdrop-)?filter$/;

/** Raw colours, font families and shadows outside tokens.css. */
function rawValueViolations(rules: Rule[]): string[] {
  const bad: string[] = [];
  for (const { rule, k, v } of decls(rules)) {
    const where = `${rule.file} ${rule.selector} { ${k}: ${v} }`;
    const colour = rawColourIn(v, k);
    if (colour) bad.push(`${where}  [colour ${colour}]`);
    if (k === 'font-family' && !/^(var\(--font-(sans|mono)\)|inherit)$/.test(v)) bad.push(`${where}  [font-family]`);
    if (k === 'font' && v !== 'inherit') bad.push(`${where}  [font shorthand]`);
    if (SHADOW_PROPS.test(k) && !shadowOk(v)) bad.push(`${where}  [shadow]`);
    if (FILTER_PROPS.test(k) && badDropShadow(v)) bad.push(`${where}  [drop-shadow]`);
    if (k === 'text-shadow' && v !== 'none') bad.push(`${where}  [text-shadow]`);
  }
  return bad;
}

/** border* and outline* properties whose widths must come from --border-width. */
const BORDER_WIDTH_PROPS = /^(border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-width)?|outline(-width|-offset)?|column-rule(-width)?)$/;
/**
 * A border or outline term that sets a raw width: a length, a non-zero bare number, a keyword
 * width (`thin`, `medium`, `thick`), or a calc()/min()/max()/clamp() holding a raw length.
 */
const rawBorderTerm = (t: string) =>
  /^(thin|medium|thick)$/i.test(t) || /^-?[\d.]+[a-z%]+$/i.test(t) || /^-?[\d.]*[1-9][\d.]*$/.test(t) || (/^(calc|min|max|clamp)\(/i.test(t) && /\d(px|rem|em|pt|pc|cm|mm|in|q|ch|ex|vw|vh|vmin|vmax|%)/i.test(t));

/** font-size, font-weight, line-height, letter-spacing and spacing take the scale; border widths take --border-width. */
function scaleViolations(rules: Rule[]): string[] {
  const bad: string[] = [];
  for (const { rule, k, v } of decls(rules)) {
    const ts = terms(v.replace(/\s*!important$/, ''));
    const ok = (extra: (t: string) => boolean) => ts.every((t) => isVar(t) || isTokenCalc(t) || t === 'inherit' || extra(t));
    let fine = true;
    if (k === 'font-size') fine = ok(() => false);
    else if (k === 'font-weight') fine = ok(() => false);
    else if (k === 'line-height') fine = ok((t) => t === '1' || t === 'normal');
    else if (k === 'letter-spacing') fine = ok((t) => t === '0' || t === 'normal');
    else if (SCALE_PROPS.test(k)) fine = ok((t) => t === '0' || t === 'auto' || /^-?\d+(\.\d+)?(%|vh|vw)$/.test(t));
    else if (BORDER_WIDTH_PROPS.test(k)) fine = !ts.some(rawBorderTerm);
    if (!fine) bad.push(`${rule.file} ${rule.selector} { ${k}: ${v} }`);
  }
  return bad;
}

const isVar = (t: string) => /^var\(--[a-z0-9-]+\)$/.test(t);
/** calc() of tokens and unitless numbers only. */
const isTokenCalc = (t: string) => /^calc\(/.test(t) && !/\d(px|rem|em|pt)\b/.test(t) && /var\(--/.test(t);
const SCALE_PROPS = /^(padding|margin)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$|^(row-|column-)?gap$/;

describe('design tokens', () => {
  it('TOKEN_NAMES has no duplicates', () => {
    expect(new Set(TOKEN_NAMES).size).toBe(TOKEN_NAMES.length);
  });

  it('tokens.css defines exactly TOKEN_NAMES and nothing else', () => {
    expect(definedTokens(TOKENS_FILE).sort()).toEqual([...TOKEN_NAMES].sort());
    const rules = RULES.filter((r) => r.file === TOKENS_FILE);
    expect(rules.map((r) => r.selector)).toEqual([':root']);
    expect(rules.every((r) => r.decls.every(([k, v]) => k.startsWith('--') && v.length > 0))).toBe(true);
  });

  it('no stylesheet outside tokens.css declares a custom property', () => {
    const bad = decls(OUTSIDE).filter(({ k }) => k.startsWith('--'));
    expect(bad.map(({ rule, k }) => `${rule.file} ${rule.selector} ${k}`)).toEqual([]);
  });

  it('every var(--x) used in any stylesheet or .tsx file is a defined token', () => {
    const known = new Set<string>(TOKEN_NAMES);
    const bad: string[] = [];
    for (const [file, src] of [...SOURCES, ...TSX_FILES.map((f) => [rel(f), readFileSync(f, 'utf8')] as const)]) {
      for (const m of src.matchAll(/var\((--[a-zA-Z0-9-]+)/g)) if (!known.has(m[1]!)) bad.push(`${file}: ${m[1]}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('raw values stay in tokens.css', () => {
  it('outside tokens.css no stylesheet has a raw colour, font family or shadow value', () => {
    expect(rawValueViolations(STYLE_RULES)).toEqual([]);
  });

  it('the raw-value guard catches system colours, prefixed and filter shadows, and rules inside nesting, @layer and @container', () => {
    const probes: [string, string][] = [
      ['.x{color:Canvas}', 'colour Canvas'],
      ['.x{background:CanvasText}', 'colour CanvasText'],
      ['.x{border-color:ButtonFace}', 'colour ButtonFace'],
      ['.x{outline-color:Highlight}', 'colour Highlight'],
      ['.x{background:linear-gradient(GrayText, var(--color-bg))}', 'colour GrayText'],
      ['.x{outline:var(--border-width) solid -webkit-focus-ring-color}', 'colour -webkit-focus-ring-color'],
      ['.x{color:light-dark(var(--color-text), var(--color-bg))}', 'colour light-dark('],
      ['.x{-webkit-box-shadow:0 1px 2px var(--color-text)}', 'shadow'],
      ['.x{-moz-box-shadow:var(--shadow-sm), 0 0 1px var(--color-text)}', 'shadow'],
      ['.x{filter:drop-shadow(0 1px 2px var(--color-text))}', 'drop-shadow'],
      ['.x{-webkit-filter:drop-shadow(var(--shadow-sm)) drop-shadow(0 0 2px var(--color-text))}', 'drop-shadow'],
      ['.x{backdrop-filter:drop-shadow(0 0 1px var(--color-text))}', 'drop-shadow'],
      // Rules inside nesting and group rules are checked too.
      ['.a{&:hover{color:#fff}}', '.a:hover { color: #fff }'],
      ['.a{.b{background:red}}', '.a .b { background: red }'],
      ['.a{@media (min-width: 1px){color:Canvas}}', '.a { color: Canvas }'],
      ['@layer base{.x{color:rgb(0 0 0)}}', '.x { color: rgb(0 0 0) }'],
      ['@layer base, ui; .x{color:red}', 'probe.css .x { color: red }'],
      ['@container side (min-width: 1px){.x{box-shadow:0 0 1px var(--color-text)}}', '[shadow]'],
      ['@supports (display:grid){@layer ui{.a{&.b{text-shadow:0 0 1px var(--color-text)}}}}', '.a.b { text-shadow'],
      ['@keyframes k{from{color:#000}to{color:var(--color-text)}}', '@keyframes k from { color: #000 }'],
    ];
    for (const [css, why] of probes) expect(rawValueViolations(probe(css)).join('\n'), css).toContain(why);
    // Allowed: currentColor and transparent, property names in transition, the word inside a string, shadow tokens, other filters.
    expect(
      rawValueViolations(
        probe(
          '.x{color:currentColor;background:transparent;transition:background var(--duration-fast) var(--ease-standard),color var(--duration-fast) var(--ease-standard)} .y::before{content:"Canvas Menu"} .z{-webkit-box-shadow:none;box-shadow:var(--shadow-sm), var(--shadow-md);filter:drop-shadow(var(--shadow-sm)) grayscale(1)} .a{&:hover{background:var(--color-hover)}}',
        ),
      ),
    ).toEqual([]);
    // Nested selectors resolve against their parents, and a statement never leaks into the next selector.
    expect(probe('.a, .b{&:hover, .c &{color:var(--color-text)} .d{color:var(--color-text)}}').map((r) => r.selector)).toEqual(['.a:hover, .c .a, .b:hover, .c .b', '.a .d, .b .d']);
    expect(probe('@layer a, b; @import url(x.css); .x{color:var(--color-text)}').map((r) => r.selector)).toEqual(['.x']);
    expect(probe('@media (min-width: 1px){@layer ui{.x{color:var(--color-text)}}}')[0]!.media).toBe('@media (min-width: 1px)');
  });

  it('radii are tokens', () => {
    const bad = decls(STYLE_RULES)
      .filter(({ k }) => /^border(-[a-z]+)*-radius$/.test(k))
      .filter(({ v }) => !terms(v).every((t) => t === '0' || /^var\(--radius-(sm|md|lg|xl|full)\)$/.test(t)));
    expect(bad.map(({ rule, k, v }) => `${rule.file} ${rule.selector} { ${k}: ${v} }`)).toEqual([]);
  });

  it('type and spacing use the scale; border and outline widths use --border-width', () => {
    expect(scaleViolations(STYLE_RULES)).toEqual([]);
  });

  it('the border-width guard catches keyword widths and raw lengths inside calc()', () => {
    for (const css of [
      '.x{border:thin solid var(--color-border)}',
      '.x{border-width:medium}',
      '.x{outline:thick solid var(--color-focus)}',
      '.x{border:calc(2px) solid var(--color-border)}',
      '.x{border-top:calc(var(--border-width) + 1px) solid var(--color-border)}',
      '.x{border-left-width:max(1px, var(--border-width))}',
      '.x{border-inline-start:2px solid var(--color-border)}',
      '.x{outline-offset:2px}',
      '.x{column-rule:1px solid var(--color-border)}',
      '.a{&:focus{outline:2px solid var(--color-focus)}}',
    ])
      expect(scaleViolations(probe(css)), css).not.toEqual([]);
    expect(
      scaleViolations(
        probe(
          '.x{border:var(--border);outline:none} .y{border:calc(var(--border-width) * 1.5) solid var(--color-text)} .z{border:0;border-left:var(--border-width) dashed var(--color-border-strong);outline-offset:calc(var(--border-width) * 2)}',
        ),
      ),
    ).toEqual([]);
  });
});

// ---------- Dot and violet guards: pure checkers, run on the real stylesheets and on probes ----------

const MARKER_CHARS = [...DOT_CHARS, '■', '□', '▪', '▫', '◼', '◻', '◾', '◽', '⬛', '⬜', '○', '◯', '◉', '◎'];
const TOKEN_VALUES = new Map(RULES.filter((r) => r.file === TOKENS_FILE).flatMap((r) => r.decls));
const isPseudo = (sel: string) => /::?(before|after|marker)\b/.test(sel);
const selectorsOf = (r: Rule) => splitTop(r.selector, ',').map((s) => s.trim());
const FUNCTIONAL_PSEUDO = /:(not|is|where|has)\((?:[^()]|\([^()]*\))*\)/g;
interface Compound {
  classes: string[];
  /** The compound used :not(), :is(), :where() or :has(); its classes cannot grant an exemption. */
  functional: boolean;
  /** The combinator to the next compound on the right ('' for descendant), null for the subject. */
  next: string | null;
}
/**
 * Splits a selector into compound selectors, left to right. Classes inside functional
 * pseudo-classes are not collected. For example, `.side .av:hover` gives [side] and [av].
 */
function compounds(sel: string): Compound[] {
  const parts = sel.trim().split(/(\s*[>+~]\s*|\s+)/);
  const out: Compound[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const raw = parts[i]!;
    const stripped = raw.replace(FUNCTIONAL_PSEUDO, '');
    const next = i + 1 < parts.length ? parts[i + 1]!.trim() : null;
    out.push({ classes: [...stripped.matchAll(/\.([\w-]+)/g)].map((m) => m[1]!), functional: stripped !== raw, next });
  }
  return out;
}
/**
 * The compounds that may grant an exemption: the subject and its ancestors, walking left only
 * through descendant and child combinators. A + or ~ sibling stops the walk.
 */
function subjectChain(sel: string): Compound[] {
  const cs = compounds(sel);
  const chain: Compound[] = [];
  for (let i = cs.length - 1; i >= 0; i--) {
    if (i < cs.length - 1 && !['', '>'].includes(cs[i]!.next ?? '')) break;
    if (!cs[i]!.functional) chain.push(cs[i]!);
  }
  return chain;
}
const hasAll = (classes: string[], need: string[]) => need.every((c) => classes.includes(c));

/** Resolves a length to px (plain px, a px token, or a calc() of those); null when not a fixed length. */
function toPx(v: string): number | null {
  let s = v.trim();
  for (let i = 0; i < 5 && /var\(--/.test(s); i++) s = s.replace(/var\((--[\w-]+)\)/g, (_, n: string) => TOKEN_VALUES.get(n) ?? 'NaN');
  s = s.replace(/calc/g, '').replace(/px/g, '');
  if (!/^[\d.\s+\-*/()]+$/.test(s)) return null;
  const n = Number(Function(`"use strict";return (${s})`)());
  return Number.isFinite(n) ? n : null;
}

/** Selectors allowed to use --radius-full (contract §8): avatars, pills, count badges and tags. */
const RADIUS_FULL_OK = ['av', 'pill', 'nav-n', 'count', 'lock', 'capl'];

/** The largest box, in px on both sides, that counts as a dot or square marker when it is drawn. */
const DOT_MAX = 10;
const NOT_DRAWN = /^(none|transparent|0|0px|hidden|initial|unset|inherit)$/i;
/** Sides only, so a zero-width box with one of these is a hairline rule, not a dot. */
const SIDE_BORDER = /^border-(top|right|bottom|left|block|inline)(-(start|end))?(-width)?$/;
/** A round corner: the --radius-full token, 50% or more, or a pill-sized px radius. */
const isRound = (v: string) => terms(v.replace(/\s*!important$/, '')).some((t) => t === 'var(--radius-full)' || /^(50|100)%$/.test(t) || /^\d{3,}(\.\d+)?px$/.test(t));

/** How a box is drawn: by a fill, a border, a shadow or an outline. Null when it is not drawn at all. */
function paintOf(d: Map<string, string>): { how: 'filled' | 'bordered' | 'shadowed' | 'outlined'; sidesOnly: boolean } | null {
  for (const k of ['background', 'background-color', 'background-image']) {
    const v = d.get(k);
    if (v && !NOT_DRAWN.test(v) && !/^(none|transparent)(\s|$)/.test(v)) return { how: 'filled', sidesOnly: false };
  }
  for (const [k, v] of d) if ((SHADOW_PROPS.test(k) && v !== 'none') || (FILTER_PROPS.test(k) && /drop-shadow\(/.test(v))) return { how: 'shadowed', sidesOnly: false };
  for (const [k, v] of d) if (/^outline(-width)?$/.test(k) && !NOT_DRAWN.test(v) && !/^none\b/.test(v)) return { how: 'outlined', sidesOnly: false };
  const borders = [...d].filter(([k, v]) => BORDER_WIDTH_PROPS.test(k) && k.startsWith('border') && !NOT_DRAWN.test(v) && !/\b(none|hidden|transparent)\b/.test(v));
  if (borders.length > 0) return { how: 'bordered', sidesOnly: borders.every(([k]) => SIDE_BORDER.test(k)) };
  return null;
}

/** A small drawn box: both sides DOT_MAX px or less (width or inline-size, height, block-size or aspect-ratio). */
function smallPaint(d: Map<string, string>): string | null {
  const len = (...ks: string[]) => {
    for (const k of ks) if (d.has(k)) return toPx(d.get(k)!);
    return null;
  };
  const w = len('width', 'inline-size');
  let h = len('height', 'block-size');
  const ratio = d.get('aspect-ratio');
  if (h === null && w !== null && ratio) {
    const [a, b = '1'] = ratio.split('/').map((s) => s.trim());
    if (Number(a) > 0 && Number(b) > 0) h = (w * Number(b)) / Number(a);
  }
  if (w === null || h === null || w > DOT_MAX || h > DOT_MAX) return null;
  const p = paintOf(d);
  if (!p) return null;
  if ((w === 0 || h === 0) && p.sidesOnly) return null; // a hairline: a zero-width box with one side border
  return p.how;
}

/**
 * Dot, circle and square markers (contract §8 "No dots"). Checked on every selector, not only
 * pseudo-elements: a box of DOT_MAX px or less in both sides that is drawn (fill, background-image,
 * border, box-shadow, drop-shadow or outline) is a marker. The check runs per rule and on the
 * merged declarations of each selector across rules, so `.d{width:6px;height:6px} .d{background:…}`
 * is caught. It cannot join two different classes on one element (`.size` + `.fill`); that is left
 * to review. A round corner (`--radius-full`, 50%, 100% or a 3-digit px radius) is allowed only on
 * the RADIUS_FULL_OK selectors, and never on a pseudo-element.
 */
function dotViolations(rules: Rule[]): string[] {
  const bad = new Set<string>();
  const merged = new Map<string, Map<string, string>>();
  for (const r of rules) {
    const where = `${r.file}: ${r.selector}`;
    const d = new Map(r.decls);
    const pseudo = isPseudo(r.selector);
    if (pseudo) {
      if (r.decls.some(([k, v]) => /^border(-[a-z-]+)?-radius$/.test(k) && isRound(v))) bad.add(`${where} [round pseudo-element]`);
      const content = d.get('content') ?? '';
      if (MARKER_CHARS.some((c) => content.includes(c))) bad.add(`${where} [marker content]`);
    }
    const small = smallPaint(d);
    if (small) bad.add(`${where} [small ${small} ${pseudo ? 'pseudo-element' : 'element'}]`);
    for (const sel of selectorsOf(r)) merged.set(`${r.file}: ${sel}`, new Map([...(merged.get(`${r.file}: ${sel}`) ?? []), ...r.decls]));
    for (const [k, v] of r.decls) {
      if (/^(-webkit-)?(clip-path|shape-outside|mask(-image)?)$/.test(k) && /\b(circle|ellipse)\(/.test(v)) bad.add(`${where} [${k} ${v}]`);
      if (/\bdotted\b/.test(v)) bad.add(`${where} [dotted]`);
      if (/^list-style(-type)?$/.test(k) && v !== 'none') bad.add(`${where} [list marker]`);
      if (/^border(-[a-z]+)*-radius$/.test(k) && isRound(v) && !pseudo) {
        const why = /var\(--radius-full\)/.test(v) ? '--radius-full outside the allowlist' : 'round radius outside the --radius-full allowlist';
        for (const sel of selectorsOf(r)) {
          const last = compounds(sel).at(-1);
          if (!last || last.functional || !last.classes.some((c) => RADIUS_FULL_OK.includes(c))) bad.add(`${r.file}: ${sel} [${why}]`);
        }
      }
    }
    if (/\.km\b|\.km-/.test(r.selector)) bad.add(`${where} [kind mark]`);
  }
  for (const [where, d] of merged) {
    const small = smallPaint(d);
    if (small && ![...bad].some((b) => b.startsWith(`${where} [small`))) bad.add(`${where} [small ${small} ${isPseudo(where) ? 'pseudo-element' : 'element'}]`);
  }
  return [...bad];
}

function markerCharsIn(src: string): string[] {
  return MARKER_CHARS.filter((c) => src.includes(c));
}

/**
 * Violet (--color-ai, --color-ai-bg) is allowed only where some compound selector carries one of
 * these exact class sets: AI and rule marks, agent suggestion chips, agent work rows, the agent
 * thread title, rule detection hits in documents, rule-filled field fixes, and the agent's question
 * in the activity stream. Classes are matched whole, so `.hotel` or `.fixed` do not pass. Only the
 * subject and its descendant or child ancestors count (not + or ~ siblings), and classes inside
 * :not(), :is(), :where() or :has() never do.
 */
const VIOLET_OK: string[][] = [
  ['tone-ai'],
  ['chip', 'hot'],
  ['sugg', 'hot'],
  ['card-ai', 'ask'],
  ['w-agent'],
  ['thread-h'],
  ['para', 'hit'],
  ['oo-b', 'hit'],
  ['oo-tag'],
  ['fix'],
  ['srow', 'asking'],
];

function violetViolations(rules: Rule[]): string[] {
  const bad: string[] = [];
  for (const r of rules) {
    if (!r.decls.some(([, v]) => /var\(--color-ai(-bg)?\)/.test(v))) continue;
    for (const sel of selectorsOf(r)) if (!subjectChain(sel).some((c) => VIOLET_OK.some((need) => hasAll(c.classes, need)))) bad.push(`${r.file}: ${sel}`);
  }
  return bad;
}

/** Hover shadows only appear with a fine pointer, like the other motion. */
const MOTION = '@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';
function hoverShadowViolations(rules: Rule[]): string[] {
  return rules
    .filter((r) => /:hover\b/.test(r.selector) && r.decls.some(([k, v]) => (SHADOW_PROPS.test(k) && v !== 'none') || (FILTER_PROPS.test(k) && /drop-shadow\(/.test(v))))
    .filter((r) => r.media !== MOTION && r.media !== '@media (hover: hover) and (pointer: fine)')
    .map((r) => `${r.file}: ${r.selector}`);
}

const MOVE_PROPS = /^(-webkit-)?transform$|^(translate|scale|rotate)$/;
const isZero = (t: string | undefined) => t === undefined || /^-?0(\.0+)?(px|%|rem|em)?$/.test(t.trim());
/**
 * A lift or a press: a vertical or depth translate, or a scale, through `transform` or the
 * `translate` and `scale` properties. A horizontal translate (`translateX(-50%)`, `translate: -50%`)
 * positions an element and a static rotate draws a shape (the timeline diamond); neither is motion.
 */
function liftOrPress(k: string, v: string): boolean {
  if (/^(-webkit-)?transform$/.test(k))
    return /\b(translateY|translateZ|translate3d|scale(X|Y|Z|3d)?)\(/i.test(v) || [...v.matchAll(/\btranslate\(([^()]*)\)/gi)].some((m) => !isZero(splitTop(m[1]!, ',')[1]));
  if (k === 'translate') return terms(v).slice(1).some((t) => !isZero(t));
  if (k === 'scale') return v !== 'none';
  return false;
}
/**
 * Motion (contract §8): lifts and presses sit under the MOTION query, and so does any transform,
 * translate, scale or rotate that a :hover, :active or :focus state sets. Outside it, a transform
 * may only position or draw. The disclosure chevron that turns on `details[open]`
 * (`.refuted[open] summary::before { transform: rotate(90deg) }`) is a state indicator, not a hover
 * or press motion, so it is allowed; under reduced motion the base rule limits transitions on every
 * element and pseudo-element to colours and opacity, so it snaps.
 */
/**
 * The only transforms allowed outside the MOTION query, exactly as contract §8 lists them: a
 * `transform` whose whole value is `value`, on any selector (`selectors` absent) or only on those.
 */
const STATIC_TRANSFORMS: { value: string; selectors?: string[] }[] = [
  { value: 'translateX(-50%)' },
  { value: 'rotate(45deg)', selectors: ['.ms-hard', '.ms-cadence'] },
  { value: 'rotate(90deg)', selectors: ['.refuted[open] summary::before'] },
];
function staticTransform(r: Rule, k: string, v: string): boolean {
  if (k !== 'transform' || /:(hover|active|focus(-visible|-within)?)\b/.test(r.selector)) return false;
  const x = STATIC_TRANSFORMS.find((t) => t.value === v.trim().replace(/\s+/g, ''));
  return !!x && (!x.selectors || selectorsOf(r).every((sel) => x.selectors!.includes(sel)));
}
function motionViolations(rules: Rule[]): string[] {
  const bad: string[] = [];
  for (const r of rules) {
    if (r.media === MOTION) continue;
    for (const [k, v] of r.decls) {
      if (!MOVE_PROPS.test(k) || v === 'none' || staticTransform(r, k, v)) continue;
      if (liftOrPress(k, v)) bad.push(`${r.file}: ${r.selector} { ${k}: ${v} } [lift or press outside the motion query]`);
      else if (/:(hover|active|focus(-visible|-within)?)\b/.test(r.selector)) bad.push(`${r.file}: ${r.selector} { ${k}: ${v} } [state transform outside the motion query]`);
      else bad.push(`${r.file}: ${r.selector} { ${k}: ${v} } [transform outside the motion query that contract §8 does not list]`);
    }
  }
  return bad;
}

const probe = (css: string) => parseCss(css, 'probe.css');

describe('no dots, no kind marks', () => {
  it('the stylesheets have no dot, circle, square marker or kind mark', () => {
    expect(dotViolations(STYLE_RULES)).toEqual([]);
    for (const [file, src] of SOURCES) {
      expect(/--dot\b|\.ai-dot\b|\.agent-dot\b|\.st\s+i\b|\.pill::?before/.test(src), file).toBe(false);
      expect(markerCharsIn(src), `${file} contains a dot or marker character`).toEqual([]);
    }
    const reset = RULES.filter((r) => r.file === 'styles/base.css' && /\bul\b/.test(r.selector) && /\bol\b/.test(r.selector));
    expect(reset.some((r) => r.decls.some(([k, v]) => k === 'list-style' && v === 'none'))).toBe(true);
  });

  it('renderer .ts and .tsx sources contain no dot, circle or square marker characters', () => {
    const bad = [...walk(ROOT, '.ts'), ...TSX_FILES].flatMap((f) => markerCharsIn(readFileSync(f, 'utf8')).map((c) => `${rel(f)}: ${c}`));
    expect(bad).toEqual([]);
  });

  it('each dot guard catches its probe', () => {
    const probes: [string, string][] = [
      ['.x::before{content:"";border-radius:50%}', 'round pseudo-element'],
      ['.x::after{content:"";border-radius:var(--radius-full)}', 'round pseudo-element'],
      ['.x::before{content:"·"}', 'marker content'],
      ['.x::before{content:"□ "}', 'marker content'],
      ['.x::before{content:"";width:6px;height:6px;background:var(--color-text)}', 'small filled pseudo-element'],
      ['.x::before{content:"";width:var(--space-2);height:calc(var(--space-1) * 2);background-color:var(--color-info)}', 'small filled pseudo-element'],
      ['.x{clip-path:circle(50%)}', 'clip-path'],
      ['.x{clip-path:ellipse(4px 4px)}', 'clip-path'],
      ['.x{-webkit-mask-image:circle(2px)}', 'mask-image'],
      ['.x{border:var(--border-width) dotted var(--color-border)}', 'dotted'],
      ['.x{list-style:disc}', 'list marker'],
      ['.dot{border-radius:var(--radius-full)}', '--radius-full outside the allowlist'],
      ['.card .status{border-radius:var(--radius-full)}', '--radius-full outside the allowlist'],
      ['.av-ring .marker{border-top-left-radius:var(--radius-full)}', '--radius-full outside the allowlist'],
      ['.km-ext{width:8px}', 'kind mark'],
      // Small pseudo-elements drawn by a border, a shadow, an outline or a background-image.
      ['.x::before{content:"";width:6px;height:6px;border:var(--border)}', 'small bordered pseudo-element'],
      ['.x::after{content:"";width:8px;height:8px;box-shadow:var(--shadow-sm)}', 'small shadowed pseudo-element'],
      ['.x::before{content:"";width:4px;height:4px;filter:drop-shadow(var(--shadow-sm))}', 'small shadowed pseudo-element'],
      ['.x::before{content:"";width:4px;height:4px;outline:var(--border-width) solid var(--color-text)}', 'small outlined pseudo-element'],
      ['.x::before{content:"";width:6px;height:6px;background-image:linear-gradient(var(--color-text), var(--color-text))}', 'small filled pseudo-element'],
      ['.x::after{content:"";width:6px;height:6px;border-top:var(--border);border-left:var(--border)}', 'small bordered pseudo-element'],
      // Small dots on real elements, in any form of sizing, and across rules of one selector.
      ['.dot{width:8px;height:8px;background:var(--color-success)}', 'small filled element'],
      ['.ring{width:var(--space-2);height:var(--space-2);border:var(--border-strong)}', 'small bordered element'],
      ['.glow{width:6px;aspect-ratio:1;box-shadow:var(--shadow-sm)}', 'small shadowed element'],
      ['.st-i{inline-size:6px;block-size:6px;outline:var(--border-width) solid var(--color-info)}', 'small outlined element'],
      ['.s{width:6px;height:6px} .s{background:var(--color-text)}', 'probe.css: .s [small filled element]'],
      ['.card{.st-i{width:6px;height:6px;background:var(--color-info)}}', 'probe.css: .card .st-i [small filled element]'],
      ['@layer ui{@container (min-width: 1px){.x{width:5px;height:5px;background:var(--color-text)}}}', 'small filled element'],
      // A round corner plus a border on a non-allowlisted selector is a ring dot, at any size.
      ['.ring{border-radius:50%;border:var(--border)}', 'round radius outside the --radius-full allowlist'],
      ['.ring{border-radius:999px;border:var(--border)}', 'round radius outside the --radius-full allowlist'],
      ['.st{&::before{content:"";border-radius:var(--radius-full);border:var(--border)}}', 'round pseudo-element'],
      ['@layer ui{.x::before{content:"";border-radius:var(--radius-full)}}', 'round pseudo-element'],
      ['.card{.status{border-radius:var(--radius-full);border:var(--border)}}', '--radius-full outside the allowlist'],
    ];
    for (const [css, why] of probes) expect(dotViolations(probe(css)).join('\n'), css).toContain(why);
    expect(markerCharsIn("const g = '□';")).toEqual(['□']);
    // Allowed shapes stay allowed: a pill, a nested avatar, the lineage bar, the tree connector,
    // a hairline tick, an allowlisted avatar with a border, an undrawn small hit box, a long bar.
    expect(
      dotViolations(
        probe(
          '.pill{border-radius:var(--radius-full)} .side .av{border-radius:var(--radius-full)} .lin-g::before{content:"";width:calc(var(--border-width) * 3);height:var(--space-4);background:var(--color-text)} .tree li::before{content:"";width:9px;height:18px;border-left:var(--border)}' +
            ' .tick{width:0;height:8px;border-left:var(--border)} .side{.av{border-radius:var(--radius-full);border:var(--border)}} .hit{width:8px;height:8px;border:0;background:none;outline:none} .bar{width:10px;height:22px;background:var(--color-text)} .tl-today{width:0;border-left:var(--border-width) solid var(--color-text)}',
        ),
      ),
    ).toEqual([]);
  });

  it('bars are not dots: .bar2 uses --radius-sm and its fill has a minimum width', () => {
    const rule = (sel: string) => RULES.find((r) => r.file === 'dash/dash.css' && r.selector === sel)!;
    expect(new Map(rule('.bar2').decls).get('border-radius')).toBe('var(--radius-sm)');
    const fill = new Map(rule('.bar2-f').decls);
    expect(fill.get('border-radius')).toBe('var(--radius-sm)');
    expect(toPx(fill.get('min-width') ?? '0')).toBeGreaterThanOrEqual(12);
  });
});

describe('violet is reserved for AI and rule output', () => {
  it('--color-ai and --color-ai-bg appear only in AI and rule classes', () => {
    expect(violetViolations(STYLE_RULES)).toEqual([]);
  });

  it('the violet guard catches its probes, and anchored classes cannot slip through', () => {
    for (const css of [
      '.hot{color:var(--color-ai)}',
      '.card.hot{background:var(--color-ai-bg)}',
      '.hoff.hot{color:var(--color-ai)}',
      '.hob.hot{background:var(--color-ai-bg)}',
      '.hotel{color:var(--color-ai)}',
      '.not-tone-ai{color:var(--color-ai)}',
      '.fixed{background:var(--color-ai-bg)}',
      '.para.on{background:var(--color-ai-bg)}',
      '.card-ai{color:var(--color-ai)}',
      '.st.tone-info, .tone-ai{color:var(--color-ai)}',
      '.tl-bar.on{outline-color:var(--color-ai)}',
      // An exemption may not be borrowed through a functional pseudo-class or a sibling combinator.
      '.chip:not(.x).hot{color:var(--color-ai)}',
      '.chip:not(.hot){color:var(--color-ai)}',
      '.sugg:is(.hot){color:var(--color-ai)}',
      '.card:has(.tone-ai){background:var(--color-ai-bg)}',
      '.x:where(.fix){background:var(--color-ai-bg)}',
      '.chip.hot + .foo{color:var(--color-ai)}',
      '.tone-ai ~ .foo{color:var(--color-ai)}',
      '.fix + .chip .label{color:var(--color-ai)}',
    ])
      expect(violetViolations(probe(css)), css).not.toEqual([]);
    expect(violetViolations(probe('.chip.hot:hover{border-color:var(--color-ai)} .x .sugg.hot{color:var(--color-ai)} .pill.tone-ai{background:var(--color-ai-bg)} .thread-h strong{color:var(--color-ai)} .fix > .chip{color:var(--color-ai)} .a + .b .w-agent{color:var(--color-ai)}'))).toEqual([]);
  });

  it('handoffs to you use the info tone, not violet', () => {
    const decl = (sel: string, k: string) => new Map(RULES.find((r) => r.file === 'needs/needs.css' && r.selector === sel)!.decls).get(k);
    expect(decl('.hoff.hot', 'color')).toBe('var(--color-info)');
    expect(decl('.hob.hot', 'background')).toBe('var(--color-info-bg)');
  });

  it('a selected paragraph is violet only while it is a detection hit', () => {
    const sel = RULES.filter((r) => /\.(para|oo-b)\b/.test(r.selector) && /\.on\b/.test(r.selector) && r.decls.some(([, v]) => /--color-ai/.test(v))).map((r) => r.selector);
    expect(sel.length).toBeGreaterThan(0);
    for (const s of sel) expect(s).toMatch(/\.(para|oo-b)\.hit\.on/);
  });
});

describe('hover shadows', () => {
  it('hover shadows appear only with a fine pointer', () => {
    expect(hoverShadowViolations(STYLE_RULES)).toEqual([]);
    expect(hoverShadowViolations(probe('.card:hover{box-shadow:var(--shadow-sm)}'))).toEqual(['probe.css: .card:hover']);
    expect(hoverShadowViolations(probe(`${MOTION}{.card:hover{box-shadow:var(--shadow-sm)}}`))).toEqual([]);
    expect(hoverShadowViolations(probe('.card:hover{-webkit-box-shadow:var(--shadow-sm)}'))).toEqual(['probe.css: .card:hover']);
    expect(hoverShadowViolations(probe('.card{&:hover{filter:drop-shadow(var(--shadow-sm))}}'))).toEqual(['probe.css: .card:hover']);
    expect(hoverShadowViolations(probe(`@layer ui{${MOTION}{.card{&:hover{box-shadow:var(--shadow-sm)}}}}`))).toEqual([]);
  });
});

describe('fonts are bundled offline', () => {
  it('no stylesheet loads anything from the network', () => {
    for (const [file, src] of SOURCES) expect(/https?:\/\/|\/\/fonts\.|@import\s+url\(\s*['"]?http/.test(src), file).toBe(false);
  });

  it('@font-face lives only in fonts.css, and every src is a relative url to a committed file', () => {
    expect(OUTSIDE.filter((r) => r.selector === '@font-face' && r.file !== FONTS_FILE).map((r) => r.file)).toEqual([]);
    const faces = RULES.filter((r) => r.file === FONTS_FILE);
    expect(faces.length).toBeGreaterThan(3);
    expect(faces.every((r) => r.selector === '@font-face')).toBe(true);
    const families = new Set(faces.map((r) => r.decls.find(([k]) => k === 'font-family')?.[1].replace(/["']/g, '')));
    expect([...families].sort()).toEqual(['Geist', 'Geist Mono', 'Noto Sans SC']);
    for (const r of faces) {
      const src = r.decls.find(([k]) => k === 'src')?.[1] ?? '';
      const urls = [...src.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]!);
      expect(urls.length, src).toBeGreaterThan(0);
      for (const u of urls) {
        expect(u.startsWith('../assets/fonts/'), u).toBe(true);
        expect(existsSync(resolve(ROOT, 'styles', u)), u).toBe(true);
      }
    }
    for (const lic of ['assets/fonts/geist/OFL.txt', 'assets/fonts/noto-sans-sc/LICENSE']) expect(existsSync(join(ROOT, lic)), lic).toBe(true);
  });

  it('the token font stacks start with the bundled families', () => {
    const v = (name: string) => RULES.find((r) => r.file === TOKENS_FILE)!.decls.find(([k]) => k === name)![1];
    expect(v('--font-sans').startsWith('"Geist"')).toBe(true);
    expect(v('--font-sans')).toContain('"Noto Sans SC"');
    expect(v('--font-mono').startsWith('"Geist Mono"')).toBe(true);
  });
});

describe('structure', () => {
  it('base, timeline and one stylesheet per block folder exist; the old stylesheets are gone', () => {
    for (const f of ['styles/base.css', 'styles/fonts.css', 'ui/timeline.css', ...['shell', 'chat', 'dash', 'setup', 'needs', 'collab', 'inputs', 'artifacts', 'stream', 'deliveries'].map((d) => `${d}/${d}.css`)])
      expect(SOURCES.has(f), f).toBe(true);
    expect(SOURCES.has('styles/prototype.css')).toBe(false);
    expect(SOURCES.has('styles/app.css')).toBe(false);
  });

  it('the base component classes of contract §8 are defined in base.css', () => {
    const sel = RULES.filter((r) => r.file === 'styles/base.css').map((r) => r.selector).join(',');
    for (const c of ['.app', '.app.with-drawer', '.main', '.scroll', '.page', '.board-v', '.withc', '.three', '.pane-l', '.pane-c', '.pane-r', '.btn', '.btn-primary', '.btn-sm', '.btn-ghost', '.chip', '.chip.on', '.chip.hot', '.seg', '.pill', '.st', '.av', '.av-sm', '.surface-card', '.inp', '.ta', '.mono-ta', '.scrim', '.modal', '.modal.wide', '.muted', '.faint', '.small', '.mono'])
      expect(new RegExp(`(^|[,\\s])${c.replace(/\./g, '\\.')}(?![\\w-])`).test(sel), c).toBe(true);
    for (const tone of ['neutral', 'info', 'success', 'warning', 'danger', 'ai', 'strong', 'muted']) expect(sel).toContain(`.tone-${tone}`);
    for (let n = 1; n <= 8; n++) expect(sel).toContain(`.av-${n}`);
  });

  it('motion: lifts and presses only with a fine pointer and no reduced-motion preference; reduced motion keeps only colour changes', () => {
    const transforms = STYLE_RULES.filter((r) => r.decls.some(([k, v]) => liftOrPress(k, v)));
    for (const f of ['styles/base.css', 'needs/needs.css', 'dash/dash.css']) expect(transforms.some((r) => r.file === f), f).toBe(true);
    expect(motionViolations(STYLE_RULES)).toEqual([]);
    const reduced = RULES.filter((r) => r.file === 'styles/base.css' && r.media === '@media (prefers-reduced-motion: reduce)');
    const snap = reduced.find((r) => r.decls.some(([k, v]) => k === 'transition-property' && /^color,background-color,border-color,opacity/.test(v)));
    expect(snap).toBeDefined();
    // It covers pseudo-elements, so the disclosure chevron's rotate snaps under reduced motion too.
    expect(selectorsOf(snap!)).toEqual(expect.arrayContaining(['*', '*::before', '*::after']));
  });

  it('the motion guard catches lifts and presses through translate:, scale:, nesting and state rotates', () => {
    for (const css of [
      '.x:hover{translate:0 -1px}',
      '.x:active{scale:.985}',
      '.x{transform:translate(0, -2px)}',
      '.x{transform:translate3d(0, 0, 0)}',
      '.x:hover{transform:rotate(90deg)}',
      '.x:active{rotate:5deg}',
      '.x:focus-visible{transform:translateX(2px)}',
      '.btn{&:hover{transform:translateY(-1px)}}',
      '@layer ui{.btn:hover{translate:0 -1px}}',
      '@media (hover: hover){.btn:hover{transform:scale(1.02)}}',
    ])
      expect(motionViolations(probe(css)), css).not.toEqual([]);
    expect(
      motionViolations(
        probe(
          `.tl-wk{transform:translateX(-50%)} .ms-hard{transform:rotate(45deg)} .ms-cadence{transform:rotate(45deg)} .refuted[open] summary::before{transform:rotate(90deg)} ${MOTION}{.btn{&:hover{transform:translateY(-1px)}} .x:active{scale:.985}} @layer ui{${MOTION}{.y:hover{translate:0 -1px}}}`,
        ),
      ),
    ).toEqual([]);
  });

  it('outside the motion query only the §8 exceptions transform: translateX(-50%), the milestone diamond, the refuted chevron', () => {
    for (const css of [
      '.c{translate:-50%}',
      '.m{translate:-50% 0}',
      '.x{transform:translateX(-40%)}',
      '.x{transform:translateX(-50%) rotate(1deg)}',
      '.ms{transform:rotate(45deg)}',
      '.ms-hard{transform:rotate(30deg)}',
      '.x::before{transform:rotate(90deg)}',
      '.refuted[open] summary::before{transform:rotate(45deg)}',
      '.refuted summary::before{transform:rotate(90deg)}',
      '.x{rotate:90deg}',
      '.x{scale:1}',
      '.tl-wk:hover{transform:translateX(-50%)}',
    ])
      expect(motionViolations(probe(css)), css).not.toEqual([]);
    // The guard's exceptions are exactly the ones contract §8 lists under Motion.
    const motion = readFileSync(resolve(ROOT, '../../../../docs/superpowers/plans/2026-11-24-v3-contract.md'), 'utf8')
      .split('\n')
      .filter((l) => /^- \*\*Motion:\*\*/.test(l) || /^  Two exceptions|^  Exceptions/.test(l))
      .join('\n');
    for (const x of STATIC_TRANSFORMS) {
      expect(motion, x.value).toContain(`transform: ${x.value}\``);
      for (const sel of x.selectors ?? []) expect(motion, sel).toContain(`\`${sel}\``);
    }
  });
});

/**
 * Splits JS source at top-level `sep`, outside strings, template literals (with their `${…}`),
 * parentheses, brackets and braces. Returns the parts and, for `{`, where the matching `}` is.
 */
function scanJs(src: string, start: number, sep: string | null): { parts: string[]; end: number } {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  let i = start;
  for (; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      let tdepth = 0;
      for (; j < src.length; j++) {
        const c = src[j]!;
        if (c === '\\') j++;
        else if (ch === '`' && c === '$' && src[j + 1] === '{') (tdepth++, j++);
        else if (ch === '`' && c === '}' && tdepth > 0) tdepth--;
        else if (c === ch && tdepth === 0) break;
      }
      cur += src.slice(i, j + 1);
      i = j;
      continue;
    }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && ch === sep) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return { parts, end: i };
}

/** A transform in a style prop is a string or template literal of translate and scale functions only. */
const TRANSFORM_LITERAL = /^(['"`])\s*((translate(X|Y|Z|3d)?|scale(X|Y|Z|3d)?)\([^()]*\)\s*)+\1$/;

/** Every `style` prop in a .tsx source that is not an object literal of GEOMETRY_STYLE_KEYS. */
function styleViolations(src: string, file: string): string[] {
  const bad: string[] = [];
  const allowed = new Set<string>(GEOMETRY_STYLE_KEYS);
  for (const m of src.matchAll(/\bstyle=\{/g)) {
    const at = m.index! + m[0].length;
    if (src[at] !== '{') {
      bad.push(`${file}: style is not an object literal`);
      continue;
    }
    for (const raw of scanJs(src, at + 1, ',').parts) {
      const entry = raw.trim();
      if (!entry) continue;
      if (entry.startsWith('...')) {
        bad.push(`${file}: spread ${entry} in a style prop`);
        continue;
      }
      const [keyRaw, ...rest] = scanJs(entry, 0, ':').parts;
      const key = keyRaw!.trim().replace(/^(['"])(.*)\1$/, '$2');
      const value = rest.join(':').trim();
      if (!allowed.has(key)) bad.push(`${file}: ${key} in a style prop`);
      else if (key === 'transform' && !TRANSFORM_LITERAL.test(value)) bad.push(`${file}: transform ${value || key} is not a literal translate or scale`);
    }
  }
  return bad;
}

describe('style props in .tsx', () => {
  it('every style prop in a renderer .tsx file is an object literal of geometry keys only', () => {
    expect(TSX_FILES.flatMap((f) => styleViolations(readFileSync(f, 'utf8'), rel(f)))).toEqual([]);
  });

  it('the style-prop guard rejects any key outside GEOMETRY_STYLE_KEYS and accepts geometry', () => {
    for (const src of [
      '<i style={{ opacity: 0.5 }} />',
      '<i style={{ left: 1, zIndex: 2 }} />',
      '<i style={{ cursor: "pointer" }} />',
      '<i style={{ "color": x }} />',
      '<i style={{ ["color"]: x }} />',
      '<i style={{ ...s, left: 0 }} />',
      '<i style={s} />',
      '<i style={on ? { left: 0 } : undefined} />',
      "<i style={{ transform: 'rotate(45deg)' }} />",
      '<i style={{ transform: t }} />',
      '<i style={{ transform: `translateX(${x}px) skewX(2deg)` }} />',
      '<i style={{ width: w, background: `var(--color-${t})` }} />',
    ])
      expect(styleViolations(src, 'probe.tsx'), src).not.toEqual([]);
    expect(
      styleViolations(
        '<i style={{ left: pct(x), width: `${w}%`, minWidth: 0 }} /><i style={{ left }} /><i style={{ gridColumn: "1 / 3", top: a ? 1 : 2, inset: 0, gap: 4 }} /><i style={{ transform: `translateX(${x}px) scale(1.02)`, flexBasis: f({ a: 1, b: 2 }) }} />',
        'probe.tsx',
      ),
    ).toEqual([]);
  });
});
