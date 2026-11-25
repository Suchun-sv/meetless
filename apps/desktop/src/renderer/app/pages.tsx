import type { ComponentType, ReactNode } from 'react';
import { ArtifactsPage } from '../artifacts/ArtifactsPage';
import { HomePage } from '../dash/HomePage';
import { ProjectDashPage } from '../dash/ProjectDashPage';
import { DeliveriesPage } from '../deliveries/DeliveriesPage';
import { InputsPage } from '../inputs/InputsPage';
import { BoardPage } from '../needs/BoardPage';
import { AgentsPage } from '../setup/AgentsPage';
import { MembersPage } from '../setup/MembersPage';
import { NewProjectPage } from '../setup/NewProjectPage';
import { RoundsPage } from '../setup/RoundsPage';
import { StreamPage } from '../stream/StreamPage';
import type { View } from './routes';

/** What the shell gives every page: the composer for the current scope, placed where the page wants it. */
export interface PageProps {
  composer(opts?: { inline?: boolean }): ReactNode;
}

/** The page for each view (contract §8). Each block owns its pages; the shell renders `PAGES[route.view]`. */
export const PAGES: Record<View, ComponentType<PageProps>> = {
  home: HomePage,
  agents: AgentsPage,
  newProject: NewProjectPage,
  dash: ProjectDashPage,
  board: BoardPage,
  inputs: InputsPage,
  artifacts: ArtifactsPage,
  stream: StreamPage,
  deliveries: DeliveriesPage,
  members: MembersPage,
  rounds: RoundsPage,
};
