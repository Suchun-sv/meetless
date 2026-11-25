/**
 * U3-owned. A hand-built core `State` for the capture tests: project `p1`
 * with members `u-alex` and `u-lin`, shared needs N1/N2/N3 (N3 closed) and
 * Alex's private need Np1, plus three artifacts (a shared docx with one
 * version, Alex's private pptx, and a shared code artifact).
 */
import { applyEvent, emptyState, type DomainEvent, type EventPayloads, type EventType, type Id, type State } from '@meetless/core';
import type { Artifact } from '@meetless/core';
import type { CommandInput } from '../../src/bridge';
import type { CaptureRecord } from '../../src/capture/plan';

let seqCounter = 0;

function envelope<K extends EventType>(actorId: Id, type: K, payload: EventPayloads[K]): DomainEvent {
  seqCounter += 1;
  return { seq: seqCounter, id: `fx${seqCounter}`, type, actorId, recordedAt: '2026-11-24T09:00:00Z', payload } as DomainEvent;
}

function put<K extends EventType>(st: State, actorId: Id, type: K, payload: EventPayloads[K]): State {
  return applyEvent(st, envelope(actorId, type, payload));
}

/** Converts a client `CommandInput` into a `DomainEvent` and applies it, as the server would record it. */
export function apply(st: State, actorId: Id, cmd: CommandInput): State {
  return put(st, actorId, cmd.type, cmd.payload);
}

function source() {
  return { src: 'chat' as const, date: '2026-11-20', quote: '', ref: 'fixture' };
}

export const vid = 'v-doc1';

function build(): State {
  let st = emptyState();
  st = put(st, 'system', 'user.registered', { userId: 'u-alex', displayName: 'Alex', locale: 'en' });
  st = put(st, 'system', 'user.registered', { userId: 'u-lin', displayName: 'Lin', locale: 'en' });
  st = put(st, 'u-alex', 'project.created', { projectId: 'p1', name: 'Paper' });
  st = put(st, 'u-alex', 'project.member_added', { projectId: 'p1', userId: 'u-lin' });

  // N1
  st = put(st, 'u-alex', 'need.created', { needId: 'n-exportfilter', projectId: 'p1', kind: 'ext', title: 'export date range filter', roundId: null, source: source() });
  // N2
  st = put(st, 'u-alex', 'need.created', { needId: 'n-groupmonth', projectId: 'p1', kind: 'ext', title: 'group by month', roundId: null, source: source() });
  // N3 (met: closed, never a capture candidate)
  st = put(st, 'u-alex', 'need.created', { needId: 'n-legacy', projectId: 'p1', kind: 'ext', title: 'legacy export', roundId: null, status: 'met', source: source() });
  // Np1 (Alex's private need)
  st = put(st, 'u-alex', 'need.created', { needId: 'n-secret', projectId: 'p1', kind: 'ext', title: 'secret latency trick', roundId: null, private: true, source: source() });

  // a-doc: shared docx, one version with a note and two derived text blocks
  st = put(st, 'u-alex', 'artifact.created', { artifactId: 'a-doc', projectId: 'p1', kind: 'docx', title: 'Design doc', where: 'Upload', needIds: [] });
  st = put(st, 'u-alex', 'artifact.version_added', { artifactId: 'a-doc', versionId: vid, label: 'v1', date: '2026-11-21', note: 'intro notes' });
  st = put(st, 'system', 'artifactVersion.derived', {
    artifactId: 'a-doc',
    versionId: vid,
    status: 'ready',
    pageHashes: [],
    texts: ['N2 monthly totals', 'intro'],
    error: null,
    converter: 'libreoffice',
  });

  // a-priv: Alex's private pptx, no versions needed for the planning tests
  st = put(st, 'u-alex', 'artifact.created', { artifactId: 'a-priv', projectId: 'p1', kind: 'pptx', title: 'Private deck', where: 'Upload', needIds: [], private: true });

  // a-code: shared code artifact (unbound by default; service tests bind it to a real repo)
  st = put(st, 'u-alex', 'artifact.created', { artifactId: 'a-code', projectId: 'p1', kind: 'code', title: 'Repo', where: 'Local', needIds: [] });

  // a-ov: shared Overleaf artifact (no url by default; T2 tests set a real url per test, since the
  // test bare repo's path is only known once it is created at test time).
  st = put(st, 'u-alex', 'artifact.created', { artifactId: 'a-ov', projectId: 'p1', kind: 'overleaf', title: 'Paper on Overleaf', where: 'Overleaf', url: null, needIds: [] });

  return st;
}

export const s = build();

export function a(artifactId: Id): Artifact {
  const found = s.artifacts[artifactId];
  if (!found) throw new Error(`fixture has no artifact ${artifactId}`);
  return found;
}

export function id(code: string): Id {
  const n = Object.values(s.needs).find((x) => x.code === code);
  if (!n) throw new Error(`fixture has no need with code ${code}`);
  return n.id;
}

/** One `CaptureRecord` per candidate list, each with its own key (never deduped against each other). */
export function recs(...candidateLists: string[][]): CaptureRecord[] {
  return candidateLists.map((candidates, i) => ({ key: `r${i}`, src: 'commit' as const, date: '2026-11-20', label: `r${i}`, candidates }));
}

/** 40 distinct records that all name `code` (over `MAX_CAPTURES_PER_RUN`), to test the per-run cap. */
export function forty(code: string): CaptureRecord[] {
  return Array.from({ length: 40 }, (_, i) => ({ key: `k${i}`, src: 'commit' as const, date: '2026-11-20', label: `k${i}`, candidates: [`${code} item ${i}`] }));
}
