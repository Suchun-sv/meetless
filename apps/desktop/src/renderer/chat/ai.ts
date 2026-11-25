import { useEffect, useState } from 'react';
import type { AppApi } from '../app/AppContext';

/** `me.ai.enabled` per signed-in user, asked once per session. */
const CACHE = new Map<string, Promise<boolean>>();

/** Whether the server sends free questions to a model. False until known, and when `me` fails. */
export function useAiEnabled(api: AppApi['api'], me: string): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!me) return;
    let live = true;
    let p = CACHE.get(me);
    if (!p) {
      p = api('me', {})
        .then((r) => r.ok && r.data.ai?.enabled === true)
        .catch(() => false);
      CACHE.set(me, p);
    }
    void p.then((v) => {
      if (live) setOn(v);
    });
    return () => {
      live = false;
    };
  }, [api, me]);
  return on;
}
