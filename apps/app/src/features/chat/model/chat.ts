import type { ApiRequest } from '@meetless/api';
import type { Result, SubmitResult } from '@meetless/client/bridge';
import {
  answer,
  cardsFor,
  clip,
  handoffStaleness,
  HOME_CARDS,
  isFreeQuestion,
  PROJECT_CARDS,
  RULES_PROVIDER_ID,
  suggestions,
  type AgentReply,
  type AgentScope,
  type CardId,
  type EventPayloads,
  type EventType,
  type Id,
  type IsoDate,
  type IsoTime,
  type State,
  type Suggestion,
} from '@meetless/core';
import type { Translator } from '@meetless/i18n';
import type { Target } from './target';

/*
 * The project agent's composer logic, ported from the desktop renderer's `chat/model.ts`. That file
 * cannot be imported as is: it pulls the desktop overlay and route types (and through them the
 * DOM components). Routes are `Target`s here instead.
 */

/** Every event the chat can emit, typed by its own payload. */
export type ChatCommand = { [K in EventType]: { type: K; payload: EventPayloads[K] } }[EventType];

/** The app's `submit`, as the chat needs it. */
export type SubmitFn = <K extends EventType>(type: K, payload: EventPayloads[K]) => Promise<SubmitResult>;

/** The agent scope for a chat scope ('home' or a project id). */
export function agentScope(scope: 'home' | Id): AgentScope {
  return scope === 'home' ? { kind: 'home' } : { kind: 'project', projectId: scope };
}

/** Whether Enter (or the send button) should send `text`: not while an IME composition is open, not for whitespace. */
export function shouldSend(text: string, composing: boolean): boolean {
  return !composing && text.trim().length > 0;
}

/** The `dashboard.set` payload for adding `card` to `cur`'s card set, stamped `now` (dash/model's `addCardPayload`). */
export function addCardPayload(cur: { cards: CardId[]; refreshed: Record<string, string> }, scope: Id, card: CardId, now: IsoTime): EventPayloads['dashboard.set'] {
  const cards = cur.cards.includes(card) ? cur.cards : [...cur.cards, card];
  return { scope, cards, refreshed: { ...cur.refreshed, [card]: now } };
}

/** The suggestion chips above the composer, optionally with the dashboard's "add card" pool when on that dashboard. */
export function chipsFor(s: State, me: Id, scope: 'home' | Id, onDash: boolean, today: IsoDate): Suggestion[] {
  return suggestions(s, me, agentScope(scope), today, onDash ? { dashboardCards: cardsFor(s, me, scope).cards, pool: scope === 'home' ? HOME_CARDS : PROJECT_CARDS } : {});
}

/** The chip's label, built from its own data (never a stored string). */
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

/** The rule reply recorded for an "add card" chip, in the shape `answer()` gives. */
export function cardReply(card: CardId): AgentReply {
  return { answer: { intent: 'addCard', card, cites: [] }, provider: RULES_PROVIDER_ID, simulated: true };
}

/** The rule reply recorded for a "stale" chip: the one handoff it names, if still stale. */
export function staleReply(s: State, me: Id, handoffId: Id): AgentReply {
  const h = s.handoffs[handoffId];
  const st = h && h.fromId === me ? handoffStaleness(s, h) : null;
  const items = h && st ? [{ projectId: h.projectId, handoffId: h.id, needId: h.needId, fetched: st.fetched, current: st.current, reminded: st.reminded }] : [];
  return { answer: { intent: 'stale', items, cites: [...new Set(items.map((i) => i.needId))] }, provider: RULES_PROVIDER_ID, simulated: true };
}

/** The commands a question answered locally produces: the chat message, plus a dashboard update when it adds a card. */
export function sendCommands(s: State, me: Id, scope: 'home' | Id, text: string, today: IsoDate, now: IsoTime, messageId: Id): ChatCommand[] {
  const reply = answer(s, { userId: me, scope: agentScope(scope), text, today });
  const out: ChatCommand[] = [{ type: 'chat.asked', payload: { messageId, scope, text, reply } }];
  if (reply.answer.intent === 'addCard') out.push({ type: 'dashboard.set', payload: addCardPayload(cardsFor(s, me, scope), scope, reply.answer.card, now) });
  return out;
}

/** The server's `agent.ask`, as the app's `api` gives it. */
export type AskFn = (req: ApiRequest<'agent.ask'>) => Promise<Result<{ data: { reply: AgentReply } }>>;

/** Whether a typed message needs the server: content to add (需要：..., a list, long text) always, a free question when AI is on. */
export function needsServer(local: AgentReply, ai: boolean): boolean {
  return local.answer.intent === 'asInput' || (ai && isFreeQuestion(local.answer));
}

/** Whether `text` goes to `/v1/agent/ask`: the composer shows the pending row while it does. */
export function goesToServer(s: State, me: Id, scope: 'home' | Id, text: string, today: IsoDate, ai: boolean): boolean {
  return needsServer(answer(s, { userId: me, scope: agentScope(scope), text, today }), ai);
}

/**
 * The commands a typed message produces through `agent.ask`. Content to add (`asInput`, e.g.
 * 「需要：1. ... 2. ...」) is imported by the server into To confirm under the composer's privacy
 * `priv`, and comes back as intent `added`; a free question is answered by DeepSeek (or the rules).
 * Other intents stay local, as in `sendCommands`. When the server cannot be reached the local rule
 * answer is used: `fallback: 'offline'` on a question, the manual import row on content.
 */
