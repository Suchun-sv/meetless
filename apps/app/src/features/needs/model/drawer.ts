/**
 * The need detail's view model: header, handoffs, source, details, revisions, activity (captures
 * are read-only reference rows), artifacts and children. Pure, no React or i18n.
 */
import {
  needVersion,
  toConfirm,
  type Artifact,
  type Handoff,
  type Id,
  type IsoDate,
  type Need,
  type NeedSource,
  type Revision,
  type Round,
  type State,
  type WorkItem,
} from '@meetless/core';
import { childrenOf, drawerWork, liveHandoffs, needArtifacts, pendingNeedIds, requesterFacts, shownHandoff, type CardFacts } from '../../../../../desktop/src/renderer/needs/model';
import { EF_TONE } from '../../../../../desktop/src/renderer/ui/tone';
import { statusTone, type Tone } from './board';

export interface WorkRowVM {
  w: WorkItem;
  /** A project-agent capture: reference only, shown with `cap.label`, no effect, no actions. */
  capture: boolean;
  effectTone: Tone | null;
  resultTone: Tone | null;
}

export interface DrawerVM {
  need: Need;
  tone: Tone;
  private: boolean;
  version: number;
  /** How many To-confirm items wait on this need (`dr.pending`), 0 = no line. */
  pendingCount: number;
  /** One block per live handoff, newest first; with none live, the latest closed one. */
  handoffs: Handoff[];
  source: NeedSource;
  requester: CardFacts['requester'];
  round: Round | null;
  /** The round came from the rule (`RulesMark` with its fix). */
  autoRound: boolean;
  parent: Need | null;
  fields: { kind: 'ext'; accept: string | null } | { kind: 'hyp'; expect: string | null; verify: string | null };
  revisions: Revision[];
  work: WorkRowVM[];
  artifacts: Artifact[];
  children: { need: Need; tone: Tone }[];
}

/** Null when the need is unknown or outside `projectId` (`dr.missing`). */
export function drawerVM(s: State, me: Id, projectId: Id, needId: Id, today: IsoDate): DrawerVM | null {
  const n = s.needs[needId];
  if (!n || n.projectId !== projectId) return null;
  const tc = toConfirm(s, me, projectId, today);
  const pendingCount = pendingNeedIds(tc).has(n.id)
    ? tc.conflicts.filter((c) => c.needId === n.id).length + tc.questions.filter((q) => q.kind === 'stale' && q.needId === n.id).length
    : 0;
  const liveOnes = liveHandoffs(s, n.id);
  const latest = shownHandoff(s, n.id);
  return {
    need: n,
    tone: statusTone(n.status),
    private: n.privateTo !== null,
    version: needVersion(n),
    pendingCount,
    handoffs: liveOnes.length > 0 ? liveOnes : latest ? [latest] : [],
    source: n.source,
    requester: requesterFacts(s, n, me),
    round: n.roundId ? s.rounds[n.roundId] ?? null : null,
    autoRound: n.autoRound,
    parent: n.parentId ? s.needs[n.parentId] ?? null : null,
    fields: n.kind === 'ext' ? { kind: 'ext', accept: n.accept } : { kind: 'hyp', expect: n.expect, verify: n.verify },
    revisions: n.revisions,
    work: drawerWork(s, n.id).map((w) => ({
      w,
      capture: w.capture,
      effectTone: !w.capture && w.effect ? EF_TONE[w.effect] : null,
      resultTone: w.result ? (w.result === 'keep' ? 'success' : 'muted') : null,
    })),
    artifacts: needArtifacts(s, n.id),
    children: childrenOf(s, n.id).map((k) => ({ need: k, tone: statusTone(k.status) })),
  };
}
