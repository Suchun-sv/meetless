import { useLocalSearchParams } from 'expo-router';
import type { Id, Project } from '@meetless/core';
import { useApp } from './AppContext';

/** The `[projectId]` route param. */
export function useProjectId(): Id {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return String(projectId ?? '');
}

/** The current project from the route, or null when it is not visible to this user. */
export function useProject(): Project | null {
  const { live } = useApp();
  const id = useProjectId();
  return live.projects[id] ?? null;
}
