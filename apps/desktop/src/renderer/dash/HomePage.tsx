import { useState, type ReactNode } from 'react';
import { cardsFor, myProjectIds, waitingCount, type CardId } from '@meetless/core';
import { useApp } from '../app/AppContext';
import type { PageProps } from '../app/pages';
import { Btn } from '../ui/primitives';
import { Card, CardGrid } from './Card';
import './dash.css';
import { HomeCard } from './HomeCards';
import { cardStamp } from './model';

/**
 * Home: the cross-project dashboard (contract §8, Task 7), ported from the prototype's
 * `home-hero2` and `Dashboard home`. With projects, a hero line (how much is waiting, across how
 * many projects) sits above the card grid; with none, an empty state points at creating one.
 */
export function HomePage({ composer }: PageProps) {
  const { live, me, t, today, go } = useApp();
  const [openedAt] = useState(() => new Date().toISOString());
  const myIds = myProjectIds(live, me);

  if (myIds.length === 0) {
    return (
      <div className="dash" data-testid="page-home">
        <p className="muted">{t('pj.empty')}</p>
        <Btn testId="home-new-project" onClick={() => go({ view: 'newProject' })}>
          {t('nav.newProject')}
        </Btn>
        {composer({ inline: true })}
      </div>
    );
  }

  const { refreshed } = cardsFor(live, me, 'home');
  const render = (id: CardId): ReactNode => (
    <Card key={id} id={id} scope="home" home stamp={cardStamp(refreshed, id, openedAt)}>
      <HomeCard id={id} />
    </Card>
  );
  return (
    <div className="dash" data-testid="page-home">
      <div className="home-hero2">
        <h1>{t('home.hi', { n: waitingCount(live, me, today) })}</h1>
        <div className="muted">{t('home.sub', { p: myIds.length })}</div>
        {composer({ inline: true })}
      </div>
      <CardGrid scope="home" home render={render} />
    </div>
  );
}
