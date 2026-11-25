import { describe, expect, it } from 'vitest';
import {
  DomainError,
  answer,
  chatMessages,
  dashboardKey,
  shareableView,
  viewFor,
  type DomainErrorCode,
} from '../src/index';
import { atlas, P, U } from './log';

const rejects = (fn: () => unknown, code: DomainErrorCode) => {
  try {
    fn();
  } catch (e) {
    expect((e as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
};

const today = '2026-11-24';

describe('private chat threads with the project agent (design §8.8)', () => {
  it('chat events are scoped to their author; other members receive none', () => {
    const log = atlas();
    const reply = answer(viewFor(log.state, U.me), { userId: U.me, scope: { kind: 'project', projectId: P }, text: 'deadlines', today });
    log.emit('chat.asked', U.me, { messageId: 'c1', scope: P, text: 'deadlines', reply });
    expect(log.scopes.at(-1)).toEqual({ projectId: P, privateTo: U.me });
    expect(log.streamFor(U.lin).some((e) => e.type.startsWith('chat.'))).toBe(false);
  });

  it('stores the rule-based reply with the question; clearing hides earlier messages but keeps them', () => {
    const log = atlas();
    const reply = answer(viewFor(log.state, U.me), { userId: U.me, scope: { kind: 'project', projectId: P }, text: 'deadlines', today });
    log.emit('chat.asked', U.me, { messageId: 'c1', scope: P, text: 'deadlines', reply });
    expect(chatMessages(log.state, U.me, P)).toHaveLength(1);
    expect(chatMessages(log.state, U.me, P)[0]!.reply.simulated).toBe(true);
    log.emit('chat.cleared', U.me, { scope: P });
    expect(chatMessages(log.state, U.me, P)).toHaveLength(0);
    expect(log.state.chats[dashboardKey(U.me, P)]!.messages).toHaveLength(1);
  });

  it('rejects a chat in a project the actor is not in, an empty text and a reply without provider', () => {
    const log = atlas();
    const reply = answer(viewFor(log.state, U.me), { userId: U.me, scope: { kind: 'project', projectId: P }, text: 'deadlines', today });
    rejects(() => log.emit('chat.asked', U.eve, { messageId: 'c2', scope: P, text: 'hi', reply }), 'NOT_A_MEMBER');
    rejects(() => log.emit('chat.asked', U.me, { messageId: 'c3', scope: P, text: '', reply }), 'INVALID_EVENT');
    rejects(() => log.emit('chat.asked', U.me, { messageId: 'c4', scope: P, text: 'hi', reply: {} as never }), 'INVALID_EVENT');
  });

  it('home chats need no project; viewFor and shareableView never contain another user’s thread', () => {
    const log = atlas();
    const reply = answer(viewFor(log.state, U.me), { userId: U.me, scope: { kind: 'home' }, text: 'today', today });
    log.emit('chat.asked', U.me, { messageId: 'c5', scope: 'home', text: 'today', reply });
    expect(chatMessages(log.state, U.me, 'home')).toHaveLength(1);
    expect(Object.keys(viewFor(log.state, U.lin).chats)).toEqual([]);
    expect(Object.keys(viewFor(log.state, U.me).chats)).toEqual([dashboardKey(U.me, 'home')]);
    expect(shareableView(log.state).chats).toEqual({});
  });
});
