/**
 * The composer's text field, for focusing it from elsewhere in the shell (contract §8). There is
 * no jsdom in component tests, so this holds a direct element reference instead of querying
 * `document`: the Composer registers its textarea here on mount.
 *
 * `side-new` routes first and focuses second (`shell/Sidebar.tsx`). `go` is a state update, so
 * the new page only mounts after the click handler returns, and its composer is a new element.
 * `focusComposer()` therefore also leaves a pending request, and the next composer that
 * registers takes the focus and clears it.
 */
let composerEl: HTMLTextAreaElement | null = null;
let pending = false;

/** Called by the Composer with its textarea (or `null` on unmount). Applies a pending focus request. */
export function registerComposer(el: HTMLTextAreaElement | null): void {
  composerEl = el;
  if (el && pending) {
    pending = false;
    el.focus();
  }
}

/** Focuses the registered composer now, and the next one to register (the page being routed to). */
export function focusComposer(): void {
  pending = true;
  composerEl?.focus();
}

/** Whether a focus request is still waiting for a composer to register. For tests. */
export function focusPending(): boolean {
  return pending;
}
