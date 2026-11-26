import type { Id, MaterialCite } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';

/** Route and view names (contract §8 "Routes"). */
export type GlobalView = 'home' | 'agents' | 'newProject';
export type ProjectView = 'dash' | 'board' | 'inputs' | 'artifacts' | 'stream' | 'deliveries' | 'members' | 'rounds';
export type View = GlobalView | ProjectView;
/**
 * `focusId` selects an input or artifact in the three-pane pages. On `artifacts`, `versionId` and `page`
 * (zero-based, an index into the version's `derived.texts`) open that version at that page; on `inputs`,
 * `paraId` scrolls to that paragraph; on `deliveries`, `round` selects that round. Pages ignore what does not apply to them.
 */
export type Route =
  | { view: GlobalView }
  | { view: ProjectView; projectId: Id; needId?: Id | null; focusId?: Id | null; versionId?: Id; page?: number; paraId?: Id; round?: number };

export const GLOBAL_VIEWS: readonly GlobalView[] = ['home', 'agents', 'newProject'];
export const PROJECT_VIEWS: readonly ProjectView[] = ['dash', 'board', 'inputs', 'artifacts', 'stream', 'deliveries', 'members', 'rounds'];
export const SIDEBAR_SECTIONS: readonly ProjectView[] = ['dash', 'board', 'inputs', 'artifacts', 'stream', 'deliveries'];
export const DRAWER_VIEWS: ReadonlySet<ProjectView> = new Set<ProjectView>(['board', 'stream', 'deliveries']);
export const VIEW_TITLE_KEY: Record<View, MessageKey> = {
  home: 'nav.home',
  agents: 'nav.agents',
  newProject: 'nav.newProject',
  dash: 'nav.dash',
  board: 'nav.board',
  inputs: 'nav.inputs',
  artifacts: 'nav.artifacts',
  stream: 'nav.stream',
  deliveries: 'nav.deliveries',
  members: 'nav.members',
  rounds: 'nav.rounds',
};

export function defaultRoute(): Route {
  return { view: 'home' };
}

/** Where a material citation of an answer (U1's chips) opens: the input at its paragraph, or the artifact at its version and page. */
export function materialRoute(m: Pick<MaterialCite, 'kind' | 'id' | 'projectId' | 'versionId' | 'page' | 'paraId'>): Route {
  return {
    view: m.kind === 'artifact' ? 'artifacts' : 'inputs',
    projectId: m.projectId,
    focusId: m.id,
    ...(m.versionId ? { versionId: m.versionId } : {}),
    ...(m.page != null ? { page: m.page } : {}),
    ...(m.paraId ? { paraId: m.paraId } : {}),
  };
}
