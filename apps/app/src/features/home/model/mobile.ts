import { CLOSED_STATUSES, daysBetween, myProjectIds, projectNeeds, projectRounds, type Id, type IsoDate, type Need, type NeedStatus, type Round, type State } from '@meetless/core';

/*
 * 「我的」 on a phone (mobile-v1 01): the open DDLs of my projects by date, each with its first
 * open needs (mine first, then not started before in progress) and how many more there are.
 * No gantt on narrow screens.
 */

export interface DeadlineGroup {
  round: Round;
  projectId: Id;
  projectName: string;
  daysLeft: number;
  needs: Need[];
  more: number;
}

const RANK: Partial<Record<NeedStatus, number>> = { todo: 0, untested: 0, partial: 1, doing: 2, testing: 2, parked: 3 };
const codeNum = (c: string) => Number(/\d+/.exec(c)?.[0] ?? 0);

/** Every DDL not yet delivered in my (non-archived) projects, soonest first (overdue on top), with at most `max` open needs each. */
export function deadlineGroups(s: State, me: Id, today: IsoDate, keep: ReadonlySet<Id> = new Set(), max = 3): DeadlineGroup[] {
  const out: DeadlineGroup[] = [];
  for (const pid of myProjectIds(s, me)) {
    // `keep`: needs just checked off here stay in place (greyed) so a second tap can undo.
    const needs = projectNeeds(s, pid).filter((n) => !CLOSED_STATUSES.has(n.status) || keep.has(n.id));
    const mine = (n: Need) => n.ownerId === me || Object.values(s.handoffs).some((h) => h.needId === n.id && h.toId === me && h.state !== 'declined' && h.state !== 'done');
    for (const r of projectRounds(s, pid)) {
      if (r.status === 'delivered') continue;
      const open = needs
        .filter((n) => n.roundId === r.id)
        .sort((a, b) => Number(mine(b)) - Number(mine(a)) || (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || a.kind.localeCompare(b.kind) || codeNum(a.code) - codeNum(b.code));
      out.push({ round: r, projectId: pid, projectName: s.projects[pid]?.name ?? '', daysLeft: daysBetween(today, r.due), needs: open.slice(0, max), more: Math.max(0, open.length - max) });
    }
  }
  return out.sort((a, b) => a.round.due.localeCompare(b.round.due) || a.projectName.localeCompare(b.projectName));
}

/** How many of them fall in this week (today to Sunday). */
export function dueThisWeek(groups: DeadlineGroup[], today: IsoDate): number {
  const dow = new Date(`${today.slice(0, 10)}T12:00:00Z`).getUTCDay();
  const toSunday = (7 - dow) % 7;
  return groups.filter((g) => g.daysLeft >= 0 && g.daysLeft <= toSunday).length;
}

/** 「11月27日 星期五」 / 「Friday, November 27」. */
export function dateLine(today: IsoDate, locale: string): string {
  const d = new Date(`${today.slice(0, 10)}T12:00:00Z`);
  if (locale.startsWith('zh')) return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 星期${'日一二三四五六'[d.getUTCDay()]}`;
  return d.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** The month under a DDL's day number: 「11月」 / 「Nov」. */
export function monthLabel(due: IsoDate, locale: string): string {
  const d = new Date(`${due.slice(0, 10)}T12:00:00Z`);
  return locale.startsWith('zh') ? `${d.getUTCMonth() + 1}月` : d.toLocaleDateString('en', { month: 'short', timeZone: 'UTC' });
}

/** 剩 N 天 colour: red at 3 days or fewer (or overdue), amber within a week, else grey. */
export function leftTone(days: number): 'danger' | 'warning' | 'textSecondary' {
  return days <= 3 ? 'danger' : days <= 7 ? 'warning' : 'textSecondary';
}
