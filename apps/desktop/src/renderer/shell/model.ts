import { membersOf, myProjectIds, projectBadges, toConfirm, waitingCount, type Id, type IsoDate, type State } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { VIEW_TITLE_KEY, type ProjectView, type Route } from '../app/routes';

/**
 * One project in the sidebar's project tree (needs3/ui.jsx `Sidebar`). `badges` carries only the
 * non-zero counts of `board` and `inputs` from `projectBadges`; `total` is its collapsed count.
 */
export interface SidebarProject {
  id: Id;
  name: string;
  sample: boolean;
  open: boolean;
  total: number;
  badges: Partial<Record<ProjectView, number>>;
  memberIds: Id[];
}

export interface SidebarModel {
  homeCount: number;
  projects: SidebarProject[];
  anySample: boolean;
}

/**
 * Derived data for the sidebar (needs3/app.jsx `badge`, `homeCount`): the Home headline count,
 * the user's projects in membership order with the current one marked open, and whether any of
 * them is sample data.
 */
export function sidebarModel(s: State, me: Id, route: Route, today: IsoDate): SidebarModel {
  const currentId = 'projectId' in route ? route.projectId : null;
  const projects: SidebarProject[] = myProjectIds(s, me).map((id) => {
    const p = s.projects[id]!;
    const b = projectBadges(s, me, id, today);
    const badges: Partial<Record<ProjectView, number>> = {};
    if (b.board > 0) badges.board = b.board;
    if (b.inputs > 0) badges.inputs = b.inputs;
    return { id, name: p.name, sample: p.sample, open: id === currentId, total: b.total, badges, memberIds: membersOf(s, id) };
  });
  return { homeCount: waitingCount(s, me, today), projects, anySample: projects.some((p) => p.sample) };
}

/** The top bar (needs3/ui.jsx `Sidebar` project crumb): project views show the name, members and
 * the "To confirm" count; global views show only the title. */
export interface TopbarModel {
  titleKey: MessageKey;
  projectId: Id | null;
  projectName: string | null;
  memberIds: Id[];
  confirmCount: number;
}

export function topbarModel(s: State, me: Id, route: Route, today: IsoDate): TopbarModel {
  const titleKey = VIEW_TITLE_KEY[route.view];
  if (!('projectId' in route)) return { titleKey, projectId: null, projectName: null, memberIds: [], confirmCount: 0 };
  const project = s.projects[route.projectId];
  return {
    titleKey,
    projectId: route.projectId,
    projectName: project?.name ?? null,
    memberIds: membersOf(s, route.projectId),
    confirmCount: toConfirm(s, me, route.projectId, today).count,
  };
}

/**
 * Where "+ New" goes (needs3/app.jsx `onNew`): the current project's dash; otherwise the last
 * visited project still in `mine`, else the first of `mine`, else the new-project view.
 */
export function newInputTarget(route: Route, lastProjectId: Id | null, mine: Id[]): Route {
  if ('projectId' in route) return { view: 'dash', projectId: route.projectId };
  const last = lastProjectId !== null && mine.includes(lastProjectId) ? lastProjectId : null;
  const pid = last ?? mine[0] ?? null;
  return pid ? { view: 'dash', projectId: pid } : { view: 'newProject' };
}
