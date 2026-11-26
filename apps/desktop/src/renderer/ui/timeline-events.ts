import { projectInputs, projectNeeds, projectRounds, workFor, type Id, type IsoDate, type Scene, type State } from '@meetless/core';

/*
 * What happened when, for the timeline's event ticks (no React, no i18n): needs added (and where
 * from), needs met, artifact versions, deliveries, and inputs that produced something. Built from
 * the viewer's own state, so another user's private items never show.
 */

export type EvType = 'added' | 'agent' | 'met' | 'artifact' | 'delivered' | 'scene';
export const EV_TYPES: readonly EvType[] = ['added', 'met', 'artifact', 'delivered', 'scene', 'agent'];

export type EvTarget = { need: Id } | { artifact: Id } | { round: number } | { input: Id };

export interface TimelineEvent {
  date: IsoDate;
  type: EvType;
  projectId: Id;
  /** What it was: a need's code and title, an artifact and version, a DDL, an input. */
  what: string;
  scene?: Scene | null;
  target: EvTarget;
}

/** Ticks of one day, most telling first (a delivery, then work done, then the rest). */
export interface EventDay {
  date: IsoDate;
  type: EvType;
  events: TimelineEvent[];
}

const RANK: Record<EvType, number> = { delivered: 0, met: 1, artifact: 2, agent: 3, added: 4, scene: 5 };

export function projectEvents(s: State, projectId: Id): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const rounds = projectRounds(s, projectId);
  for (const n of projectNeeds(s, projectId)) {
    const what = `${n.code} ${n.title}`;
    const scene = n.source.inputId ? (s.inputs[n.source.inputId]?.scene ?? null) : null;
    out.push({ date: n.source.date, type: n.source.proposalId ? 'agent' : 'added', projectId, what, scene, target: { need: n.id } });
    if (n.status === 'met' || n.status === 'held') {
      // No status timestamp is stored: the latest work on the need, else its DDL's delivery.
      const last = workFor(s, n.id).at(-1)?.date ?? (n.roundId ? (s.rounds[n.roundId]?.delivery?.date ?? null) : null);
      if (last) out.push({ date: last, type: 'met', projectId, what, target: { need: n.id } });
    }
  }
  for (const a of Object.values(s.artifacts)) {
    if (a.projectId !== projectId) continue;
    for (const v of a.versions) out.push({ date: v.date, type: 'artifact', projectId, what: `${a.title} ${v.label}`, target: { artifact: a.id } });
  }
  for (const r of rounds) if (r.delivery) out.push({ date: r.delivery.date, type: 'delivered', projectId, what: r.title, target: { round: r.n } });
  for (const i of projectInputs(s, projectId)) {
    if (i.extracts.some((x) => x.state === 'accepted')) out.push({ date: i.date, type: 'scene', projectId, what: i.title, scene: i.scene, target: { input: i.id } });
  }
  return out;
}

/** Events grouped by day (dense days collapse into one tick with a count), in date order. */
export function eventDays(events: TimelineEvent[]): EventDay[] {
  const by = new Map<IsoDate, TimelineEvent[]>();
  for (const e of events) by.set(e.date, [...(by.get(e.date) ?? []), e]);
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, evs]) => {
      const sorted = [...evs].sort((a, b) => RANK[a.type] - RANK[b.type]);
      return { date, type: sorted[0]!.type, events: sorted };
    });
}