export async function askCommands(
  s: State,
  me: Id,
  scope: 'home' | Id,
  text: string,
  today: IsoDate,
  now: IsoTime,
  messageId: Id,
  ask: AskFn,
  opts: { ai?: boolean; priv?: boolean } = {},
): Promise<ChatCommand[]> {
  const local = answer(s, { userId: me, scope: agentScope(scope), text, today });
  if (!needsServer(local, opts.ai !== false)) return sendCommands(s, me, scope, text, today, now, messageId);
  const r = await ask({ projectId: scope, question: text, messageId, private: opts.priv === true }).catch(() => null);
  const reply: AgentReply = r?.ok ? r.data.reply : local.answer.intent === 'asInput' ? local : { ...local, source: 'rules', fallback: 'offline' };
  return [{ type: 'chat.asked', payload: { messageId, scope, text, reply } }];
}

/** The reply's label (who wrote it) and the note under it (why it fell back, when it did). */
export function replyLabel(reply: AgentReply): { generated: boolean; label: 'app.deepseek' | 'app.rules' | 'ai.deepseek' | 'ai.rules'; note: 'ch.genNote' | 'ch.sim' | 'ch.fellBack' | 'ch.addNote' } {
  // Content added to To confirm is labelled as detection: 「DeepSeek 识别」 or 「规则识别」.
  if (reply.answer.intent === 'added') return { generated: reply.source === 'deepseek', label: reply.source === 'deepseek' ? 'ai.deepseek' : 'ai.rules', note: 'ch.addNote' };
  if (reply.source === 'deepseek') return { generated: true, label: 'app.deepseek', note: 'ch.genNote' };
  return { generated: false, label: 'app.rules', note: reply.fallback && reply.fallback !== 'not_configured' ? 'ch.fellBack' : 'ch.sim' };
}

/** What tapping a chip does: commands to send, then optionally somewhere to open. */
export type ChipOutcome = { commands: ChatCommand[]; open?: Target };

/** The outcome of tapping `chip`, labelled `label`. */
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
      return { commands: [], open: { kind: 'need', projectId: chip.projectId, needId: chip.needId } };
    case 'conflict':
    case 'proposal':
      return { commands: [], open: { kind: 'confirm', projectId: chip.projectId } };
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

/**
 * Whether to keep sending the next command of a chain after this result. Only a real rejection
 * stops it: `queued` (saved offline, flushed later in order) counts as sent, like `accepted`.
 */
export function continueAfterSubmit(r: SubmitResult): boolean {
  return r.kind !== 'rejected';
}

/** Sends `cmds` in order, stopping at a rejection. True when every one went through. */
export async function runCommands(cmds: readonly ChatCommand[], submit: SubmitFn): Promise<boolean> {
  for (const c of cmds) {
    const r = await submit(c.type, c.payload as never);
    if (!continueAfterSubmit(r)) return false;
  }
  return true;
}

/** The input's title for an imported chat message: the first non-empty line, list/quote marks stripped, 40 characters. */
export function inputTitleFrom(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  return clip(line.replace(/^[\s#>*-]+/, ''), 40);
}

/** The import request for a chat message the agent offered to import (intent `asInput`, the offline path). */
export function importCommand(a: { projectId: Id; messageId: Id; text: string; priv: boolean; today: IsoDate }): ApiRequest<'inputs.import'> {
  return { projectId: a.projectId, inputId: `in-${a.messageId}`, title: inputTitleFrom(a.text), kind: 'md', blobHash: null, text: a.text, from: null, date: a.today, private: a.priv, scene: 'agent' };
}

/**
 * What to do with an `inputs.import` result: open the input, or show the error code. A second
 * import of the same message is `ALREADY_EXISTS` (its id `in-<messageId>` is fixed), so that
 * input opens instead of an error.
 */
export function importResult(res: Result<{ data: { inputId: Id } }>, projectId: Id, inputId: Id): { open: Target } | { code: string } {
  if (res.ok) return { open: { kind: 'input', projectId, inputId: res.data.inputId } };
  if (res.code === 'ALREADY_EXISTS') return { open: { kind: 'input', projectId, inputId } };
  return { code: res.code };
}

// ---------------------------------------------------------------- privacy switch (session memory)

/** The composer's 「仅自己」 switch per project, for the session only; never persisted. */
const PRIV_BY_PROJECT = new Map<Id, boolean>();

export function getPriv(projectId: Id): boolean {
  return PRIV_BY_PROJECT.get(projectId) ?? false;
}

export function setPriv(projectId: Id, on: boolean): void {
  PRIV_BY_PROJECT.set(projectId, on);
}

/**
 * The switch each message was sent under (ruling R21). "Import as input" uses this, never the
 * switch at tap time, so private notes never get imported as shared after a flip.
 */
const PRIV_BY_MESSAGE = new Map<Id, boolean>();

export function recordSentPriv(messageId: Id, priv: boolean): void {
  PRIV_BY_MESSAGE.set(messageId, priv);
}

export function recordSentPrivFor(cmds: readonly ChatCommand[], priv: boolean): void {
  for (const c of cmds) if (c.type === 'chat.asked') recordSentPriv(c.payload.messageId, priv);
}

/** Whether importing `messageId` makes it private: the switch it was sent under, or private with no record (never leaks). */
export function importPriv(messageId: Id): boolean {
  return PRIV_BY_MESSAGE.get(messageId) ?? true;
}

/** The composer placeholder key for this scope and switch. */
export function placeholderKey(scope: 'home' | Id, priv: boolean): 'ch.phHome' | 'ch.phPrivate' | 'ch.ph' {
  return scope === 'home' ? 'ch.phHome' : priv ? 'ch.phPrivate' : 'ch.ph';
}
