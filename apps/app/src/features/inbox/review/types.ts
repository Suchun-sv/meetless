/**
 * The inbox review's shapes, per S's inbox API (2026-11-28): the item and routing details A3's
 * `features/inbox/model/api.ts` leaves loose. Read through `reviewOf(material)`.
 */
export type IsoDate = string;

export interface InboxItem {
  id: string;
  type: 'need' | 'hyp' | 'rev';
  text: string;
  quote?: string | null;
  page?: number | null;
  due?: IsoDate | null;
  /** Per-item routing: null = the new project. */
  projectId?: string | null;
  /** The same thing as an existing need: offer 合并到. */
  duplicateOf?: string | null;
  conflict?: { needId: string; field: 'due'; old: IsoDate; new: IsoDate } | null;
  revNeedId?: string | null;
  /** The suggested project has no deadline on this item's date: committing with `createRound` makes one (S, 2026-11-28). */
  createsRound?: { due: IsoDate; title: string } | null;
}

export interface RoutingCandidate {
  projectId: string;
  reason: string;
  reasonBold?: string[];
  roundId?: string | null;
}

export interface NewProjectSuggestion {
  name: string;
  reason?: string;
  firstRound?: { title: string; due: IsoDate; quote?: string | null } | null;
  template?: string | null;
}

export interface Routing {
  candidates: RoutingCandidate[];
  newProject?: NewProjectSuggestion | null;
}

/** The fields of an inbox material the review reads. */
export interface ReviewMaterial {
  id: string;
  kind: string;
  title: string;
  source: string;
  /** When it came in (S: `addedAt`; `at` in A3's first draft). */
  addedAt?: string;
  at?: string;
  status: 'analyzing' | 'ready' | 'committed' | 'empty' | 'failed';
  pages?: number | null;
  summary?: string | null;
  due?: { date: IsoDate; quote: string } | null;
  items: InboxItem[];
  routing: Routing | null;
  projectIds?: string[];
  error?: { code: string; message: string } | null;
  committed?: { batchId: string; at: string; projectIds: string[]; created: number; merged: number; changedDue: number; undoUntil: string } | null;
}

/** A3's material, read as the review's shape (its item and routing types are loose on purpose). */
export function reviewOf(m: unknown): ReviewMaterial {
  return m as ReviewMaterial;
}

/** S's commit body. */
export interface CommitBody {
  items: {
    itemId: string;
    action: 'accept' | 'merge' | 'skip';
    target: { projectId: string } | { newProject: true };
    due?: IsoDate | null;
    mergeInto?: string;
    conflict?: 'keep' | 'apply';
    /** Make the item's `createsRound` deadline; otherwise it goes under the current one. */
    createRound?: boolean;
  }[];
  newProject?: { name: string; firstRound: { title: string; due: IsoDate } | null; template: string | null };
}

export interface CommitResult {
  batchId: string;
  projectIds: string[];
  created: number;
  merged: number;
  changedDue: number;
  /** Existing needs revised by the material (S, 2026-11-28). */
  revised?: number;
  undoUntil: string;
}

/** Materials made from a project's own pending items (`input:` / `proposal:`): their items stay in that project. */
export function fixedProject(m: ReviewMaterial): boolean {
  return m.id.startsWith('input:') || m.id.startsWith('proposal:');
}
