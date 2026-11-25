import { useState } from 'react';
import { projectRounds } from '@meetless/core';
import type { PageProps } from '../app/pages';
import { useApp } from '../app/AppContext';
import { Timeline } from '../ui/Timeline';
import { deliverySections } from './model';
import { RoundSection } from './RoundSection';
import './deliveries.css';

/**
 * Deliveries timeline (task 10 brief; contract §8, design §5): the rounds gantt, then each
 * round's delivery — a frozen account and feedback for a delivered round, the current round's
 * draft (ready to deliver), or nothing yet for a planned round. Clicking a bar on the timeline
 * keeps only that round; clicking it again clears the selection (`ui/Timeline.tsx`). A project
 * with no rounds offers to set them up instead.
 */
export function DeliveriesPage({ composer }: PageProps) {
  const { live, route, t, go } = useApp();
  const [selected, setSelected] = useState<number | null>(null);
  if (route.view !== 'deliveries') return null;
  const { projectId } = route;
  const rounds = projectRounds(live, projectId);

  return (
    <div className="page" data-testid="page-deliveries">
      <h1>{t('dl.title')}</h1>
      {rounds.length === 0 ? (
        <div className="faint pad stack">
          <p>{t('dl.noRounds')}</p>
          <button type="button" className="btn" data-testid="dl-set-rounds" onClick={() => go({ view: 'rounds', projectId })}>
            {t('dl.setRounds')}
          </button>
        </div>
      ) : (
        <>
          <Timeline projectId={projectId} selected={selected} onSelect={setSelected} />
          {deliverySections(live, projectId, selected).map((section) => (
            <RoundSection key={section.round.id} projectId={projectId} section={section} />
          ))}
        </>
      )}
      {composer()}
    </div>
  );
}
