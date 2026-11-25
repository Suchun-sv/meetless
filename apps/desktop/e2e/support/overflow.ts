import type { Page } from '@playwright/test';

/** The page's own scrollers and the phone's full-screen surfaces: none of them may scroll sideways. */
const SURFACES = ['.scroll', '.drawer', '.modal', '.side', '.top'];

/**
 * Horizontal overflow at the current width (design 2026-11-25 §7): the document wider than the
 * viewport, or one of `SURFACES` wider than its own box. Elements meant to scroll sideways (the
 * board's `.cols`, the composer's chip row, code diffs) have their own `overflow-x` and so do not
 * widen these. Returns one line per offender; empty means none.
 */
export async function horizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate((surfaces) => {
    const out: string[] = [];
    const vw = window.innerWidth;
    const doc = document.documentElement;
    if (doc.scrollWidth > vw) out.push(`document ${doc.scrollWidth} > ${vw}`);
    for (const sel of surfaces)
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        const visible = el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
        if (visible && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) out.push(`${sel} ${el.scrollWidth} > ${el.clientWidth}`);
      }
    return out;
  }, SURFACES);
}

/** The widest element inside `sel` that sticks out past the viewport's right edge (for debugging an overflow). */
export async function widestOffender(page: Page, sel = 'body'): Promise<string | null> {
  return page.evaluate((root) => {
    const vw = window.innerWidth;
    let worst: { right: number; desc: string } | null = null;
    for (const el of document.querySelectorAll<HTMLElement>(`${root} *`)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= vw + 1) continue;
      let clipped = false;
      for (let p = el.parentElement; p && !p.matches('.scroll, .drawer, .modal, .side'); p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if ((ox === 'auto' || ox === 'scroll' || ox === 'hidden') && p.getBoundingClientRect().right <= vw + 1) {
          clipped = true;
          break;
        }
      }
      if (clipped) continue;
      if (!worst || r.right > worst.right) worst = { right: Math.round(r.right), desc: `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${(el.textContent ?? '').slice(0, 40)}"` };
    }
    return worst ? `${worst.desc} right=${worst.right}` : null;
  }, sel);
}
