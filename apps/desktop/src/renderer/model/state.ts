import { applyEvent, emptyState, isDomainError, orderBySeq, type DomainEvent, type Id, type Project, type State } from '@meetless/core';

export interface Replayed {
  state: State;
  /** Events the local replay could not apply (should be empty; shown as a diagnostic, never hidden). */
  skipped: DomainEvent[];
}

/** Replays server-accepted events, skipping (and reporting) any event this client cannot apply. */
export function safeReplay(events: readonly DomainEvent[], from: Replayed = { state: emptyState(), skipped: [] }): Replayed {
  let state = from.state;
  const skipped = [...from.skipped];
  for (const e of orderBySeq(events)) {
    if (e.seq <= state.lastSeq) continue;
    try {
      state = applyEvent(state, e);
    } catch (err) {
      if (!isDomainError(err)) throw err;
      skipped.push(e);
    }
  }
  return { state, skipped };
}

export function displayName(s: State, userId: Id): string {
  return s.users[userId]?.displayName ?? userId;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LETTER = /[\p{L}\p{N}]/u;

/**
 * What an avatar circle shows, one glyph as in the prototype, or two letters for a multi-word
 * Latin name: a name with CJK (Han, kana, hangul) gives its first CJK character (张老师: 张); one
 * Latin word gives its first letter, upper-case (Alex: A); several give the first and last word's
 * first letters (Ben Carter: BC). Words without a letter or digit (an emoji) are skipped; nothing
 * left gives "?".
 */
export function initials(name: string): string {
  const cjk = CJK.exec(name);
  if (cjk) return cjk[0];
  const firsts = name
    .trim()
    .split(/\s+/)
    .map((w) => [...w].find((c) => LETTER.test(c)))
    .filter((c): c is string => c !== undefined);
  if (firsts.length === 0) return '?';
  if (firsts.length === 1) return firsts[0]!.toUpperCase();
  return (firsts[0]! + firsts[firsts.length - 1]!).toUpperCase();
}

/** The projects the user is a member of, oldest first. */
export function myProjects(s: State, userId: Id, opts: { includeArchived?: boolean } = {}): Project[] {
  return Object.values(s.projects)
    .filter((p) => p.memberIds.includes(userId) && (opts.includeArchived === true || !p.archived))
    .sort((a, b) => a.createdSeq - b.createdSeq);
}
