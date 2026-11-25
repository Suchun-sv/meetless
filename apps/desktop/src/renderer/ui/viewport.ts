/**
 * The on-screen keyboard's height (design 2026-11-25 §7): how much of the layout viewport the
 * visual viewport no longer covers at the bottom, in whole px, never negative. `null` (no
 * `visualViewport`) is 0.
 */
export function keyboardInset(vv: { height: number; offsetTop: number } | null, innerHeight: number): number {
  if (!vv) return 0;
  return Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
}

/**
 * Keeps the `--kb-inset` token on the root element equal to `keyboardInset` while the visual
 * viewport resizes or scrolls, so the phone composer (chat.css) sits above the keyboard. A pinch
 * zoom also shrinks the visual viewport; it is not a keyboard, so it counts as 0. With no keyboard
 * the root carries no inline style at all (the token's own 0px applies), so desktop markup stays
 * free of inline styles. Returns the remover, which also drops the override. Called once from `Shell`.
 */
export function installKeyboardInset(win: Window): () => void {
  const vv = win.visualViewport;
  const root = win.document.documentElement;
  if (!vv) return () => undefined;
  const apply = () => {
    const zoomed = typeof vv.scale === 'number' && vv.scale > 1.01;
    const inset = keyboardInset(zoomed ? null : vv, win.innerHeight);
    if (inset > 0) root.style.setProperty('--kb-inset', `${inset}px`);
    else root.style.removeProperty('--kb-inset');
  };
  apply();
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  return () => {
    vv.removeEventListener('resize', apply);
    vv.removeEventListener('scroll', apply);
    root.style.removeProperty('--kb-inset');
  };
}
