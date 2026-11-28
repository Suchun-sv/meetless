import type { Id } from '@meetless/core';

/** `me.ai.enabled` per signed-in user, asked once per session. */
const CACHE = new Map<Id, Promise<boolean>>();

/** The app's `api('me', {})`, loosely typed: only `ai.enabled` matters here. */
export type MeFn = () => Promise<{ ok: true; data: { ai?: { enabled?: boolean } } } | { ok: false }>;

/** Whether the server sends free questions to DeepSeek for `me`. False when `me` fails. */
export function aiEnabled(me: Id, fetchMe: MeFn): Promise<boolean> {
  let p = CACHE.get(me);
  if (!p) {
    p = fetchMe()
      .then((r) => r.ok && r.data.ai?.enabled === true)
      .catch(() => false);
    CACHE.set(me, p);
  }
  return p;
}
