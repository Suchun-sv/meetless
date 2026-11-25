import { describe, expect, it } from 'vitest';
import { handoffForNeed, needByCode, type EventPayloads, type Handoff, type Need, type Round } from '@meetless/core';
import type { MessageKey, Params } from '@meetless/i18n';
import { dueChoices, handoffCommand, handoffPayload, handoffPeople, handoffView, linkPreview, promptText, type Cmd } from '../../src/renderer/collab/model';
import { Log } from '../support/log';
import { sample } from '../support/app';

const TODAY = '2026-11-24';

describe('handoffView', () => {
  it('recipient actions follow the ordinary state machine', () => {
    const { state } = sample('zh-CN');
    const n3 = needByCode(state, 'sample-atlas', 'N3')!;
    const n3h = handoffForNeed(state, n3.id)!;
    expect(n3h.state).toBe('sent');
    expect(n3h.fromId).toBe('u-lin');
    expect(n3h.toId).toBe('u-alex');
    expect(handoffView(state, n3h, 'u-alex')).toMatchObject({ role: 'recipient', actions: ['accept', 'ask', 'decline'], decision: false });

    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-send', displayName: 'Sender', locale: 'en' });
    log.emit('user.registered', 'system', { userId: 'u-recv', displayName: 'Recipient', locale: 'en' });
    log.emit('project.created', 'u-send', { projectId: 'p', name: 'P' });
    log.emit('project.member_added', 'u-send', { projectId: 'p', userId: 'u-recv' });
    log.emit('need.created', 'u-send', {
      needId: 'n1',
      projectId: 'p',
      kind: 'ext',
      title: 'Build it',
      roundId: null,
      source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
    });
    log.emit('handoff.created', 'u-send', { handoffId: 'h1', projectId: 'p', needId: 'n1', toId: 'u-recv', ask: 'do the thing', due: null });
    expect(handoffView(log.state, log.state.handoffs.h1!, 'u-recv').actions).toEqual(['accept', 'ask', 'decline']);

    log.emit('handoff.responded', 'u-recv', { handoffId: 'h1', response: 'asked', note: 'which fields?' });
    expect(handoffView(log.state, log.state.handoffs.h1!, 'u-recv').actions).toEqual(['accept', 'decline']);

    log.emit('handoff.responded', 'u-recv', { handoffId: 'h1', response: 'accepted' });
    expect(handoffView(log.state, log.state.handoffs.h1!, 'u-recv').actions).toEqual(['start', 'copy', 'return']);

    log.emit('handoff.started', 'u-recv', { handoffId: 'h1' });
    expect(handoffView(log.state, log.state.handoffs.h1!, 'u-recv').actions).toEqual(['copy', 'return']);

    log.emit('handoff.returned', 'u-recv', { handoffId: 'h1' });
    expect(handoffView(log.state, log.state.handoffs.h1!, 'u-recv').actions).toEqual([]);
  });

  it('the sender confirms or reopens a returned handoff; only the sender', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-send', displayName: 'Sender', locale: 'en' });
    log.emit('user.registered', 'system', { userId: 'u-recv', displayName: 'Recipient', locale: 'en' });
    log.emit('user.registered', 'system', { userId: 'u-third', displayName: 'Third', locale: 'en' });
    log.emit('project.created', 'u-send', { projectId: 'p', name: 'P' });
    log.emit('project.member_added', 'u-send', { projectId: 'p', userId: 'u-recv' });
    log.emit('project.member_added', 'u-send', { projectId: 'p', userId: 'u-third' });
    log.emit('need.created', 'u-send', {
      needId: 'n1',
      projectId: 'p',
      kind: 'ext',
      title: 'Build it',
      roundId: null,
      source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
    });
    log.emit('handoff.created', 'u-send', { handoffId: 'h1', projectId: 'p', needId: 'n1', toId: 'u-recv', ask: 'do the thing', due: null });
    log.emit('handoff.responded', 'u-recv', { handoffId: 'h1', response: 'accepted' });
    log.emit('handoff.started', 'u-recv', { handoffId: 'h1' });
    log.emit('handoff.returned', 'u-recv', { handoffId: 'h1', note: 'done, please check' });

    const h = log.state.handoffs.h1!;
    expect(handoffView(log.state, h, 'u-send')).toMatchObject({ role: 'sender', actions: ['confirm', 'reopen'] });
    expect(handoffView(log.state, h, 'u-recv').actions).toEqual([]);
    const other = handoffView(log.state, h, 'u-third');
    expect(other.role).toBe('other');
    expect(other.actions).toEqual([]);
  });

  it('Atlas N2: Alex sees the stale warning and remind; Zhou sees no remind', () => {
    const { state } = sample('zh-CN');
    const n2 = needByCode(state, 'sample-atlas', 'N2')!;
    const n2h = handoffForNeed(state, n2.id)!;
    expect(n2h.fromId).toBe('u-alex');
    expect(n2h.toId).toBe('u-zhou');
    const alexView = handoffView(state, n2h, 'u-alex');
    expect(alexView).toMatchObject({ role: 'sender', stale: { fetched: 1, current: 2, reminded: false }, actions: ['remind'] });
    const zhouView = handoffView(state, n2h, 'u-zhou');
    expect(zhouView.actions).not.toContain('remind');
    expect(zhouView).toMatchObject({ role: 'recipient', actions: ['copy', 'return'] });
  });

  it('reminding hides the warning until the need is revised again', () => {
    const { state } = sample('zh-CN');
    const n2 = needByCode(state, 'sample-atlas', 'N2')!;
    const n2hId = handoffForNeed(state, n2.id)!.id;
    const log = new Log({ initial: state });

    log.emit('handoff.refresh_requested', 'u-alex', { handoffId: n2hId });
    let h = log.state.handoffs[n2hId]!;
    expect(handoffView(log.state, h, 'u-alex').actions).toEqual([]);
    expect(handoffView(log.state, h, 'u-alex').stale?.reminded).toBe(true);
    expect(handoffView(log.state, h, 'u-zhou').refresh).toBe(2);

    log.emit('need.revised', 'u-alex', { needId: n2.id, revisionId: 'n2-rev-test', text: 'More fields', why: 'client ask', date: TODAY });
    h = log.state.handoffs[n2hId]!;
    expect(handoffView(log.state, h, 'u-alex')).toMatchObject({ stale: { fetched: 1, current: 3, reminded: false }, actions: ['remind'] });
  });

  it('a conflict decision offers decide to the new decider only', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('user.registered', 'system', { userId: 'u-lin', displayName: 'Lin', locale: 'en' });
    log.emit('user.registered', 'system', { userId: 'u-third', displayName: 'Third', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    log.emit('project.member_added', 'u-me', { projectId: 'p', userId: 'u-lin' });
    log.emit('project.member_added', 'u-me', { projectId: 'p', userId: 'u-third' });
    log.emit('need.created', 'u-me', {
      needId: 'n-x',
      projectId: 'p',
      kind: 'ext',
      title: 'Field scope',
      roundId: null,
      accept: 'v1 fields',
      source: { src: 'meeting', date: '2026-11-01', quote: 'orig', ref: 'kickoff' },
    });
    log.emit('input.imported', 'u-me', {
      inputId: 'in1',
      projectId: 'p',
      kind: 'pdf',
      title: 'New spec',
      date: '2026-11-05',
      body: [{ id: 'p1', text: 'All fields now.' }],
      extracts: [{ id: 'x1', type: 'rev', text: 'All fields', paraId: 'p1', needId: 'n-x', conflict: true }],
      detector: 'rules/1',
    });
    const conflictId = Object.keys(log.state.conflicts)[0]!;
    log.emit('conflict.resolved', 'u-me', { conflictId, resolution: 'handoff', handoffId: 'h-decide', toId: 'u-lin', ask: 'your call', due: null });

    let h = log.state.handoffs['h-decide']!;
    expect(h.conflictId).toBe(conflictId);
    const linView = handoffView(log.state, h, 'u-lin');
    expect(linView).toMatchObject({ role: 'recipient', decision: true, actions: ['decide'] });
    expect(handoffView(log.state, h, 'u-me')).toMatchObject({ role: 'sender', decision: true, actions: [] });
    expect(handoffView(log.state, h, 'u-third')).toMatchObject({ role: 'other', actions: [] });

    // Lin decides directly against the conflict (today's base keeps the handoff `sent`, but
    // the decision is moot once the conflict itself is resolved).
    log.emit('conflict.resolved', 'u-lin', { conflictId, resolution: 'revise' });
    h = log.state.handoffs['h-decide']!;
    expect(log.state.conflicts[conflictId]!.status).toBe('resolved');
    expect(handoffView(log.state, h, 'u-lin').actions).toEqual([]);
  });
});

