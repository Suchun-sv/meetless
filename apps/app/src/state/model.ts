import type { Id } from '@meetless/core';
export { safeReplay, displayName, initials, myProjects, type Replayed } from '@renderer/model/state';

/** A new client-side id: `<prefix>-<uuid>` (crypto.randomUUID is polyfilled on native, src/polyfills.ts). */
export function newId(prefix: string): Id {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** The local calendar date, YYYY-MM-DD. */
export function localDay(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
