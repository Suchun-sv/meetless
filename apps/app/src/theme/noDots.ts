/**
 * Dev guard for the product rule "no dot symbols anywhere in the UI" (no ·, •, ●, bullets or status
 * dots). `Text` calls this in development; it warns once per distinct string.
 */
const DOTS = /[·•●∙⋅・‧◦⁃]/;
const seen = new Set<string>();

export function checkNoDots(s: string): void {
  if (!__DEV__ || !DOTS.test(s) || seen.has(s)) return;
  seen.add(s);
  console.warn(`[no-dots] rendered text contains a dot symbol: ${JSON.stringify(s.slice(0, 80))}`);
}

/** Flattens string and number children for the checks (nested elements are checked by their own Text). */
export function textOf(children: unknown): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(textOf).join('');
  return '';
}