describe('handoffCommand', () => {
  const h = { id: 'h1' } as unknown as Handoff;

  it('builds the right command for each action', () => {
    expect(handoffCommand('accept', h)).toEqual({ type: 'handoff.responded', payload: { handoffId: 'h1', response: 'accepted' } });
    expect(handoffCommand('ask', h, 'Which fields?')).toEqual({ type: 'handoff.responded', payload: { handoffId: 'h1', response: 'asked', note: 'Which fields?' } });
    expect(handoffCommand('decline', h)).toEqual({ type: 'handoff.responded', payload: { handoffId: 'h1', response: 'declined' } });
    expect(handoffCommand('start', h)).toEqual({ type: 'handoff.started', payload: { handoffId: 'h1' } });
    expect(handoffCommand('return', h)).toEqual({ type: 'handoff.returned', payload: { handoffId: 'h1' } });
    expect(handoffCommand('return', h, 'all done')).toEqual({ type: 'handoff.returned', payload: { handoffId: 'h1', note: 'all done' } });
    expect(handoffCommand('confirm', h)).toEqual({ type: 'handoff.confirmed', payload: { handoffId: 'h1' } });
    expect(handoffCommand('reopen', h, 'Tests fail')).toEqual({ type: 'handoff.reopened', payload: { handoffId: 'h1', note: 'Tests fail' } });
    expect(handoffCommand('remind', h)).toEqual({ type: 'handoff.refresh_requested', payload: { handoffId: 'h1' } });
  });
});

