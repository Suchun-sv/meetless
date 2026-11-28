import { CLOSED_STATUSES, homeItems, myProjectIds, projectNeeds, type Id, type State } from '@meetless/core';

/**
 * 「今天要处理 N 件事」 (Home headline and the sidebar's 我的 badge). Core's `waitingCount` counts only
 * To confirm and unanswered handoffs; users also expect their own work that is due. Counted once each:
 * - every To confirm item (extracts, proposals, conflicts, questions);
 * - each open need that is mine and due today or overdue: I am its owner (负责人), or it is
 *   unassigned in a project where I am the only member, or a live handoff gives it to me; its due
 *   date is the handoff's own due when it has one, else its round's due (not a span round's);
 * - each handoff sent to me and not yet answered (not a conflict decision, which To confirm counts);
 *   a need counted above is not counted again for its handoff.
 */
export function todayCount(s: State, me: Id, today: string): number {
  const h = homeItems(s, me, today);
  const keys = new Set<string>(h.confirm.map((c) => `confirm:${c.kind}:${c.id}`));
  for (const pid of myProjectIds(s, me)) {
    const solo = s.projects[pid]?.memberIds.length === 1;
    for (const n of projectNeeds(s, pid)) {
      if (CLOSED_STATUSES.has(n.status)) continue;
      const toMe = Object.values(s.handoffs).filter((x) => x.needId === n.id && x.toId === me && x.state !== 'declined' && x.state !== 'done');
      const mine = n.ownerId === me || (n.ownerId === null && solo) || toMe.length > 0;
      if (!mine) continue;
      // A span round is a period, not a deadline; a removed round is gone (core skips both the same way).
      const round = n.roundId ? s.rounds[n.roundId] : undefined;
      const roundDue = round && !round.span && !round.removed ? round.due : null;
      const dues = [roundDue, ...toMe.map((x) => x.due ?? null)].filter((d): d is string => !!d);
      if (dues.some((d) => d.slice(0, 10) <= today)) keys.add(`need:${n.id}`);
    }
  }
  for (const x of h.toMe) {
    const ho = s.handoffs[x.handoffId];
    if (ho?.state === 'sent' && ho.conflictId === null && !keys.has(`need:${x.needId}`)) keys.add(`handoff:${x.handoffId}`);
  }
  return keys.size;
}
