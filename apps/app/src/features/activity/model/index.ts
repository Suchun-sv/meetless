import { noDots, SEP, type Id, type ProjectRename, type SourceKind, type State, type WorkEffect, type WorkItem } from '@meetless/core';
import type { MessageKey, Params } from '@meetless/i18n';
import { displayName } from '@renderer/model/state';
import { EF_TONE, type Tone } from '@renderer/ui/tone';
import { streamItems, type StreamFilter, type StreamItem, type StreamKind, type StreamRowData } from '@renderer/stream/model';

export * from '@renderer/stream/model';

type T = (key: MessageKey, params?: Params) => string;
type FmtDay = (d: string) => string;

export const STREAM_KINDS: readonly (StreamKind | 'all')[] = ['all', 'agent', 'manual', 'capture'];

export interface ActivityCard {
  id: Id;
  kind: StreamKind;
  src: SourceKind;
  /** Day and author. */
  meta: string;
  text: string;
  mono: boolean;
  /** Need chips, only for needs this viewer holds in this project; always before any pill. */
  needIds: Id[];
  effect: { value: WorkEffect; key: MessageKey; tone: Tone } | null;
  result: { value: NonNullable<WorkItem['result']>; key: MessageKey; tone: Tone } | null;
  why: string | null;
  /** "通过 {client}", agent rows that count as progress. */
  via: string | null;
  progress: boolean;
  capture: boolean;
  rules: boolean;
  mine: boolean;
  unlinked: boolean;
  /** Mine and unlinked: offer 去确认. */
  askable: boolean;
}

export function activityCard(s: State, projectId: Id, row: StreamRowData, fmtDay: FmtDay): ActivityCard {
  const { w, kind } = row;
  const counts = row.progress && !row.unlinked;
  const visible = (id: Id | null): id is Id => !!id && s.needs[id]?.projectId === projectId;
  return {
    id: w.id,
    kind,
    src: w.src,
    meta: [fmtDay(w.date), noDots(displayName(s, w.by))].join(SEP),
    text: noDots(w.text),
    mono: w.src === 'commit',
    needIds: [w.needId, w.alsoNeedId].filter(visible),
    effect: w.effect ? { value: w.effect, key: `ef.${w.effect}` as MessageKey, tone: EF_TONE[w.effect] } : null,
    result: w.result ? { value: w.result, key: `res.${w.result}` as MessageKey, tone: w.result === 'keep' ? 'success' : 'muted' } : null,
    why: w.why ? noDots(w.why) : null,
    via: counts && kind === 'agent' && w.via ? w.via.client : null,
    progress: counts && (kind === 'agent' ? !!w.via : kind === 'manual'),
    capture: kind === 'capture',
    rules: row.rules,
    mine: row.mine,
    unlinked: row.unlinked,
    askable: row.askable,
  };
}

export function sysLine(s: State, rename: ProjectRename, t: T, fmtDay: FmtDay): string {
  const text = t('stream.renamed', { who: noDots(displayName(s, rename.by)), from: noDots(rename.from), to: noDots(rename.to) });
  return [fmtDay(rename.at.slice(0, 10)), text].join(SEP);
}

export type ActivityLine = { type: 'work'; key: string; card: ActivityCard } | { type: 'sys'; key: string; text: string };

export interface ActivityView {
  lines: ActivityLine[];
  /** Copy when there are no lines: nothing at all, or nothing matching the filter. */
  emptyKey: MessageKey | null;
}

export function activityView(s: State, me: Id, projectId: Id, f: StreamFilter, t: T, fmtDay: FmtDay): ActivityView {
  const items = streamItems(s, me, projectId, f);
  const lines = items.map((i: StreamItem): ActivityLine =>
    i.type === 'work' ? { type: 'work', key: i.row.w.id, card: activityCard(s, projectId, i.row, fmtDay) } : { type: 'sys', key: `sys-${i.rename.seq}`, text: sysLine(s, i.rename, t, fmtDay) },
  );
  if (lines.length > 0) return { lines, emptyKey: null };
  const any = streamItems(s, me, projectId, { kind: 'all', needId: null }).length > 0;
  return { lines, emptyKey: any ? 'stream.noMatch' : 'stream.empty' };
}
