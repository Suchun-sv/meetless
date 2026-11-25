import { describe, expect, it } from 'vitest';
import { toConfirm, viewFor, waitingCount } from '@meetless/core';
import { newInputTarget, sidebarModel, topbarModel } from '../../src/renderer/shell/model';
import { sample } from '../support/app';
import { LOCALES, privateTitle, sampleWith } from './u1';

const today = '2026-11-24';

describe.each(LOCALES)('shell model (%s)', (locale) => {
  const { state } = sample(locale);

  it('Home count is waitingCount and the current project expands with its badges', () => {
    const s = viewFor(state, 'u-alex');
    const m = sidebarModel(s, 'u-alex', { view: 'dash', projectId: 'sample-atlas' }, today);
    expect(m.homeCount).toBe(waitingCount(s, 'u-alex', today));
    expect(m.projects.map((p) => p.id)).toEqual(['sample-paper', 'sample-atlas']);
    expect(m.projects.find((p) => p.id === 'sample-atlas')).toMatchObject({ open: true, sample: true });
    expect(m.projects.find((p) => p.id === 'sample-paper')!.open).toBe(false);
    expect(m.anySample).toBe(true);
  });

  it('badges come from projectBadges and zero counts are left out', () => {
    // u-zhou has one pending input on sample-atlas and nothing on its board: `board` is left
    // out of the badges, `inputs` stays, and the collapsed `total` (= board) is 0.
    const s = viewFor(state, 'u-zhou');
    const m = sidebarModel(s, 'u-zhou', { view: 'dash', projectId: 'sample-atlas' }, today);
    const p = m.projects.find((x) => x.id === 'sample-atlas')!;
    expect(p.badges).toEqual({ inputs: 1 });
    expect(p.total).toBe(0);
  });

  it('a user with no projects gets an empty tree and anySample false', () => {
    const s = viewFor(state, 'u-eve'); // u-eve is an outsider: member of no project.
    const m = sidebarModel(s, 'u-eve', { view: 'home' }, today);
    expect(m.projects).toEqual([]);
    expect(m.anySample).toBe(false);
    expect(m.homeCount).toBe(0);
  });

  it('topbar: project views show the name, members and the To confirm count; global views show only the title', () => {
    const s = viewFor(state, 'u-alex');
    expect(topbarModel(s, 'u-alex', { view: 'members', projectId: 'sample-atlas' }, today)).toMatchObject({
      titleKey: 'nav.members',
      projectName: expect.any(String),
      confirmCount: toConfirm(s, 'u-alex', 'sample-atlas', today).count,
    });
    expect(topbarModel(s, 'u-alex', { view: 'home' }, today)).toMatchObject({ projectId: null, confirmCount: 0 });
  });

  it('new input goes to the current project, else the last one, else the first, else new project', () => {
    expect(newInputTarget({ view: 'home' }, null, [])).toEqual({ view: 'newProject' });
    expect(newInputTarget({ view: 'agents' }, 'sample-atlas', ['sample-paper', 'sample-atlas'])).toEqual({ view: 'dash', projectId: 'sample-atlas' });
    // A stale last project (no longer the user's) falls through to the first of `mine`.
    expect(newInputTarget({ view: 'agents' }, 'sample-gone', ['sample-paper', 'sample-atlas'])).toEqual({ view: 'dash', projectId: 'sample-paper' });
  });
});

describe('shell test support (test/shell/u1.ts)', () => {
  it('sampleWith replays commands through core and rejects an invalid one; privateTitle reads Hp1', () => {
    for (const locale of LOCALES) {
      expect(privateTitle(locale).length).toBeGreaterThan(0);
      const before = sample(locale).state;
      const after = sampleWith(locale, [
        { type: 'work.recorded', payload: { workId: 'w-u1-test', projectId: 'sample-paper', src: 'chat', text: 'test work', date: today } },
      ]);
      // The new work item is unlinked and by its author: it adds one question to "To confirm".
      expect(waitingCount(viewFor(after, 'u-alex'), 'u-alex', today)).toBe(waitingCount(viewFor(before, 'u-alex'), 'u-alex', today) + 1);
      expect(() => sampleWith(locale, [{ type: 'work.recorded', payload: { workId: 'w-bad' } }])).toThrow();
    }
  });
});
