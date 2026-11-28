import { useMemo, type ReactNode } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text as RNText, View } from 'react-native';
import MarkdownIt from 'markdown-it';
import { colors, fontFor, fontSize, hasCjk, radius, space } from '@/theme';

/*
 * Markdown for agent replies (Claude Code and DeepSeek), on web, iOS and desktop: headings, bold,
 * italic, strike, lists (a short dash for bullets, never a dot), inline code, code blocks and tables
 * that scroll sideways, links (opened outside the app), quotes and rules. markdown-it parses; this
 * file draws with React Native primitives and the theme tokens. Raw HTML is not rendered.
 */

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
type Token = ReturnType<MarkdownIt['parse']>[number];

/**
 * Text that is still streaming: an unclosed ``` fence is closed for now so the rest of the reply is
 * not swallowed into a code block. A table without its separator row yet is not a table to
 * markdown-it, so it shows as plain lines until the separator arrives.
 */
export function closeOpenFences(text: string): string {
  const fences = text.match(/^\s*(```|~~~)/gm)?.length ?? 0;
  return fences % 2 === 1 ? `${text}\n\`\`\`` : text;
}

interface Node {
  type: string;
  tag: string;
  token: Token;
  children: Node[];
}

/** markdown-it's flat open/close tokens as a tree (block level; inline tokens keep their own children). */
function tree(tokens: Token[]): Node[] {
  const root: Node = { type: 'root', tag: '', token: tokens[0]!, children: [] };
  const stack: Node[] = [root];
  for (const tk of tokens) {
    const top = stack[stack.length - 1]!;
    if (tk.nesting === 1) {
      const n: Node = { type: tk.type.replace(/_open$/, ''), tag: tk.tag, token: tk, children: [] };
      top.children.push(n);
      stack.push(n);
    } else if (tk.nesting === -1) {
      stack.pop();
    } else {
      top.children.push({ type: tk.type, tag: tk.tag, token: tk, children: [] });
    }
  }
  return root.children;
}

function openLink(href: string) {
  if (!/^https?:\/\//i.test(href)) return;
  // Web and the desktop app: window.open, which the desktop shell hands to the system browser.
  if (Platform.OS === 'web') window.open(href, '_blank', 'noopener');
  else void Linking.openURL(href);
}

interface Style {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string;
}

/** Inline tokens (text, bold, italic, code, links, breaks) as nested Text runs. */
function inline(tokens: Token[], base: { size: number; color: string; bold?: boolean }): ReactNode[] {
  const out: ReactNode[] = [];
  const stack: Style[] = [{}];
  const cur = () => stack[stack.length - 1]!;
  const push = (s: Style) => stack.push({ ...cur(), ...s });
  tokens.forEach((tk, i) => {
    switch (tk.type) {
      case 'strong_open':
        return push({ bold: true });
      case 'em_open':
        return push({ italic: true });
      case 's_open':
        return push({ strike: true });
      case 'link_open':
        return push({ href: tk.attrGet('href') ?? undefined });
      case 'strong_close':
      case 'em_close':
      case 's_close':
      case 'link_close':
        stack.pop();
        return;
      case 'softbreak':
      case 'hardbreak':
        out.push('\n');
        return;
      case 'code_inline':
      case 'text': {
        const s = cur();
        const code = tk.type === 'code_inline' || s.code;
        const href = s.href;
        out.push(
          <RNText
            key={i}
            onPress={href ? () => openLink(href) : undefined}
            style={[
              fontFor(s.bold || base.bold ? 'semibold' : 'regular', { mono: code, cjk: hasCjk(tk.content) }),
              s.italic && styles.italic,
              s.strike && styles.strike,
              code && styles.codeInline,
              code && { fontSize: base.size - 1 },
              href && styles.link,
            ]}
          >
            {tk.content}
          </RNText>,
        );
        return;
      }
      default:
        if (tk.content) out.push(tk.content);
    }
  });
  return out;
}

/** A run of inline text. `bold` makes every run semibold (headings, table headers): each run sets its own font family. */
function Para({ node, size, color, bold, style }: { node: Node; size: number; color: string; bold?: boolean; style?: object }) {
  const kids = node.token.children ?? [];
  const text = node.token.content;
  return (
    <RNText selectable style={[fontFor(bold ? 'semibold' : 'regular', { cjk: hasCjk(text) }), { fontSize: size, lineHeight: Math.round(size * 1.6), color }, style]}>
      {inline(kids, { size, color, bold })}
    </RNText>
  );
}

const HEADING: Record<string, number> = { h1: fontSize.xl, h2: fontSize.lg, h3: fontSize.md, h4: fontSize.base, h5: fontSize.base, h6: fontSize.base };

function Blocks({ nodes, size, color }: { nodes: Node[]; size: number; color: string }) {
  return (
    <>
      {nodes.map((n, i) => (
        <Block key={i} node={n} size={size} color={color} />
      ))}
    </>
  );
}

function inlineOf(n: Node): Node | undefined {
  return n.children.find((c) => c.type === 'inline');
}

function Block({ node, size, color }: { node: Node; size: number; color: string }) {
  switch (node.type) {
    case 'paragraph': {
      const il = inlineOf(node);
      return il ? <Para node={il} size={size} color={color} /> : null;
    }
    case 'heading': {
      const il = inlineOf(node);
      const hs = HEADING[node.tag] ?? size;
      return il ? <Para node={il} size={hs} color={color} bold style={styles.heading} /> : null;
    }
    case 'bullet_list':
    case 'ordered_list': {
      const ordered = node.type === 'ordered_list';
      const start = Number(node.token.attrGet('start') ?? 1);
      return (
        <View style={styles.list}>
          {node.children.map((li, i) => (
            <View key={i} style={styles.li}>
              <RNText style={[fontFor('regular', { mono: ordered }), { fontSize: size, lineHeight: Math.round(size * 1.6), color: colors.textSecondary }, styles.marker]}>{ordered ? `${start + i}.` : '–'}</RNText>
              <View style={styles.liBody}>
                {/* A tight list item holds its text directly (paragraphs marked hidden). */}
                {li.children.map((c, j) => (c.type === 'paragraph' && c.token.hidden ? <Para key={j} node={inlineOf(c)!} size={size} color={color} /> : <Block key={j} node={c} size={size} color={color} />))}
              </View>
            </View>
          ))}
        </View>
      );
    }
    case 'blockquote':
      return (
        <View style={styles.quote}>
          <Blocks nodes={node.children} size={size} color={colors.textSecondary} />
        </View>
      );
    case 'fence':
    case 'code_block':
      return (
        <ScrollView horizontal style={styles.codeBox} contentContainerStyle={styles.codeIn} showsHorizontalScrollIndicator>
          <RNText selectable style={[fontFor('regular', { mono: true }), { fontSize: size - 1, lineHeight: Math.round((size - 1) * 1.5), color }]}>
            {node.token.content.replace(/\n$/, '')}
          </RNText>
        </ScrollView>
      );
    case 'table':
      return <Table node={node} size={size} color={color} />;
    case 'hr':
      return <View style={styles.hr} />;
    case 'inline':
      return <Para node={node} size={size} color={color} />;
    default:
      return node.children.length ? <Blocks nodes={node.children} size={size} color={color} /> : null;
  }
}

/** A table that scrolls sideways when wider than the bubble; header cells bold, hairline grid. */
function Table({ node, size, color }: { node: Node; size: number; color: string }) {
  const rows: { head: boolean; cells: Node[] }[] = [];
  for (const sec of node.children) for (const tr of sec.children) rows.push({ head: sec.type === 'thead', cells: tr.children });
  const cellSize = size - 1;
  // One width per column for every row: the longest cell's estimated width, kept between 64 and 260.
  const est = (txt: string) => [...txt].reduce((w, ch) => w + (hasCjk(ch) ? cellSize : cellSize * 0.58), 0) + space[2] * 2 + 6;
  const cols: number[] = [];
  for (const r of rows) r.cells.forEach((c, j) => (cols[j] = Math.max(cols[j] ?? 0, est(inlineOf(c)?.token.content ?? ''))));
  const widths = cols.map((w) => Math.round(Math.min(260, Math.max(64, w))));
  return (
    <ScrollView horizontal style={styles.tableBox} showsHorizontalScrollIndicator>
      <View style={styles.table}>
        {rows.map((r, i) => (
          <View key={i} style={[styles.tr, r.head && styles.thead, i === rows.length - 1 && styles.trLast]}>
            {r.cells.map((c, j) => {
              const il = inlineOf(c);
              return (
                <View key={j} style={[styles.td, { width: widths[j] }, j === r.cells.length - 1 && styles.tdLast]}>
                  {il && <Para node={il} size={cellSize} color={color} bold={r.head} />}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/** A reply as Markdown. `size` is the body font size (the chat uses 15 to 16). */
export function Markdown({ text, size = fontSize.md, color = colors.text }: { text: string; size?: number; color?: string }) {
  const nodes = useMemo(() => tree(md.parse(closeOpenFences(text), {})), [text]);
  return (
    <View style={styles.root}>
      <Blocks nodes={nodes} size={size} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[2] },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  codeInline: { backgroundColor: colors.surface, color: colors.text },
  link: { color: colors.info, textDecorationLine: 'underline' },
  heading: { marginTop: space[1] },
  list: { gap: space[1] },
  li: { flexDirection: 'row', gap: space[2] },
  marker: { minWidth: 14 },
  liBody: { flex: 1, minWidth: 0, gap: space[1] },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.borderStrong, paddingLeft: space[3], gap: space[1] },
  codeBox: { backgroundColor: colors.surface, borderRadius: radius.md, flexGrow: 0 },
  codeIn: { padding: space[3] },
  tableBox: { flexGrow: 0 },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  trLast: { borderBottomWidth: 0 },
  thead: { backgroundColor: colors.surface },
  td: { paddingHorizontal: space[2] + 2, paddingVertical: space[1] + 2, borderRightWidth: 1, borderRightColor: colors.border },
  tdLast: { borderRightWidth: 0 },
  hr: { height: 1, backgroundColor: colors.border, marginVertical: space[1] },
});
