import type { SubmitResult } from '@meetless/client/bridge';
import {
  clip,
  inputStatus,
  membersOf,
  noDots,
  projectInputs,
  toParagraphs,
  type Extract,
  type ExtractType,
  type Id,
  type Input,
  type InputKind,
  type Requester,
  type State,
} from '@meetless/core';
import type { Tone } from '../ui/tone';

/**
 * Inputs page model (contract §8, task 8 brief). Pure helpers over `State`; no React. Detection
 * for an import runs on the server (`inputs.import`, contract §3/§10, task 12a); this file no
 * longer runs it locally.
 */

const EXT_FOR_KIND: Record<string, InputKind> = { md: 'md', markdown: 'md', txt: 'txt', docx: 'docx', pdf: 'pdf' };

/** Maps a file name's extension to an input kind, case-insensitively; anything else is null. */
export function kindFromName(name: string): InputKind | null {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name.trim());
  if (!m) return null;
  return EXT_FOR_KIND[m[1]!.toLowerCase()] ?? null;
}

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/** UTF-8 decode, BOM stripped, CRLF turned into LF. */
export function decodeText(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8').decode(bytes);
  const noBom = text.length > 0 && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return noBom.replace(/\r\n/g, '\n');
}

/** The trimmed title, or the first `toParagraphs` line clipped to 30 characters; always ends in one `.md`. */
export function mdTitle(title: string, text: string): string {
  const trimmed = title.trim();
  const base = trimmed || clip(toParagraphs(text)[0]?.text ?? '', 30);
  return base.toLowerCase().endsWith('.md') ? base : `${base}.md`;
}

/** Empty text gives null; a case-insensitive match on a member's displayName gives `{ userId }`; else `{ name }`. */
export function requesterFrom(s: State, projectId: Id, text: string): Requester | null {
  const name = text.trim();
  if (!name) return null;
  const member = membersOf(s, projectId).find((id) => (s.users[id]?.displayName ?? '').toLowerCase() === name.toLowerCase());
  return member ? { userId: member } : { name };
}

/**
 * A requester as a display string, or null when there is none. Through `noDots`: a member's
 * displayName is trusted, but a free-typed name (`from.name`, e.g. the Markdown modal's `md-from`)
 * is user text and must never put a dot on screen (fix round 1, Important 2).
 */
export function requesterLabel(s: State, r: Requester | null | undefined): string | null {
  if (!r) return null;
  if (r.userId) return noDots(s.users[r.userId]?.displayName ?? r.userId);
  return r.name ? noDots(r.name) : null;
}

export function inputGroups(s: State, projectId: Id): { pending: Input[]; done: Input[] } {
  const list = projectInputs(s, projectId);
  return {
    pending: list.filter((i) => inputStatus(i) === 'pending'),
    done: list.filter((i) => inputStatus(i) === 'done'),
  };
}

/** The focused input, else the first pending one, else the first of the list. */
export function selectedInput(s: State, projectId: Id, focusId: Id | null | undefined): Input | null {
  const list = projectInputs(s, projectId);
  if (focusId) {
    const found = list.find((i) => i.id === focusId);
    if (found) return found;
  }
  const pending = list.find((i) => inputStatus(i) === 'pending');
  return pending ?? list[0] ?? null;
}

/** Paragraph id -> the extract that points at it, for hover sync between the sheet and the extract panel. */
export function paraExtract(input: Input): Record<Id, Id> {
  const map: Record<Id, Id> = {};
  for (const x of input.extracts) if (x.paraId) map[x.paraId] = x.id;
  return map;
}

export const EXTRACT_TONE: Record<ExtractType, Tone> = { new: 'strong', hyp: 'info', rev: 'warning', action: 'neutral' };

/** An undecided conflict on a shared input must be decided in To confirm, never accepted here directly. */
export function extractAction(input: Input, x: Extract): 'decide' | 'open' | 'accepted' | 'ignored' {
  if (x.state === 'accepted') return 'accepted';
  if (x.state === 'ignored') return 'ignored';
  if (x.conflict && input.privateTo === null) return 'decide';
  return 'open';
}

/**
 * The private needs an `input.shared` rejection (`PRIVATE_ITEM`) named, so the UI can offer
 * `common.sharePrivateNeedFirst` (contract 12.22, ruling R14): share each of them, then the input.
 * Any other result (accepted, queued, or a different code) gives null.
 */
export function sharePrivateNeedIds(r: SubmitResult): Id[] | null {
  if (r.kind !== 'rejected' || r.code !== 'PRIVATE_ITEM') return null;
  const details = r.details as { needIds?: Id[] } | undefined;
  return details?.needIds ?? null;
}

/** A recorded `input.shared` refusal, tagged with the input it belongs to. */
export interface BlockedShare {
  inputId: Id;
  needIds: Id[];
}

/**
 * The blocked need ids for `inputId`, or `null` when `blocked` belongs to a different input (fix
 * round 2, Important 1): a plain `useState<Id[] | null>` reset by a `useEffect` keyed on the
 * selected input's id is not enough, because React commits the render with the *new* `input` prop
 * before that effect runs — one render can show input B with input A's `in-share-needs-first`,
 * whose closure would then `need.shared` a need that has nothing to do with B. Tagging the
 * recorded refusal with its own input id and deriving the visible value from `(blocked, inputId)`
 * on every render makes the stale state impossible to render at all, not just short-lived: there
 * is no render in between where the mismatch could show.
 */
export function blockedFor(blocked: BlockedShare | null, inputId: Id | null | undefined): Id[] | null {
  return blocked && blocked.inputId === inputId ? blocked.needIds : null;
}

