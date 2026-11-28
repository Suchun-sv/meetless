import { noDots, SEP, userName, type Id, type Need, type Round, type State } from '@meetless/core';
import type { MessageKey, Params } from '@meetless/i18n';

export * from '@renderer/deliveries/model';

type T = (key: MessageKey, params?: Params) => string;
type FmtDay = (d: string) => string;

export interface RoundHeader {
  title: string;
  statusKey: MessageKey;
  /** Due day and hard / cadence. */
  meta: string;
  kind: Round['kind'];
  status: Round['status'];
}

export function roundHeader(t: T, fmtDay: FmtDay, round: Round): RoundHeader {
  return {
    title: noDots(round.title) || t('round', { n: round.n }),
    statusKey: `round.${round.status}` as MessageKey,
    meta: t('round.due', { d: fmtDay(round.due) }) + SEP + t(round.kind === 'hard' ? 'tl.hard' : 'tl.cadence'),
    kind: round.kind,
    status: round.status,
  };
}

/** A feedback row: the quote and who it came from, then the need chip. */
export function feedbackLine(s: State, t: T, f: Need): { needId: Id; text: string } {
  return { needId: f.id, text: `“${noDots(f.source.quote)}”${SEP}${t('in.from', { who: noDots(userName(s, f.createdBy)) })}` };
}

/** The round number a timeline tap leaves selected: the same one again clears it. */
export function toggleRound(selected: number | null, n: number): number | null {
  return selected === n ? null : n;
}
