import { projectRounds, roundFeedback, type Id, type Need, type NeedStatus, type Round, type RoundStatus, type State } from '@meetless/core';
import type { Tone } from '../ui/tone';

/**
 * Deliveries timeline model (task 10 brief; contract §8, design §5 「交付时冻结交付项，并逐条记录需求状态」).
 * Pure helpers over `State`; no React.
 */

export interface DeliverySection {
  round: Round;
  tone: Tone;
  delivered: Round['delivery'];
  draft: { items: string[]; account: { needId: Id; status: NeedStatus }[] } | null;
  feedback: Need[];
}

const ROUND_TONE: Record<RoundStatus, Tone> = {
  delivered: 'success',
  current: 'info',
  planned: 'neutral',
};

/**
 * The project's rounds, newest `n` first. `selected` (a round number) keeps only that round.
 * `draft` exists only for the current round: the round's planned items, plus the shared external
 * needs already filed against it, in `createdSeq` order — the same default the `round.delivered`
 * reducer builds when the client sends no `account` (reducer.ts `round.delivered`), so the draft
 * previews exactly what delivering now would freeze. A delivered round's `delivery` already holds
 * its own frozen account; it is read as-is, never recomputed. `feedback` is the shared needs born
 * from the round (its lineage), oldest first.
 */
export function deliverySections(s: State, projectId: Id, selected: number | null): DeliverySection[] {
  return projectRounds(s, projectId)
    .slice()
    .sort((a, b) => b.n - a.n)
    .filter((r) => selected === null || r.n === selected)
    .map((round) => ({
      round,
      tone: ROUND_TONE[round.status],
      delivered: round.delivery,
      draft:
        round.status === 'current'
          ? {
              items: round.items,
              account: Object.values(s.needs)
                .filter((n) => n.roundId === round.id && n.kind === 'ext' && n.privateTo === null)
                .sort((a, b) => a.createdSeq - b.createdSeq)
                .map((n) => ({ needId: n.id, status: n.status })),
            }
          : null,
      feedback: roundFeedback(s, round.id),
    }));
}

/** One delivery item per non-blank line, trimmed. */
export function draftItems(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
