import type { ApiRequest } from '@meetless/api';
import type { Result, SubmitResult } from '@meetless/client/bridge';
import {
  answer,
  cardsFor,
  clip,
  handoffStaleness,
  HOME_CARDS,
  PROJECT_CARDS,
  RULES_PROVIDER_ID,
  suggestions,
  type AgentReply,
  type AgentScope,
  type CardId,
  type EventPayloads,
  type EventType,
  type Id,
  type InputKind,
  type IsoDate,
  type IsoTime,
  type State,
  type Suggestion,
} from '@meetless/core';
import type { Translator } from '@meetless/i18n';
import type { Overlay } from '../app/overlays';
import type { Route } from '../app/routes';
import { addCardPayload } from '../dash/model';

/** Every event this module can emit, typed by its own payload. */
export type U1Command = { [K in EventType]: { type: K; payload: EventPayloads[K] } }[EventType];

/** The agent scope for a chat scope ('home' or a project id). */
export function agentScope(scope: 'home' | Id): AgentScope {
  return scope === 'home' ? { kind: 'home' } : { kind: 'project', projectId: scope };
}

/** Whether Enter should send `text`: not while an IME composition is open, and not for whitespace-only text. */
export function shouldSend(text: string, composing: boolean): boolean {
  return !composing && text.trim().length > 0;
}

/** The suggestion chips above the composer for this scope, optionally including the dashboard's "add card" pool. */
export function chipsFor(s: State, me: Id, scope: 'home' | Id, onDash: boolean, today: IsoDate): Suggestion[] {
  return suggestions(s, me, agentScope(scope), today, onDash ? { dashboardCards: cardsFor(s, me, scope).cards, pool: scope === 'home' ? HOME_CARDS : PROJECT_CARDS } : {});
}

/** The chip's display label, built from its own data (never a stored string). */
export function chipLabel(t: Translator['t'], s: State, chip: Suggestion): string {
  switch (chip.kind) {
    case 'stale':
      return t('sg.stale', { need: s.needs[chip.needId]?.code ?? '', who: s.users[chip.userId]?.displayName ?? '' });
    case 'toMe':
      return t('sg.toMe', { who: s.users[chip.userId]?.displayName ?? '' });
    case 'conflict':
      return t('sg.conflict', { n: chip.n });
    case 'proposal':
      return t('sg.proposal', { n: chip.n });
    case 'addCard':
      return t('db.add', { name: t(`w.${chip.card}`) });
    case 'ask':
      return t(`sg.ask.${chip.prompt}`);
  }
}

/** The rule-based reply recorded for an "add card" chip, in the same shape `answer()` would produce. */
export function cardReply(card: CardId): AgentReply {
  return { answer: { intent: 'addCard', card, cites: [] }, provider: RULES_PROVIDER_ID, simulated: true };
}

/** The rule-based reply recorded for a "stale" chip: the one handoff it names, if still stale. */
export function staleReply(s: State, me: Id, handoffId: Id): AgentReply {
  const h = s.handoffs[handoffId];
  const st = h && h.fromId === me ? handoffStaleness(s, h) : null;
  const items = h && st ? [{ projectId: h.projectId, handoffId: h.id, needId: h.needId, fetched: st.fetched, current: st.current, reminded: st.reminded }] : [];
  return { answer: { intent: 'stale', items, cites: [...new Set(items.map((i) => i.needId))] }, provider: RULES_PROVIDER_ID, simulated: true };
}

/** The commands a typed question produces: always the chat message, plus a dashboard update when it adds a card. */
export function sendCommands(s: State, me: Id, scope: 'home' | Id, text: string, today: IsoDate, now: IsoTime, messageId: Id): U1Command[] {
  const reply = answer(s, { userId: me, scope: agentScope(scope), text, today });
  const out: U1Command[] = [{ type: 'chat.asked', payload: { messageId, scope, text, reply } }];
  if (reply.answer.intent === 'addCard') out.push({ type: 'dashboard.set', payload: addCardPayload(cardsFor(s, me, scope), scope, reply.answer.card, now) });
  return out;
}

/** What clicking a chip does: commands to send, a need to open, or an overlay to show. */
export type ChipOutcome = { commands: U1Command[]; open?: { projectId: Id; needId: Id }; overlay?: Overlay };

/** The outcome of clicking `chip`, labelled `label`. */
export function chipOutcome(s: State, me: Id, scope: 'home' | Id, chip: Suggestion, label: string, today: IsoDate, now: IsoTime, messageId: Id): ChipOutcome {
  switch (chip.kind) {
    case 'stale':
      return {
        commands: [
          { type: 'handoff.refresh_requested', payload: { handoffId: chip.handoffId } },
          { type: 'chat.asked', payload: { messageId, scope, text: label, reply: staleReply(s, me, chip.handoffId) } },
        ],
      };
    case 'toMe':
      return { commands: [], open: { projectId: chip.projectId, needId: chip.needId } };
    case 'conflict':
    case 'proposal':
      return { commands: [], overlay: { kind: 'confirm', projectId: chip.projectId } };
    case 'addCard':
      return {
        commands: [
          { type: 'chat.asked', payload: { messageId, scope, text: label, reply: cardReply(chip.card) } },
          { type: 'dashboard.set', payload: addCardPayload(cardsFor(s, me, scope), scope, chip.card, now) },
        ],
      };
    case 'ask':
      return { commands: sendCommands(s, me, scope, label, today, now, messageId) };
  }
}

