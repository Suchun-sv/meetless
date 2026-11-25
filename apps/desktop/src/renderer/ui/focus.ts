/** Focus helpers for dialogs (Modal). Pure, so they are tested without a DOM. */

export const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Where Tab moves focus in a dialog with `count` focusable elements when the focused one is at
 * `index` (-1 when focus is on none of them). It wraps at both ends. Returns the index to focus,
 * -1 to focus the dialog itself (nothing focusable), or null to let the browser move focus.
 */
export function trapTab(count: number, index: number, shift: boolean): number | null {
  if (count === 0) return -1;
  if (index < 0) return shift ? count - 1 : 0;
  if (shift && index === 0) return count - 1;
  if (!shift && index === count - 1) return 0;
  return null;
}

/** A click on the scrim closes the dialog only when the press also started on the scrim, so a drag out of a text field never closes it. */
export function closesOnClick(downOnScrim: boolean, upOnScrim: boolean): boolean {
  return downOnScrim && upOnScrim;
}
