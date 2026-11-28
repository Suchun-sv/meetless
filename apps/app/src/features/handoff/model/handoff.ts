import { noDots, SEP, userName, type Handoff, type Id, type IsoDate, type IsoTime, type Need, type State } from '@meetless/core';
import type { MessageKey, Translator } from '@meetless/i18n';
import { handoffPeople, handoffView, type HandoffAction, type HandoffView, type PeopleGroup } from '@renderer/collab/model';

// The handoff state machine, commands, due choices and people grouping are the desktop's own, unchanged.
export {
  dueChoices,
  handoffCommand,
  handoffPayload,
  handoffPeople,
  handoffView,
  roundDue,
  type Cmd,
  type DueChoice,
  type HandoffAction,
  type HandoffView,
  type PeopleGroup,
} from '@renderer/collab/model';
export { liveHandoffs, shownHandoff } from '@renderer/needs/model';

/** The one-line handoff label (desktop `HandoffLine`): who it is from or to, then its state. `hot` while it waits on me. */
export function handoffLine(t: Translator['t'], s: State, h: Handoff, me: Id): { text: string; hot: boolean } {
  const toMe = h.toId === me;
  const fromMe = h.fromId === me;
  const who = toMe
    ? t('ho.from', { who: noDots(userName(s, h.fromId)) })
    : fromMe
      ? t('ho.to', { who: noDots(userName(s, h.toId)) })
      : t('ho.fromTo', { from: noDots(userName(s, h.fromId)), to: noDots(userName(s, h.toId)) });
  return { text: who + SEP + t(`ho.st.${h.state}` as MessageKey), hot: toMe && h.state === 'sent' };
}

/** A status line of the handoff block. `tone` is a theme status tone; never violet (handoffs are not AI output). */
export interface BlockLine {
  text: string;
  tone: 'faint' | 'muted' | 'warning' | 'success';
}

/** The handoff block in the need detail (desktop `HandoffBlock`), as data. */
export interface HandoffBlockView {
  view: HandoffView;
  /** A recipient still deciding on a `sent` handoff: the block uses the info tone. */
  hot: boolean;
  /** The other person (avatar). */
  otherId: Id;
  line: { text: string; hot: boolean };
  due: string | null;
  ask: string;
  note: string | null;
  lines: BlockLine[];
  /** The staleness warning; `remind` when 「提醒刷新」 is on offer in it. */
  warn: { text: string; remind: boolean } | null;
  /** The action buttons, `remind` excluded (it lives in `warn`). */
  actions: Exclude<HandoffAction, 'remind'>[];
}

export function handoffBlock(
  t: Translator['t'],
  s: State,
  h: Handoff,
  me: Id,
  fmt: { day: (d: IsoDate) => string; dateTime: (at: IsoTime) => string },
): HandoffBlockView {
  const view = handoffView(s, h, me);
  const lines: BlockLine[] = [];
  let warn: HandoffBlockView['warn'] = null;
  if (view.role === 'sender') {
    if (view.lastFetch) lines.push({ text: t('ho.fetched', { v: view.lastFetch.version, at: fmt.dateTime(view.lastFetch.at) }), tone: 'faint' });
    else if (h.state === 'accepted' || h.state === 'doing') lines.push({ text: t('ho.notFetched'), tone: 'faint' });
    if (view.stale && !view.stale.reminded) warn = { text: t('ho.stale', { v: view.stale.current }), remind: view.actions.includes('remind') };
    if (view.stale?.reminded) lines.push({ text: `✓ ${t('ho.reminded')}`, tone: 'success' });
  } else if (view.role === 'recipient') {
    if (view.lastFetch) lines.push({ text: t('ho.myFetched', { v: view.lastFetch.version, at: fmt.dateTime(view.lastFetch.at) }), tone: 'faint' });
    if (view.refresh !== null) warn = { text: t('ho.refreshAsked', { who: noDots(userName(s, h.fromId)), v: view.refresh }), remind: false };
    if (h.state === 'returned') lines.push({ text: t('ho.onlySender'), tone: 'muted' });
  }
  return {
    view,
    hot: view.role === 'recipient' && h.state === 'sent',
    otherId: h.toId === me ? h.fromId : h.toId,
    line: handoffLine(t, s, h, me),
    due: h.due ? t('ho.dueOn', { d: fmt.day(h.due) }) : null,
    ask: h.ask,
    note: view.note ? t('ho.note', { note: view.note }) : null,
    lines,
    warn,
    actions: view.actions.filter((a): a is Exclude<HandoffAction, 'remind'> => a !== 'remind'),
  };
}

/** The note form under the block: `ask` (optional note) or `reopen` (a note is required). */
export function canSendNote(kind: 'ask' | 'reopen', note: string): boolean {
  return kind === 'ask' || note.trim() !== '';
}

/** The note to send: trimmed, or undefined when empty (an `ask` with no note). */
export function noteValue(note: string): string | undefined {
  const v = note.trim();
  return v === '' ? undefined : v;
}

/** The button label key for each block action. */
export const ACTION_LABEL: Record<Exclude<HandoffAction, 'remind'>, MessageKey> = {
  accept: 'ho.accept',
  ask: 'ho.question',
  decline: 'ho.decline',
  start: 'ho.start',
  copy: 'lk.btn',
  return: 'ho.return',
  confirm: 'ho.confirm',
  reopen: 'ho.reopen',
  decide: 'ho.decision',
};

/** The actions drawn as primary buttons. */
export const PRIMARY_ACTIONS: ReadonlySet<HandoffAction> = new Set<HandoffAction>(['accept', 'confirm']);

// ---------------------------------------------------------------- the handoff sheet (交接弹窗)

/**
 * What the handoff sheet can show for a need: not found (unknown id or another project), private
 * (it must be shared before anyone can take it), or the form with who can take it, grouped by role.
 */
export type HandoffSheet = { state: 'missing' } | { state: 'private' } | { state: 'ok'; need: Need; groups: PeopleGroup[] };

export function handoffSheet(s: State, projectId: Id, needId: Id, me: Id): HandoffSheet {
  const n = s.needs[needId];
  if (!n || n.projectId !== projectId) return { state: 'missing' };
  if (n.privateTo !== null) return { state: 'private' };
  return { state: 'ok', need: n, groups: handoffPeople(s, projectId, me) };
}

/** The preselected person: `toId` when listed (the agent's 「交给 X」), else the first listed, else nobody. */
export function initialTo(groups: readonly PeopleGroup[], toId: Id | null | undefined): Id | null {
  const all = groups.flatMap((g) => g.memberIds);
  if (toId && all.includes(toId)) return toId;
  return all[0] ?? null;
}
