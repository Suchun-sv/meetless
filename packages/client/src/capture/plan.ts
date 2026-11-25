/**
 * U3-owned. Turns raw text (a commit message, an uploaded version's note or
 * derived text block) into `work.recorded` commands, matching the project's
 * open needs with core's rule-based `matchNeed` (never a model call).
 */
import { createHash } from 'node:crypto';
import { clip, isOpen, matchNeed, noDots, projectNeeds, SEP, type Artifact, type Id, type IsoDate, type Need, type State } from '@meetless/core';
import type { CommandInput, CommitInfo } from '../bridge';
import { MAX_CAPTURES_PER_RUN } from './types';

export interface CaptureRecord {
  /** Stable per source: a full commit sha, or `v:<versionId>:note` / `v:<versionId>:b<i>`. */
  key: string;
  src: 'commit' | 'doc';
  date: IsoDate;
  label: string;
  /** Candidate texts tried in order; the first that matches a need wins. */
  candidates: string[];
}

/** `'cap-' + sha256(salt|artifactId|key|needId)` hex, first 24 characters. */
export function captureWorkId(salt: string, artifactId: Id, key: string, needId: Id): Id {
  const hex = createHash('sha256').update(`${salt}|${artifactId}|${key}|${needId}`).digest('hex');
  return `cap-${hex.slice(0, 24)}`;
}

/** One record from the version's note, and one per non-empty `derived.texts` block. */
export function versionRecords(a: Artifact): CaptureRecord[] {
  const out: CaptureRecord[] = [];
  for (const v of a.versions) {
    if (v.note.trim().length > 0) out.push({ key: `v:${v.id}:note`, src: 'doc', date: v.date, label: v.label, candidates: [v.note] });
    const texts = v.derived?.texts ?? [];
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i]!;
      if (t.trim().length > 0) out.push({ key: `v:${v.id}:b${i}`, src: 'doc', date: v.date, label: v.label, candidates: [t] });
    }
  }
  return out;
}

/** `extra[sha]` adds extra candidate texts (e.g. a diff summary) tried after the commit subject. */
export function commitRecords(commits: CommitInfo[], extra: Record<string, string[]> = {}): CaptureRecord[] {
  return commits.map((c) => ({
    key: c.commit,
    src: 'commit' as const,
    date: c.date.slice(0, 10),
    label: c.commit.slice(0, 7),
    candidates: [c.subject, ...(extra[c.commit] ?? [])],
  }));
}

/**
 * Builds one `work.recorded` command per (record, matched need). A record
 * with no matching candidate text is skipped entirely (nothing captured).
 * Deterministic and idempotent: `captureWorkId` means re-running produces the
 * same ids, and ids already in `s.work` are skipped.
 */
export function planCapture(s: State, me: Id, a: Artifact, records: CaptureRecord[], opts: { needId?: Id | null; max?: number } = {}): CommandInput<'work.recorded'>[] {
  let candidates: Need[];
  if (opts.needId != null) {
    // Only an open need of this artifact's own project: core refuses another project's need, and
    // a closed need takes no new captures.
    const n = s.needs[opts.needId];
    candidates = n && n.projectId === a.projectId && isOpen(n) ? [n] : [];
  } else {
    candidates = projectNeeds(s, a.projectId).filter(isOpen);
  }
  const max = opts.max ?? MAX_CAPTURES_PER_RUN;
  const out: CommandInput<'work.recorded'>[] = [];
  for (const r of records) {
    if (out.length >= max) break;
    let hit: { needId: Id; by: 'code' | 'keywords' } | null = null;
    let matchedText = '';
    for (const candidate of r.candidates) {
      const m = matchNeed(candidate, candidates);
      if (m) {
        hit = m;
        matchedText = candidate;
        break;
      }
    }
    if (!hit) continue;
    const need = s.needs[hit.needId];
    if (!need) continue;
    const isPrivate = a.privateTo !== null || need.privateTo !== null;
    const salt = isPrivate ? me : a.projectId;
    const workId = captureWorkId(salt, a.id, r.key, hit.needId);
    if (s.work[workId]) continue;
    out.push({
      id: workId,
      type: 'work.recorded',
      payload: {
        workId,
        projectId: a.projectId,
        needId: hit.needId,
        src: r.src,
        text: noDots(clip([a.title, r.label, matchedText].join(SEP), 200)),
        date: r.date,
        capture: true,
        autoLinked: true,
        private: isPrivate,
      },
    });
  }
  return out;
}