/** The input's title: the first non-empty line, with leading list/quote marks stripped, clipped to 40 characters. */
export function inputTitleFrom(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  return clip(line.replace(/^[\s#>*-]+/, ''), 40);
}

/** The import request for a typed or pasted chat message. */
export function importCommand(a: { projectId: Id; messageId: Id; text: string; priv: boolean; today: IsoDate }): ApiRequest<'inputs.import'> {
  return { projectId: a.projectId, inputId: `in-${a.messageId}`, title: inputTitleFrom(a.text), kind: 'md', blobHash: null, text: a.text, from: null, date: a.today, private: a.priv };
}

/**
 * The import kind for each file extension the attach picker accepts. A legacy binary `.doc` is not
 * OOXML, so it is not here: the Composer refuses it at pick time (`ch.badFile`) instead of
 * uploading something extraction would fail on later.
 */
export const EXT_KIND: Readonly<Record<string, InputKind>> = { md: 'md', markdown: 'md', txt: 'txt', docx: 'docx', pdf: 'pdf' };

/** The lower-case extension of a file name, or '' when it has none. */
export function fileExt(name: string): string {
  return /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';
}

/** Whether the attach picker accepts a file of this name (an extension in `EXT_KIND`). */
export function acceptsFile(name: string): boolean {
  return Object.hasOwn(EXT_KIND, fileExt(name));
}

/** The import kind for a file name's extension (case-insensitive); unrecognised extensions fall back to text. */
function kindFromName(name: string): InputKind {
  return EXT_KIND[fileExt(name)] ?? 'txt';
}

/** The import request for a dropped or picked file. Text kinds (md, txt) are read as text; the rest upload as a blob first. */
export function fileImport(a: { projectId: Id; name: string; priv: boolean; today: IsoDate; inputId: Id }): { kind: InputKind; readAsText: boolean } & Omit<ApiRequest<'inputs.import'>, 'blobHash' | 'text'> {
  const kind = kindFromName(a.name);
  return {
    kind,
    readAsText: kind === 'md' || kind === 'txt',
    projectId: a.projectId,
    inputId: a.inputId,
    title: clip(a.name.replace(/\.[^./]+$/, ''), 40),
    from: null,
    date: a.today,
    private: a.priv,
  };
}

/**
 * The composer's privacy switch, per project and in memory for the session (contract §8): a
 * Composer mounted for the same project (across views, or after being unmounted and remounted)
 * sees the choice it was last left in. Never persisted to disk or to the service.
 */
const PRIV_BY_PROJECT = new Map<Id, boolean>();

/** Whether the privacy switch is on for `projectId` (off until set). */
export function getPriv(projectId: Id): boolean {
  return PRIV_BY_PROJECT.get(projectId) ?? false;
}

/** Sets the privacy switch for `projectId` for the rest of the session. */
export function setPriv(projectId: Id, on: boolean): void {
  PRIV_BY_PROJECT.set(projectId, on);
}

/**
 * The privacy switch each chat message was sent under, in memory for the session (ruling R21).
 * "Import as input" uses this, never the switch at click time: a user who sent private notes and
 * then flipped the switch back must not import them as shared. Core's `chat.asked` is frozen, so
 * the flag cannot travel in the event, and this map is empty again after a restart.
 */
const PRIV_BY_MESSAGE = new Map<Id, boolean>();

/** Records the privacy switch `messageId` was sent under. The Composer calls it before it submits. */
export function recordSentPriv(messageId: Id, priv: boolean): void {
  PRIV_BY_MESSAGE.set(messageId, priv);
}

/** Records the switch for every chat message in `cmds` (a typed question or a chip's question). */
export function recordSentPrivFor(cmds: U1Command[], priv: boolean): void {
  for (const c of cmds) if (c.type === 'chat.asked') recordSentPriv(c.payload.messageId, priv);
}

/**
 * Whether importing `messageId` as an input makes it private: the switch it was sent under, or
 * private when there is no record (a message from before a restart). Defaulting to private never
 * leaks; the cost is that the user shares that input by hand.
 */
export function importPriv(messageId: Id): boolean {
  return PRIV_BY_MESSAGE.get(messageId) ?? true;
}

/**
 * What to do with an `inputs.import` result: open the input, or show the error code. A second
 * import of the same chat message (a double click, or again after a reload) is refused as
 * `ALREADY_EXISTS`, because its input id `in-<messageId>` is deterministic; that input exists, so
 * it opens instead of an error.
 */
export function importResult(res: Result<{ data: { inputId: Id } }>, projectId: Id, inputId: Id): { route: Route } | { code: string } {
  if (res.ok) return { route: { view: 'inputs', projectId, focusId: res.data.inputId } };
  if (res.code === 'ALREADY_EXISTS') return { route: { view: 'inputs', projectId, focusId: inputId } };
  return { code: res.code };
}

/**
 * Whether to keep sending the next command in a chain after this `SubmitResult`. A chain stops
 * only on a genuine rejection: `queued` means the client saved the command locally (offline) and
 * will flush it later in order, same as `accepted`/`duplicate` — stopping there would silently
 * drop every later command in the chain (the `addCard` reply's `dashboard.set`, the stale chip's
 * `chat.asked`), never even reaching the outbox.
 */
export function continueAfterSubmit(r: SubmitResult): boolean {
  return r.kind !== 'rejected';
}

/** Whether `scope`'s own dashboard is the current view: Home itself, or a project's `dash` view. */
export function onDashboardFor(scope: 'home' | Id, view: string): boolean {
  return scope === 'home' ? view === 'home' : view === 'dash';
}
