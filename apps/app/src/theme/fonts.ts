import { Platform } from 'react-native';
import type { Weight } from './tokens';

/**
 * Font families. Native: one bundled static file per weight (expo-font, see `useAppFonts`), Noto Sans SC
 * for text with CJK, Geist otherwise. Web: the CSS stacks from tokens.css; the woff2 files and
 * @font-face rules are in public/fonts (unicode-range subsets) and the browser falls back per glyph.
 */
const WEB_SANS = '"Geist","SF Pro Text",-apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC","Noto Sans CJK SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
const WEB_MONO = '"Geist Mono","JetBrains Mono","SF Mono",ui-monospace,Menlo,"PingFang SC","Noto Sans SC",monospace';

const CJK = /[⺀-鿿가-힯豈-﫿＀-￯]/;

export function hasCjk(s: string): boolean {
  return CJK.test(s);
}

/** The fontFamily (and, on web, fontWeight) for a run of text. */
export function fontFor(w: Weight, opts: { mono?: boolean; cjk?: boolean } = {}): { fontFamily: string; fontWeight?: '400' | '500' | '600' } {
  const numeric = w === 'regular' ? '400' : w === 'medium' ? '500' : '600';
  if (Platform.OS === 'web') return { fontFamily: opts.mono ? WEB_MONO : WEB_SANS, fontWeight: numeric };
  if (opts.mono) return { fontFamily: 'GeistMono-Regular' };
  if (opts.cjk) return { fontFamily: w === 'regular' ? 'NotoSansSC-Regular' : 'NotoSansSC-Medium' };
  return { fontFamily: w === 'regular' ? 'Geist-Regular' : w === 'medium' ? 'Geist-Medium' : 'Geist-SemiBold' };
}
