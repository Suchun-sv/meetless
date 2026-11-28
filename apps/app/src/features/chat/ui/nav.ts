import { useCallback } from 'react';
import { useRouter, type Href } from 'expo-router';
import { routePath, type AppRoute } from '@/state';
import type { Target } from '../model/target';

const enc = encodeURIComponent;

/** The path a `Target` opens. Handoff and link sheets live on the handoff route, keyed by query. */
export function targetPath(x: Target): string {
  switch (x.kind) {
    case 'need':
      return routePath({ view: 'board', projectId: x.projectId, needId: x.needId });
    case 'confirm':
      return routePath({ view: 'confirm', projectId: x.projectId });
    case 'handoff':
      return `${routePath({ view: 'handoff', projectId: x.projectId, needId: x.needId })}${x.toId ? `&to=${enc(x.toId)}` : ''}`;
    case 'link':
      return `${routePath({ view: 'handoff', projectId: x.projectId, needId: x.needId })}&mode=link`;
    case 'input':
      return routePath({ view: 'inputs', projectId: x.projectId, focusId: x.inputId, ...(x.paraId ? { paraId: x.paraId } : {}) });
    case 'artifact':
      return routePath({ view: 'artifacts', projectId: x.projectId, focusId: x.artifactId, ...(x.versionId ? { versionId: x.versionId } : {}), ...(x.page != null ? { page: x.page } : {}) });
    case 'dash': {
      const r: AppRoute = x.scope === 'home' ? { view: 'home' } : { view: 'dash', projectId: x.scope };
      return routePath(r);
    }
  }
}

/** Opens a `Target` with the router. */
export function useOpenTarget(): (x: Target) => void {
  const router = useRouter();
  return useCallback((x: Target) => router.push(targetPath(x) as Href), [router]);
}
