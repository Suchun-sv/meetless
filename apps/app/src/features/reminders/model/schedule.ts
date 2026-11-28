import { clip, myProjectIds, projectRounds, type Id, type IsoDate, type State } from '@meetless/core';
import type { Translator } from '@meetless/i18n';

/*
 * iOS local deadline reminders (expo-notifications, no push): for each open DDL of my projects
 * and each handoff to me with a due date, one notice the day before and one on the day, both at
 * 9:00 local time. Pure: the scheduler compares `reminderKey` of the wanted set with what is
 * pending and only reschedules when it changed.
 */

export const REMINDER_HOUR = 9;
/** iOS keeps at most 64 pending local notifications per app; stay under it. */
export const MAX_PENDING = 60;

export interface Reminder {
  /** Stable per deadline and slot: `ml-round-<roundId>-eve`, `ml-handoff-<handoffId>-day`. */
  id: string;
  fireAt: Date;
  title: string;
  body: string;
  /** What a tap opens. */
  data: { kind: 'round'; projectId: Id; round: number } | { kind: 'handoff'; projectId: Id; needId: Id };
}

/** `due` at `hour`:00 local time, `daysBefore` days earlier. */
export function localAt(due: IsoDate, daysBefore: number, hour = REMINDER_HOUR): Date {
  const [y, m, d] = due.slice(0, 10).split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d - daysBefore, hour, 0, 0, 0);
}

/** Every reminder still ahead of `now`, soonest first, at most MAX_PENDING. */
export function deadlineReminders(s: State, t: Translator['t'], me: Id, now: Date): Reminder[] {
  const out: Reminder[] = [];
  const both = (base: string, due: IsoDate, title: string, eve: string, day: string, data: Reminder['data']) => {
    out.push({ id: `${base}-eve`, fireAt: localAt(due, 1), title, body: eve, data });
    out.push({ id: `${base}-day`, fireAt: localAt(due, 0), title, body: day, data });
  };
  for (const pid of myProjectIds(s, me)) {
    const project = s.projects[pid]?.name ?? '';
    for (const r of projectRounds(s, pid)) {
      if (r.status === 'delivered') continue;
      const round = r.title || t('round', { n: r.n });
      both(`ml-round-${r.id}`, r.due, project, t('rem.roundTomorrow', { round }), t('rem.roundToday', { round }), { kind: 'round', projectId: pid, round: r.n });
    }
    for (const h of Object.values(s.handoffs)) {
      if (h.projectId !== pid || h.toId !== me || !h.due || h.state === 'done' || h.state === 'declined') continue;
      const n = s.needs[h.needId];
      const need = n ? `${n.code} ${clip(n.title, 40)}` : '';
      both(`ml-handoff-${h.id}`, h.due, project, t('rem.handoffTomorrow', { need }), t('rem.handoffToday', { need }), { kind: 'handoff', projectId: pid, needId: h.needId });
    }
  }
  return out
    .filter((r) => r.fireAt.getTime() > now.getTime())
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
    .slice(0, MAX_PENDING);
}

/** One string for a reminder set: equal keys mean nothing to reschedule. */
export function reminderKey(list: Reminder[]): string {
  return list.map((r) => `${r.id}@${r.fireAt.getTime()}|${r.title}|${r.body}`).join('\n');
}
