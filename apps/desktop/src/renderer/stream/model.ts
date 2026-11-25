import { isProgress, projectNeeds, projectWork, type Id, type Need, type ProjectRename, type State, type WorkItem } from '@meetless/core';

/**
 * Activity stream model (contract §8, task 9 brief). Pure helpers over `State`; no React.
 *
 * - `streamKind`: a capture wins the label even when `w.via` is also set, because a capture
 *   never counts as progress (`isProgress`) while an agent report (`w.via` set, service-only)
 *   always does; else an agent report; else logged by a person.
 * - Rows drop ignored work and sort newest first (`date` desc, then `seq` desc, so same-day work
 *   keeps recording order reversed).
 * - A work item's `needId`/`alsoNeedId` may point at a need the current viewer's state does not
 *   hold (contract §12.9, known limitation R37: shared work may still carry the id of an item
 *   that is not reachable to this viewer). The model never dereferences those ids; it is up to
 *   the row renderer to check `live.needs` before showing a chip, so a missing id renders
 *   nothing, never a crash and never a bare code.
 */

export type StreamKind = 'agent' | 'manual' | 'capture';

/** Capture wins the label (never progress); else an agent report (`via` set, service-only); else logged by a person. */
export function streamKind(w: WorkItem): StreamKind {
  if (w.capture) return 'capture';
  if (w.via) return 'agent';
  return 'manual';
}

export interface StreamFilter {
  kind: StreamKind | 'all';
  needId: Id | null;
}

export interface StreamRowData {
  w: WorkItem;
  kind: StreamKind;
  progress: boolean;
  unlinked: boolean;
  askable: boolean;
  rules: boolean;
  mine: boolean;
}

function toRow(w: WorkItem, me: Id): StreamRowData {
  return {
    w,
    kind: streamKind(w),
    progress: isProgress(w),
    unlinked: w.needId === null,
    askable: w.needId === null && w.by === me,
    rules: w.autoLinked,
    mine: w.privateTo === me,
  };
}

/**
 * The project's non-ignored work, filtered by kind and by need (`needId` matches either
 * `needId` or `alsoNeedId`), newest first by date then by `seq`.
 */
export function streamRows(s: State, me: Id, projectId: Id, f: StreamFilter): StreamRowData[] {
  return projectWork(s, projectId)
    .filter((w) => !w.ignored)
    .filter((w) => f.kind === 'all' || streamKind(w) === f.kind)
    .filter((w) => f.needId === null || w.needId === f.needId || w.alsoNeedId === f.needId)
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.seq - a.seq))
    .map((w) => toRow(w, me));
}

/** Needs with at least one non-ignored work item (as `needId` or `alsoNeedId`), sorted by code. */
export function streamNeedOptions(s: State, projectId: Id): Need[] {
  const ids = new Set<Id>();
  for (const w of projectWork(s, projectId)) {
    if (w.ignored) continue;
    if (w.needId) ids.add(w.needId);
    if (w.alsoNeedId) ids.add(w.alsoNeedId);
  }
  return projectNeeds(s, projectId)
    .filter((n) => ids.has(n.id))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/** The project's renames (`Project.renames`, contract 12.23), newest first: Activity shows each as a system line. */
export function streamSystemRows(s: State, projectId: Id): ProjectRename[] {
  return [...(s.projects[projectId]?.renames ?? [])].sort((a, b) => b.seq - a.seq);
}

/** One Activity line: a work row, or a system line for a rename. */
export type StreamItem = { type: 'work'; row: StreamRowData } | { type: 'sys'; rename: ProjectRename };

const itemDate = (i: StreamItem) => (i.type === 'work' ? i.row.w.date : i.rename.at.slice(0, 10));
const itemSeq = (i: StreamItem) => (i.type === 'work' ? i.row.w.seq : i.rename.seq);

/**
 * `streamRows` plus the rename system lines, newest first by date then by seq. System lines
 * belong to no kind and no need, so a kind or need filter leaves them out.
 */
export function streamItems(s: State, me: Id, projectId: Id, f: StreamFilter): StreamItem[] {
  const work: StreamItem[] = streamRows(s, me, projectId, f).map((row) => ({ type: 'work', row }));
  if (f.kind !== 'all' || f.needId !== null) return work;
  const sys: StreamItem[] = streamSystemRows(s, projectId).map((rename) => ({ type: 'sys', rename }));
  return [...work, ...sys].sort((a, b) => {
    const da = itemDate(a);
    const db = itemDate(b);
    return da !== db ? (da < db ? 1 : -1) : itemSeq(b) - itemSeq(a);
  });
}
