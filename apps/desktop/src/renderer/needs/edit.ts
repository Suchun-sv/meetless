/**
 * Pure payload builders for need edits (contract §2, "need edits"): creating a brand-new need
 * (the prototype has no such form, but a new user starts from an empty board, design §6's last
 * row), revising one, setting its status (with a hypothesis's verdict) and changing its owner
 * or round. `NewNeedModal` and `DrawerEdit` submit from these; the drawer's rule-filled round
 * fix (Task 5) also switches to `roundCommand`.
 */
import type { Id, IsoDate, Need, NeedKind, NeedSource, NeedStatus } from '@meetless/core';
import type { Cmd } from '../collab/model';

export interface NewNeedForm {
  kind: NeedKind;
  title: string;
  accept: string;
  expect: string;
  verify: string;
  roundId: Id | null;
  private: boolean;
}

/**
 * `need.created`'s payload for a brand-new need: null while the title is blank. The source is a
 * manual doc entry quoting the title itself, with `ref` the caller's `nn.manual` label. An
 * external need's `accept` falls back to the title when left blank; a hypothesis carries
 * `expect` and `verify` instead, null when left blank (never an empty string). `private` is
 * passed through as given.
 */
export function newNeedCommand(f: NewNeedForm, projectId: Id, needId: Id, today: IsoDate, ref: string): Cmd<'need.created'> | null {
  const title = f.title.trim();
  if (!title) return null;
  const source: NeedSource = { src: 'doc', date: today, quote: title, ref };
  const base = { needId, projectId, kind: f.kind, title, roundId: f.roundId, source, private: f.private };
  return {
    type: 'need.created',
    payload:
      f.kind === 'ext' ? { ...base, accept: f.accept.trim() || title } : { ...base, expect: f.expect.trim() || null, verify: f.verify.trim() || null },
  };
}

/** `need.revised`'s payload: null while the new wording or the reason is blank. */
export function reviseCommand(n: Need, text: string, why: string, revisionId: Id, today: IsoDate): Cmd<'need.revised'> | null {
  const t = text.trim();
  const w = why.trim();
  if (!t || !w) return null;
  return { type: 'need.revised', payload: { needId: n.id, revisionId, text: t, why: w, date: today } };
}

/** `need.status_set`'s payload: `verdict` travels only for a hypothesis (core rejects it otherwise). */
export function statusCommand(n: Need, status: NeedStatus, verdict?: string): Cmd<'need.status_set'> {
  if (n.kind !== 'hyp') return { type: 'need.status_set', payload: { needId: n.id, status } };
  const v = verdict?.trim();
  return { type: 'need.status_set', payload: { needId: n.id, status, verdict: v ? v : null } };
}

/** `need.updated`'s payload for a new owner (or none). */
export function ownerCommand(n: Need, ownerId: Id | null): Cmd<'need.updated'> {
  return { type: 'need.updated', payload: { needId: n.id, ownerId } };
}

/** `need.updated`'s payload for a new round (or none); the drawer's rule-filled round fix submits from this. */
export function roundCommand(n: Need, roundId: Id | null): Cmd<'need.updated'> {
  return { type: 'need.updated', payload: { needId: n.id, roundId } };
}

/**
 * Whether `n`'s status or verdict actually differs from `status`/`verdict`: `DrawerEdit`'s
 * verdict field submits on blur, and skips the submit entirely when neither changed (no point
 * re-sending a `need.status_set` that would be a no-op).
 */
export function statusChanged(n: Need, status: NeedStatus, verdict: string): boolean {
  return status !== n.status || verdict.trim() !== (n.verdict ?? '');
}
