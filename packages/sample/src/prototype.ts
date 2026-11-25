import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

/**
 * The UI prototype's simulated data (design/claude-design-v3), read as the
 * prototype itself reads it: each file runs against a bare `window`.
 * Only the fields the sample builder uses are typed.
 */

/** A prototype text: one string per language, or a string used as is. */
export type Txt = string | { 'zh-CN': string; en: string };

export interface ProtoSource {
  src: string;
  date: string;
  quote: Txt;
  ref: Txt;
}

export interface ProtoRound {
  n: number;
  title: Txt;
  kind: 'hard' | 'cadence';
  start: string;
  due: string;
  status: 'delivered' | 'current' | 'planned';
  delivery?: { draft?: boolean; items: Txt[]; account: { need: string; v: string; note: Txt }[] };
}

export interface ProtoNeed {
  id: string;
  kind: 'ext' | 'hyp';
  round: number;
  status: string;
  by?: string;
  parent?: string;
  fromRound?: number;
  title: Txt;
  accept?: Txt;
  expect?: Txt;
  verify?: Txt;
  verdict?: Txt;
  revisions?: { date: string; text: Txt; why: Txt }[];
  source: ProtoSource;
  private?: boolean;
}

export interface ProtoWork {
  id: string;
  src: string;
  date: string;
  text: Txt;
  need: string | null;
  ef: string | null;
  res?: 'keep' | 'revert';
  why?: Txt;
  extra?: string;
  by?: string;
}

export interface ProtoProject {
  id: string;
  name: Txt;
  kindLabel: Txt;
  start: string;
  end: string;
  today: string;
  people: Record<string, Txt>;
  rounds: ProtoRound[];
  needs: ProtoNeed[];
  work: ProtoWork[];
}

export interface ProtoExtract {
  id: string;
  type: 'new' | 'hyp' | 'rev' | 'action';
  need?: string;
  state?: 'accepted' | 'ignored';
  text: Txt;
  accept?: Txt;
  expect?: Txt;
  verify?: Txt;
}

export interface ProtoInput {
  id: string;
  kind: 'md' | 'txt' | 'docx' | 'pdf';
  title: Txt;
  from: string;
  date: string;
  body: { p: Txt; x?: string }[];
  extracts: ProtoExtract[];
}

export interface ProtoArtifact {
  id: string;
  kind: string;
  title: Txt;
  where: string;
  needs: string[];
  /** Newest first. */
  versions: { v: Txt; date: string; round: number; note: Txt }[];
}

export interface ProtoExtra {
  inputs: ProtoInput[];
  artifacts: ProtoArtifact[];
  work: ProtoWork[];
}

export interface ProtoHandoff {
  id: string;
  need: string;
  from: string;
  to: string;
  state: 'sent' | 'accepted' | 'doing';
  date: string;
  due: string;
  fetched?: { v: number; at: string };
  ask: Txt;
}

export interface ProtoCollab {
  roles: { id: string; name: Txt; members: string[] }[];
  owners: Record<string, string>;
  handoffs: ProtoHandoff[];
  work: ProtoWork[];
  needs: ProtoNeed[];
  questions: { id: string; conflict?: { need: string; src: Txt } }[];
}

export interface PrototypeData {
  projects: ProtoProject[];
  /** Keyed by prototype project id ('paper', 'team'). */
  extra: Record<string, ProtoExtra>;
  collab: Record<string, ProtoCollab>;
}

export const PROTOTYPE_FILES = [
  'design/claude-design-v3/needs/data-paper.js',
  'design/claude-design-v3/needs/data-extra.js',
  'design/claude-design-v3/needs3/data-team.js',
  'design/claude-design-v3/needs3/data-collab.js',
] as const;

const RUN_TIMEOUT_MS = 2000;

/**
 * Runs the prototype data files in `node:vm` with `window = {}` and returns what they put on it.
 * No host object enters the context: `window` is created inside it, and the result leaves it as a JSON string.
 */
export function loadPrototype(repoRoot: string): PrototypeData {
  const ctx = createContext(Object.create(null) as object);
  runInContext('globalThis.window = {};', ctx, { timeout: RUN_TIMEOUT_MS });
  for (const f of PROTOTYPE_FILES) runInContext(readFileSync(join(repoRoot, f), 'utf8'), ctx, { filename: f, timeout: RUN_TIMEOUT_MS });
  const json: unknown = runInContext('JSON.stringify({ projects: window.NeedsProjects, extra: window.NeedsExtra, collab: window.NeedsCollab })', ctx, {
    timeout: RUN_TIMEOUT_MS,
  });
  if (typeof json !== 'string') throw new Error(`prototype data under ${repoRoot} did not serialise`);
  const plain = JSON.parse(json) as PrototypeData;
  if (!Array.isArray(plain.projects) || !plain.extra || !plain.collab) throw new Error(`prototype data incomplete under ${repoRoot}`);
  return plain;
}
