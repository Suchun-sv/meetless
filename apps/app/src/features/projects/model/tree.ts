import { membersOf, myProjectIds, projectBadges, waitingCount, type Id, type IsoDate, type State } from '@meetless/core';

/*
 * The project tree (desktop `shell/model.ts` `sidebarModel`, without the desktop route type):
 * the Home count, my projects in membership order with the current one open, and whether any is
 * sample data. The rename rule is the desktop's own `shell/rename.ts`.
 */

export { PROJECT_NAME_MAX, renameCommand, type RenameOutcome } from '../../../../../desktop/src/renderer/shell/rename';

/** A project's sections in the tree, in order, then the members and rounds links. */
export const PROJECT_SECTIONS = ['dash', 'board', 'inputs', 'artifacts', 'stream', 'deliveries'] as const;
export type ProjectSection = (typeof PROJECT_SECTIONS)[number];
export const PROJECT_LINKS = ['members', 'rounds'] as const;

/** The i18n key of each section and link title. */
export const SECTION_TITLE_KEY = {
  dash: 'nav.dash',
  board: 'nav.board',
  inputs: 'nav.inputs',
  artifacts: 'nav.artifacts',
  stream: 'nav.stream',
  deliveries: 'nav.deliveries',
  members: 'nav.members',
  rounds: 'nav.rounds',
} as const;

export interface TreeProject {
  id: Id;
  name: string;
  sample: boolean;
  open: boolean;
  /** Shown on the row while collapsed (when above 0). */
  total: number;
  /** Non-zero section counts only (board, inputs). */
  badges: Partial<Record<ProjectSection, number>>;
  memberIds: Id[];
}

export interface ProjectTree {
  homeCount: number;
  projects: TreeProject[];
  anySample: boolean;
}

export function projectTree(s: State, me: Id, currentProjectId: Id | null, today: IsoDate): ProjectTree {
  const projects = myProjectIds(s, me).map((id): TreeProject => {
    const p = s.projects[id]!;
    const b = projectBadges(s, me, id, today);
    const badges: TreeProject['badges'] = {};
    if (b.board > 0) badges.board = b.board;
    if (b.inputs > 0) badges.inputs = b.inputs;
    return { id, name: p.name, sample: p.sample, open: id === currentProjectId, total: b.total, badges, memberIds: membersOf(s, id) };
  });
  return { homeCount: waitingCount(s, me, today), projects, anySample: projects.some((p) => p.sample) };
}

/**
 * Which project 「+ 新建」 lands in: the current one; else the last visited still mine; else the
 * first of mine; else none (go to the new-project page).
 */
export function newInputProject(currentProjectId: Id | null, lastProjectId: Id | null, mine: Id[]): Id | null {
  if (currentProjectId) return currentProjectId;
  if (lastProjectId !== null && mine.includes(lastProjectId)) return lastProjectId;
  return mine[0] ?? null;
}