describe('dueChoices', () => {
  it('this Friday, next Friday, the round deadline', () => {
    const round = { due: '2026-11-30', status: 'current' } as unknown as Round;
    expect(dueChoices('2026-11-24', round)).toEqual([
      { key: 'week', date: '2026-11-27' },
      { key: 'next', date: '2026-12-04' },
      { key: 'round', date: round.due },
    ]);
    expect(dueChoices('2026-11-27', null).map((d) => d.date)).toEqual(['2026-11-27', '2026-12-04']);
  });

  it('drops the round choice once it is delivered or its due date has passed', () => {
    const delivered = { due: '2026-11-30', status: 'delivered' } as unknown as Round;
    expect(dueChoices('2026-11-24', delivered).map((c) => c.key)).toEqual(['week', 'next']);
    const past = { due: '2026-11-20', status: 'current' } as unknown as Round;
    expect(dueChoices('2026-11-24', past).map((c) => c.key)).toEqual(['week', 'next']);
  });
});

describe('handoffPeople', () => {
  it('groups by role, lists role-less members last, dedupes across roles and never lists me', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('user.registered', 'system', { userId: 'u-a', displayName: 'A', locale: 'en' });
    log.emit('user.registered', 'system', { userId: 'u-b', displayName: 'B', locale: 'en' });
    log.emit('user.registered', 'system', { userId: 'u-c', displayName: 'C', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p', name: 'P' });
    log.emit('project.member_added', 'u-me', { projectId: 'p', userId: 'u-a' });
    log.emit('project.member_added', 'u-me', { projectId: 'p', userId: 'u-b' });
    log.emit('project.member_added', 'u-me', { projectId: 'p', userId: 'u-c' });
    log.emit('role.created', 'u-me', { roleId: 'r-product', projectId: 'p', name: 'Product' });
    log.emit('role.member_assigned', 'u-me', { roleId: 'r-product', userId: 'u-a' });
    log.emit('role.member_assigned', 'u-me', { roleId: 'r-product', userId: 'u-b' });
    log.emit('role.created', 'u-me', { roleId: 'r-eng', projectId: 'p', name: 'Engineering' });
    // u-b also holds Engineering; handoffPeople must keep it only under Product (the first role).
    log.emit('role.member_assigned', 'u-me', { roleId: 'r-eng', userId: 'u-b' });

    const groups = handoffPeople(log.state, 'p', 'u-me');
    expect(groups).toEqual([
      { roleName: 'Product', memberIds: ['u-a', 'u-b'] },
      { roleName: null, memberIds: ['u-c'] },
    ]);
    const all = groups.flatMap((g) => g.memberIds);
    expect(all).not.toContain('u-me');
    expect(new Set(all).size).toBe(all.length);
  });

  it('a project with only me gives no groups', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
    log.emit('project.created', 'u-me', { projectId: 'p0', name: 'Solo' });
    expect(handoffPeople(log.state, 'p0', 'u-me')).toEqual([]);
  });
});

