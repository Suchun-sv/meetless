import { cardsFor, myProjectIds, type CardId, type Id, type IsoDate, type State } from '@meetless/core';
import { todayCount } from '@/state/today';

/*
 * 「我的」 (Home): the cross-project dashboard. With projects, a hero line (how much is waiting,
 * across how many projects) above the card grid; with none, an empty state that points at
 * creating one. Card bodies read core's `homeItems`, `projectsCard`, `allRisks`, which already
 * leave out other people's private items.
 */

export interface HomeView {
  empty: boolean;
  /** `home.hi`: To confirm plus handoffs sent to me not yet answered. */
  waiting: number;
  /** `home.sub`: projects I am a member of. */
  projects: number;
  cards: CardId[];
  refreshed: Record<string, string>;
}

export function homeView(s: State, me: Id, today: IsoDate): HomeView {
  const ids = myProjectIds(s, me);
  if (ids.length === 0) return { empty: true, waiting: 0, projects: 0, cards: [], refreshed: {} };
  const { cards, refreshed } = cardsFor(s, me, 'home');
  return { empty: false, waiting: todayCount(s, me, today), projects: ids.length, cards, refreshed };
}

/** The three answers to a handoff sent to me, as `handoff.responded` payloads. */
export type HandoffAnswer = 'accepted' | 'asked' | 'declined';
export const handoffAnswer = (handoffId: Id, response: HandoffAnswer) => ({ handoffId, response });
