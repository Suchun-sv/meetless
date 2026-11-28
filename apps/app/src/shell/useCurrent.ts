import { useGlobalSearchParams, usePathname } from 'expo-router';
import type { Id } from '@meetless/core';
import type { Route } from '@renderer/app/routes';

/** Where the user is: the project in the URL (if any) and the first path segment after it. */
export function useCurrent(): { projectId: Id | null; section: string; path: string; route: Route } {
  const path = usePathname();
  const { projectId } = useGlobalSearchParams<{ projectId?: string }>();
  const m = /^\/p\/[^/]+(?:\/([^/?]+))?/.exec(path);
  const pid = m && projectId ? String(projectId) : null;
  const section = pid ? (m?.[1] ?? 'dash') : path.replace(/^\//, '').split('/')[0] || 'home';
  // The renderer's sidebar model only reads `view` and `projectId`.
  const route: Route = pid ? { view: 'dash', projectId: pid } : { view: 'home' };
  return { projectId: pid, section, path, route };
}
