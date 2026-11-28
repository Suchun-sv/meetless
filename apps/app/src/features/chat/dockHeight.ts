import { useSyncExternalStore } from 'react';

/**
 * The chat dock's current height in px (0 when hidden), for pages that need to keep content clear
 * of it (e.g. bottom padding on a scroll view, or a floating button). `ChatDock` reports it.
 */
let height = 0;
const subs = new Set<() => void>();

export function setDockHeight(h: number): void {
  const v = Math.round(h);
  if (v === height) return;
  height = v;
  for (const f of subs) f();
}

export function useDockHeight(): number {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => height,
    () => height,
  );
}
