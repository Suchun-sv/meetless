import { describe, expect, it } from 'vitest';
import { replay, type DomainEvent } from '@meetless/core';
import { pickLocale } from '../src/renderer/app/AppContext';
import { newId } from '../src/renderer/model/ids';
import { displayName, initials, myProjects, safeReplay } from '../src/renderer/model/state';
import { avatarTextOk, wrappingAvatars } from './support/markup';
import { sample } from './support/app';

describe('renderer state model', () => {
  it('replays incrementally to the same state as a full replay and reports inapplicable events', () => {
    const { events } = sample('en');
    const cut = Math.floor(events.length / 2);
    const half = safeReplay(events.slice(0, cut));
    expect(safeReplay(events.slice(cut), half).state).toEqual(replay(events));
    // Events at or below the replayed seq are not applied twice.
    expect(safeReplay(events.slice(0, 3), safeReplay(events)).state).toEqual(replay(events));
    const member = events.find((e) => e.type === 'project.member_added')!;
    const bad = { ...member, seq: events.length + 1, id: 'bad', payload: { projectId: 'nope', userId: 'u-ben' } } as DomainEvent;
    const r = safeReplay([...events, bad]);
    expect(r.skipped.map((e) => e.id)).toEqual(['bad']);
    expect(r.state.lastSeq).toBe(events.length);
    // Skipped events are kept across incremental replays, never hidden.
    expect(safeReplay([], r).skipped.map((e) => e.id)).toEqual(['bad']);
  });

  it('initial locale: the stored choice, else the system preference', () => {
    expect(pickLocale(null, ['zh-Hans-CN'])).toBe('zh-CN');
    expect(pickLocale(null, ['fr-FR'])).toBe('en');
    expect(pickLocale('en', ['zh-CN'])).toBe('en');
    expect(pickLocale('zh-CN', ['en-GB'])).toBe('zh-CN');
    expect(pickLocale('xx', ['zh-CN'])).toBe('zh-CN');
  });

  it('names, initials and the user’s projects', () => {
    const { state } = sample('en');
    expect(displayName(state, 'u-alex')).not.toBe('u-alex');
    expect(displayName(state, 'u-nobody')).toBe('u-nobody');
    expect(initials('Alex Chen')).toBe('AC');
    expect(initials('林')).toBe('林');
    expect(initials('  ')).toBe('?');
    expect(myProjects(state, 'u-alex').map((p) => p.id)).toEqual(['sample-paper', 'sample-atlas']);
    expect(myProjects(state, 'u-zhou').map((p) => p.id)).toEqual(['sample-atlas']);
    expect(myProjects(state, 'u-nobody')).toEqual([]);
  });

  it('initials: one glyph for a CJK or one-word name, two letters for a multi-word Latin name', () => {
    expect(initials('张老师')).toBe('张');
    expect(initials('你')).toBe('你');
    expect(initials('Prof. 张')).toBe('张');
    expect(initials('さくら')).toBe('さ');
    expect(initials('김민수')).toBe('김');
    expect(initials('Alex')).toBe('A');
    expect(initials('alex')).toBe('A');
    expect(initials('Mia')).toBe('M');
    expect(initials('Ben Carter')).toBe('BC');
    expect(initials('Prof. Zhang')).toBe('PZ');
    expect(initials(' ')).toBe('?');
    expect(initials('🙂 Ann')).toBe('A');
    expect(initials('🙂')).toBe('?');
    for (const n of ['张老师', 'Alex', 'Ben Carter', '🙂 Ann', 'Shen Ruo', '周屿']) expect(avatarTextOk(initials(n)), n).toBe(true);
  });

  it('newId gives unique ids with the prefix', () => {
    const ids = Array.from({ length: 50 }, () => newId('p'));
    expect(new Set(ids).size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^p-[0-9a-f-]{36}$/);
  });
});

describe('avatar markup guard', () => {
  it('flags avatar text that would not fit the circle', () => {
    expect(wrappingAvatars('<span class="av av-3" title="张老师">张</span><span class="av av-1 av-sm" title="Ben">BC</span>')).toEqual([]);
    expect(wrappingAvatars('<span class="av av-3" title="张老师">张老</span><span class="av av-1" title="x">ABC</span>')).toEqual(['张老', 'ABC']);
  });
});
