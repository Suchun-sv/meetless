import { useState, type ReactNode } from 'react';
import { cardsFor, membersOf, projectRounds, type CardId } from '@meetless/core';
import { useApp } from '../app/AppContext';
import type { PageProps } from '../app/pages';
import { Card, CardGrid } from './Card';
import './dash.css';
import { cardStamp } from './model';
import { ProjectCard } from './ProjectCards';

/**
 * A project's dashboard: a setup strip while the project has no rounds or only its creator as a
 * member, then the card grid, then the composer. Cards are rule-based (contract §8, Task 6):
 * computed live from the project record, never stored, labelled `app.rules` on every card.
 */
export function ProjectDashPage({ composer }: PageProps) {
  const { route, live, me, t, go } = useApp();
  const [openedAt] = useState(() => new Date().toISOString());
  if (!('projectId' in route)) return null;
  const { projectId } = route;
  const { refreshed } = cardsFor(live, me, projectId);
  const showMembers = membersOf(live, projectId).length <= 1;
  const showRounds = projectRounds(live, projectId).length === 0;
  const render = (id: CardId): ReactNode => (
    <Card key={id} id={id} scope={projectId} stamp={cardStamp(refreshed, id, openedAt)}>
      <ProjectCard id={id} projectId={projectId} />
    </Card>
  );
  return (
    <div className="dash" data-testid="page-dash">
      {(showMembers || showRounds) && (
        <div className="dash-setup" data-testid="dash-setup">
          {showMembers && (
            <button type="button" className="btn btn-sm" data-testid="setup-members" onClick={() => go({ view: 'members', projectId })}>
              {t('db.setupMembers')}
            </button>
          )}
          {showRounds && (
            <button type="button" className="btn btn-sm" data-testid="setup-rounds" onClick={() => go({ view: 'rounds', projectId })}>
              {t('db.setupRounds')}
            </button>
          )}
        </div>
      )}
      <CardGrid scope={projectId} render={render} />
      {composer()}
    </div>
  );
}