describe('handoffPayload', () => {
  const need = { id: 'n1', title: 'Field scope' } as unknown as Need;

  it('falls back to the title for an empty (or whitespace-only) ask', () => {
    expect(handoffPayload({ handoffId: 'h1', projectId: 'p', need, toId: 'u-x', ask: '', due: null })).toEqual({
      handoffId: 'h1',
      projectId: 'p',
      needId: 'n1',
      toId: 'u-x',
      ask: 'Field scope',
      due: null,
    });
    expect(handoffPayload({ handoffId: 'h1', projectId: 'p', need, toId: 'u-x', ask: '   ', due: '2026-11-27' })).toMatchObject({ ask: 'Field scope', due: '2026-11-27' });
  });

  it('trims a real ask instead of falling back', () => {
    expect(handoffPayload({ handoffId: 'h1', projectId: 'p', need, toId: 'u-x', ask: '  take this on  ', due: null }).ask).toBe('take this on');
  });
});

describe('promptText', () => {
  it('reads the link, then follows what it asks', () => {
    const t: (k: MessageKey, p?: Params) => string = (k, p) => (k === 'lk.prompt1' ? `read ${p!.url}` : 'then do it');
    expect(promptText(t, 'meetless://p/N1')).toBe('read meetless://p/N1\nthen do it');
  });
});

describe('linkPreview', () => {
  it('never contains a private item, even for its owner, and is null for a private or invisible need', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale: 'en' });
    log.emit('project.created', 'u-alex', { projectId: 'p', name: 'P' });
    log.emit('need.created', 'u-alex', {
      needId: 'n-a',
      projectId: 'p',
      kind: 'ext',
      title: 'Shared parent',
      roundId: null,
      source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
    });
    log.emit('need.created', 'u-alex', {
      needId: 'n-child',
      projectId: 'p',
      kind: 'hyp',
      title: "Alex's secret idea",
      roundId: null,
      parentId: 'n-a',
      private: true,
      source: { src: 'chat', date: '2026-11-02', quote: 'q', ref: 'r' },
    });
    log.emit('need.created', 'u-alex', {
      needId: 'n-private',
      projectId: 'p',
      kind: 'hyp',
      title: 'Fully private',
      roundId: null,
      private: true,
      source: { src: 'chat', date: '2026-11-03', quote: 'q', ref: 'r' },
    });

    const preview = linkPreview(log.state, 'n-a', 'en')!;
    expect(preview).not.toBeNull();
    expect(preview.markdown).not.toContain("Alex's secret idea");

    // Even for its own owner (Alex authored it), and for the fully private need.
    expect(linkPreview(log.state, 'n-child', 'en')).toBeNull();
    expect(linkPreview(log.state, 'n-private', 'en')).toBeNull();
    // Not visible at all (unknown id).
    expect(linkPreview(log.state, 'n-missing', 'en')).toBeNull();
  });
});

describe('Cmd', () => {
  it('is a discriminated union callable as submit(c.type, c.payload)', () => {
    // Mirrors AppApi.submit's generic shape; proves `Cmd` typechecks at the call site Tasks 6-10 use.
    function typedSubmit<K extends keyof EventPayloads>(type: K, _payload: EventPayloads[K]): K {
      return type;
    }
    const c: Cmd = { type: 'handoff.started', payload: { handoffId: 'h1' } };
    expect(typedSubmit(c.type, c.payload)).toBe('handoff.started');
  });
});
