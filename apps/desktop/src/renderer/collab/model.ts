/**
 * Pure derived data for handoffs and shareable links (contract §2): the handoff state view
 * and commands, due-date choices, people grouping for the handoff/link modals, the handoff
 * creation payload, the agent prompt text and the link preview. No React, but it reads
 * `@meetless/i18n` for the labels a handoff link resolves to and the prompt copy. Tasks
 * 6-10 (handoff block, link modal, handoff modal, To-confirm panel) render and submit from
 * this.
 */
import {
  handoffStaleness,
  lastFetchedVersion,
  needContext,
  refreshPending,
  rolesOf,
  shareableView,
  type EventPayloads,
  type EventType,
  type Handoff,
  type HandoffFetch,
  type Id,
  type IsoDate,
  type Need,
  type NeedContext,
  type Round,
  type Staleness,
  type State,
} from '@meetless/core';
import { contextLabels, type Locale, type MessageKey, type Params } from '@meetless/i18n';

/** A typed command: Tasks 6-10 call `submit(c.type, c.payload)` with one of these. */
export type Cmd<K extends EventType = EventType> = { [T in K]: { type: T; payload: EventPayloads[T] } }[K];

export type HandoffAction = 'accept' | 'ask' | 'decline' | 'start' | 'copy' | 'return' | 'confirm' | 'reopen' | 'remind' | 'decide';

export interface HandoffView {
  role: 'sender' | 'recipient' | 'other';
  actions: HandoffAction[];
  stale: Staleness | null;
  refresh: number | null;
  lastFetch: HandoffFetch | null;
  note: string | null;
  decision: boolean;
}

/** An ordinary (non-decision) handoff's recipient actions, by state; everything else offers none. */
const RECIPIENT_ACTIONS: Partial<Record<Handoff['state'], HandoffAction[]>> = {
  sent: ['accept', 'ask', 'decline'],
  asked: ['accept', 'decline'],
  accepted: ['start', 'copy', 'return'],
  doing: ['copy', 'return'],
};

function ordinaryActions(h: Handoff, role: HandoffView['role'], stale: Staleness | null): HandoffAction[] {
  if (role === 'recipient') return RECIPIENT_ACTIONS[h.state] ?? [];
  if (role !== 'sender') return [];
  if (h.state === 'returned') return ['confirm', 'reopen'];
  return stale && !stale.reminded ? ['remind'] : [];
}

/**
 * A conflict decision (`h.conflictId` set) replaces the ordinary state machine with a single
 * `decide` action, offered to the recipient only while the conflict is unresolved and the
 * handoff itself is not done or declined. Core closes the delegating handoff as done when the
 * delegate resolves the conflict (contract 12.11 I1); the conflict check also covers a conflict
 * resolved by its owner instead.
 */
function decisionActions(s: State, h: Handoff, role: HandoffView['role']): HandoffAction[] {
  if (role !== 'recipient') return [];
  const conflict = h.conflictId ? s.conflicts[h.conflictId] : undefined;
  const unresolved = conflict ? conflict.status !== 'resolved' : false;
  const live = h.state !== 'done' && h.state !== 'declined';
  return unresolved && live ? ['decide'] : [];
}

/**
 * The handoff as `me` sees it: role, the actions on offer now, the recipient's staleness and
 * pending-refresh facts, the last context fetch, the latest history note and whether this is
 * a conflict decision.
 */
export function handoffView(s: State, h: Handoff, me: Id): HandoffView {
  const role: HandoffView['role'] = h.fromId === me ? 'sender' : h.toId === me ? 'recipient' : 'other';
  const stale = handoffStaleness(s, h);
  const refresh = role === 'recipient' ? refreshPending(h) : null;
  const lastFetch = lastFetchedVersion(h) === null ? null : h.fetches[h.fetches.length - 1]!;
  const note = h.history.length ? h.history[h.history.length - 1]!.note : null;
  const decision = h.conflictId !== null;
  const actions = role === 'other' ? [] : decision ? decisionActions(s, h, role) : ordinaryActions(h, role, stale);
  return { role, actions, stale, refresh, lastFetch, note, decision };
}

/**
 * Builds the command for a plain (non-decision, non-`copy`) handoff action. `note` carries the
 * `ask` note, the return note or the mandatory reopen note; it is ignored otherwise.
 */
