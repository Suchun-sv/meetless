import { colors } from '@/theme';

/*
 * Remaining-days colours (mine-v3, shared with the project page). Five levels by calendar days
 * left (due minus today), plus green when everything under the deadline is done:
 *   red     overdue, or 0 to 2 days      #9F2F2D on #FDEBEC
 *   orange  3 to 7 days                  #B4541A on #FBEEE4
 *   yellow  8 to 14 days                 #8F6A00
 *   grey    15 to 30 days                #787774 (marks #B9B8B4)
 *   far     more than 30 days            #9B9A96 (marks #CFCEC9)
 * All values are theme tokens (colors.urgentOrange, urgentYellow, markGrey, markFar).
 */

export type UrgencyKey = 'red' | 'orange' | 'yellow' | 'grey' | 'far' | 'done';

export interface UrgencyTone {
  key: UrgencyKey;
  /** Text: 剩 N 天, the date column, the selected day. */
  fg: string;
  /** Light tint behind a calendar day (red and orange only). */
  bg: string | null;
  /** Dots and timeline markers. */
  mark: string;
}

export const URGENCY: Record<UrgencyKey, Omit<UrgencyTone, 'key'>> = {
  red: { fg: colors.danger, bg: colors.dangerBg, mark: colors.danger },
  orange: { fg: colors.urgentOrange, bg: colors.urgentOrangeBg, mark: colors.urgentOrange },
  yellow: { fg: colors.urgentYellow, bg: null, mark: colors.urgentYellow },
  grey: { fg: colors.textSecondary, bg: null, mark: colors.markGrey },
  far: { fg: colors.textTertiary, bg: null, mark: colors.markFar },
  done: { fg: colors.success, bg: null, mark: colors.success },
};

export function urgencyKey(daysLeft: number, done = false): UrgencyKey {
  if (done) return 'done';
  if (daysLeft <= 2) return 'red';
  if (daysLeft <= 7) return 'orange';
  if (daysLeft <= 14) return 'yellow';
  if (daysLeft <= 30) return 'grey';
  return 'far';
}

export function urgencyTone(daysLeft: number, done = false): UrgencyTone {
  const key = urgencyKey(daysLeft, done);
  return { key, ...URGENCY[key] };
}

const RANK: Record<UrgencyKey, number> = { red: 0, orange: 1, yellow: 2, grey: 3, far: 4, done: 5 };
/** The most urgent of several (a merged marker, a calendar day). */
export const mostUrgent = (ks: UrgencyKey[]): UrgencyKey => ks.reduce<UrgencyKey>((a, b) => (RANK[b] < RANK[a] ? b : a), 'done');
export const urgencyRank = (k: UrgencyKey) => RANK[k];
