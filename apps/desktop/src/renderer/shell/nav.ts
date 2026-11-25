import { useSyncExternalStore } from 'react';
import type { Route } from '../app/routes';

/*
 * The phone nav drawer (design 2026-11-25 §7). It is open for the route it was opened on and for
 * no other: any navigation (`go`, a sidebar row, a need opening) makes a new route object, so the
 * drawer closes with no effect to run, and a resize or rotation across 760px never leaves a stuck
 * scrim (Review Focus 5). At wider widths the `nav-open` class has no effect (shell.css).
 * One app per page, so one module-level store; `Topbar` and `Shell` both read it.
 */

let openAt: Route | null = null;
const listeners = new Set<() => void>();

function set(next: Route | null): void {
  if (next === openAt) return;
  openAt = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

const snapshot = () => openAt;

/** Whether the drawer opened at `at` is open on `route`: only while the route is the same one. */
export function navOpenOn(at: Route | null, route: Route): boolean {
  return at !== null && at === route;
}

/** Opens the drawer on `route`, or closes it when it is already open there. */
export function toggleNav(route: Route): void {
  set(navOpenOn(openAt, route) ? null : route);
}

export function closeNav(): void {
  set(null);
}

/** The drawer state for the current route, re-rendering when it changes. */
export function useNavOpen(route: Route): boolean {
  return navOpenOn(useSyncExternalStore(subscribe, snapshot, snapshot), route);
}