export function handoffCommand(a: 'accept' | 'ask' | 'decline' | 'start' | 'return' | 'confirm' | 'reopen' | 'remind', h: Handoff, note?: string): Cmd {
  switch (a) {
    case 'accept':
      return { type: 'handoff.responded', payload: { handoffId: h.id, response: 'accepted' } };
    case 'ask':
      return { type: 'handoff.responded', payload: note === undefined ? { handoffId: h.id, response: 'asked' } : { handoffId: h.id, response: 'asked', note } };
    case 'decline':
      return { type: 'handoff.responded', payload: { handoffId: h.id, response: 'declined' } };
    case 'start':
      return { type: 'handoff.started', payload: { handoffId: h.id } };
    case 'return':
      return { type: 'handoff.returned', payload: note === undefined ? { handoffId: h.id } : { handoffId: h.id, note } };
    case 'confirm':
      return { type: 'handoff.confirmed', payload: { handoffId: h.id } };
    case 'reopen':
      return { type: 'handoff.reopened', payload: { handoffId: h.id, note: note ?? '' } };
    case 'remind':
      return { type: 'handoff.refresh_requested', payload: { handoffId: h.id } };
  }
}

export interface DueChoice {
  key: 'week' | 'next' | 'round';
  date: IsoDate;
}

/** Parses a `YYYY-MM-DD` business date as a UTC midnight instant; never the local time zone. */
function toUTC(date: IsoDate): Date {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUTC(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

/** A round's own deadline as a due date: only while the round is not delivered and the deadline has not passed. */
export function roundDue(round: Round | null, today: IsoDate): IsoDate | null {
  return round && round.status !== 'delivered' && round.due >= today ? round.due : null;
}

/**
 * Due-date choices for a new handoff: `week` is the first Friday on or after `today`, `next`
 * is the Friday after that, and `round` is the current round's own deadline (`roundDue`).
 */
export function dueChoices(today: IsoDate, round: Round | null): DueChoice[] {
  const t = toUTC(today);
  const toFriday = (5 - t.getUTCDay() + 7) % 7;
  const week = new Date(t);
  week.setUTCDate(week.getUTCDate() + toFriday);
  const next = new Date(week);
  next.setUTCDate(next.getUTCDate() + 7);
  const choices: DueChoice[] = [
    { key: 'week', date: fromUTC(week) },
    { key: 'next', date: fromUTC(next) },
  ];
  const due = roundDue(round, today);
  if (due !== null) choices.push({ key: 'round', date: due });
  return choices;
}

export interface PeopleGroup {
  roleName: string | null;
  memberIds: Id[];
}

/**
 * Who a handoff or link can go to, grouped by role in `rolesOf` order. A member who holds
 * more than one role is listed once, under the first; role-less members land in the trailing
 * `roleName: null` group `rolesOf` already appends. `me` never appears, and a group left
 * empty by that filtering is dropped.
 */
export function handoffPeople(s: State, projectId: Id, me: Id): PeopleGroup[] {
  const seen = new Set<Id>([me]);
  const groups: PeopleGroup[] = [];
  for (const r of rolesOf(s, projectId)) {
    const memberIds = r.memberIds.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (memberIds.length) groups.push({ roleName: r.name, memberIds });
  }
  return groups;
}

/** The `handoff.created` payload for a new handoff; an empty ask falls back to the need's title. */
export function handoffPayload(i: { handoffId: Id; projectId: Id; need: Need; toId: Id; ask: string; due: IsoDate | null }): EventPayloads['handoff.created'] {
  const ask = i.ask.trim();
  return { handoffId: i.handoffId, projectId: i.projectId, needId: i.need.id, toId: i.toId, ask: ask === '' ? i.need.title : ask, due: i.due };
}

/** The text pasted into an agent: first read the link, then follow what it asks. */
export function promptText(t: (k: MessageKey, p?: Params) => string, link: string): string {
  return `${t('lk.prompt1', { url: link })}\n${t('lk.prompt2')}`;
}

/**
 * The context a handoff link resolves to, built from the shareable view only — so it is null
 * for a private need (even for its own owner, since a shareable view has no private items at
 * all) and for a need not otherwise visible in `live`.
 */
export function linkPreview(live: State, needId: Id, locale: Locale): NeedContext | null {
  const view = shareableView(live);
  if (!view.needs[needId]) return null;
  return needContext(view, needId, contextLabels(locale));
}
