import { describe, expect, it } from 'vitest';
import { currentOrLatestRound, needByCode, type Id, type State } from '@meetless/core';
import { createTranslator, formatDay, type Locale } from '@meetless/i18n';
import { HandoffModal } from '../../src/renderer/collab/HandoffModal';
import { dueChoices, handoffPayload, handoffPeople } from '../../src/renderer/collab/model';
import { fakeApi, render, sample } from '../support/app';
import { guards } from '../support/guards';
import { Log } from '../support/log';
import { click, recorder } from './harness';

const ATLAS = 'sample-atlas';
const TODAY = '2026-11-24';
const LOCALES: Locale[] = ['zh-CN', 'en'];

const count = (html: string, needle: string) => html.split(needle).length - 1;

/** The opening `<button ...>` tag that carries `data-person="id"`, whatever the attribute order. */
function personTag(html: string, id: string): string {
  const m = new RegExp(`<button[^>]*data-person="${id}"[^>]*>`).exec(html);
  if (!m) throw new Error(`no person button for ${id}`);
  return m[0];
}

function modalHtml(live: State, me: string, locale: Locale, projectId: string, needId: string, toId?: Id | null, ask?: string): string {
  const overlay = { kind: 'handoff' as const, projectId, needId, toId, ask };
  return render(fakeApi({ live, me, locale, today: TODAY, overlay }), <HandoffModal overlay={overlay} />);
}

/** A single-member project: `u-me` created project `p0` and a shared need on it. */
function soloProject(): Log {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
  log.emit('project.created', 'u-me', { projectId: 'p0', name: 'Solo' });
  log.emit('need.created', 'u-me', {
    needId: 'n0',
    projectId: 'p0',
    kind: 'ext',
    title: 'Solo need',
    roundId: null,
    source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
  });
  return log;
}

/** A shared parent `n-a` and Alex's private child `n-child`, both on project `p`. */
function sharedParentPrivateChild(): Log {
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
  return log;
}

/** A project with `u-me`, one member in a role, and one role-less member. */
function roleAndRoleless(): Log {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-me', displayName: 'Me', locale: 'en' });
  log.emit('user.registered', 'system', { userId: 'u-a', displayName: 'A', locale: 'en' });
  log.emit('user.registered', 'system', { userId: 'u-b', displayName: 'B', locale: 'en' });
  log.emit('project.created', 'u-me', { projectId: 'pr', name: 'Roles' });
  log.emit('project.member_added', 'u-me', { projectId: 'pr', userId: 'u-a' });
  log.emit('project.member_added', 'u-me', { projectId: 'pr', userId: 'u-b' });
  log.emit('role.created', 'u-me', { roleId: 'r-product', projectId: 'pr', name: 'Product' });
  log.emit('role.member_assigned', 'u-me', { roleId: 'r-product', userId: 'u-a' });
  log.emit('need.created', 'u-me', {
    needId: 'nr',
    projectId: 'pr',
    kind: 'ext',
    title: 'Roles need',
    roundId: null,
    source: { src: 'chat', date: '2026-11-01', quote: 'q', ref: 'r' },
  });
  return log;
}

describe('HandoffModal', () => {
  it('lists Atlas members by role without Alex, with three due chips and the prompt preview', () => {
    const live = sample('en').state;
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const html = modalHtml(live, 'u-alex', 'en', ATLAS, n2.id);
    const t = createTranslator('en').t;

    expect(html).toContain('data-testid="overlay-handoff"');
    expect(html).toContain(t('ho.title'));
    expect(html).toContain(n2.code);
    expect(html).toContain(n2.title);
    expect(html).not.toContain('data-person="u-alex"');
    for (const id of ['u-lin', 'u-ruo', 'u-ben', 'u-zhou']) expect(html).toContain(`data-person="${id}"`);
    expect(count(html, 'data-testid="ho-due"')).toBe(3);
    expect(html).toContain('data-testid="lk-prompt"');
    expect(html).toContain('data-testid="ho-send"');
  });

  it('a preset recipient from the overlay is selected', () => {
    const live = sample('en').state;
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const html = modalHtml(live, 'u-alex', 'en', ATLAS, n2.id, 'u-zhou');

    expect(personTag(html, 'u-zhou')).toMatch(/class="person on"/);
    expect(personTag(html, 'u-lin')).toMatch(/class="person"/);
  });

  it('with no toId, the first listed person is selected', () => {
    const live = sample('en').state;
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const html = modalHtml(live, 'u-alex', 'en', ATLAS, n2.id);
    const groups = handoffPeople(live, ATLAS, 'u-alex');
    const first = groups[0]!.memberIds[0]!;
    const rest = groups.flatMap((g) => g.memberIds).filter((id) => id !== first);

    expect(personTag(html, first)).toMatch(/class="person on"/);
    for (const id of rest) expect(personTag(html, id)).toMatch(/class="person"/);
  });

  it('a project with only me shows ho.nobody and a disabled Send', () => {
    const log = soloProject();
    const t = createTranslator('en').t;
    const html = modalHtml(log.state, 'u-me', 'en', 'p0', 'n0');

    expect(html).toContain(t('ho.nobody'));
    expect(html).not.toContain('data-testid="ho-person"');
    expect(html).toMatch(/data-testid="ho-send"[^>]*disabled=""/);
  });

  it('a private need cannot be handed off', () => {
    const log = sharedParentPrivateChild();
    const t = createTranslator('en').t;
    const html = modalHtml(log.state, 'u-alex', 'en', 'p', 'n-child');

    expect(html).toContain(t('ho.privateFirst'));
    expect(html).not.toContain('data-testid="ho-send"');
    expect(html).not.toContain('data-testid="ho-person"');
    expect(html).not.toContain('data-testid="lk-prompt"');
    expect(html).toContain(t('close'));
  });

  it('a need not in live at all (or in another project) shows dr.missing and a close', () => {
    const live = sample('en').state;
    const t = createTranslator('en').t;

    const missing = modalHtml(live, 'u-alex', 'en', ATLAS, 'no-such-need');
    expect(missing).toContain(t('dr.missing'));
    expect(missing).not.toContain('data-testid="ho-send"');
    expect(missing).toContain(t('close'));

    const n2 = needByCode(live, ATLAS, 'N2')!;
    const otherProject = modalHtml(live, 'u-alex', 'en', 'sample-paper', n2.id);
    expect(otherProject).toContain(t('dr.missing'));
    expect(otherProject).not.toContain('data-testid="ho-send"');
  });

  it('the due chips carry the key label and the formatted date, matching dueChoices', () => {
    const live = sample('en').state;
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const html = modalHtml(live, 'u-alex', 'en', ATLAS, n2.id);
    const t = createTranslator('en').t;
    const choices = dueChoices(TODAY, currentOrLatestRound(live, ATLAS));
    expect(choices.map((c) => c.key)).toEqual(['week', 'next', 'round']);
    for (const c of choices) {
      expect(html).toContain(t(`ho.d.${c.key}`));
      expect(html).toContain(formatDay(c.date, 'en'));
    }
  });

  it('ho-send submits handoffPayload with the modal initial state, then closes the modal', async () => {
    const live = sample('en').state;
    const n2 = needByCode(live, ATLAS, 'N2')!;
    const groups = handoffPeople(live, ATLAS, 'u-alex');
    const first = groups[0]!.memberIds[0]!;
    const choices = dueChoices(TODAY, currentOrLatestRound(live, ATLAS));
    const week = choices.find((c) => c.key === 'week')!;
    const overlay = { kind: 'handoff' as const, projectId: ATLAS, needId: n2.id };
    const rec = recorder();
    const api = rec.api(live, 'u-alex');
    api.overlay = overlay;

    await click(api, () => HandoffModal({ overlay }), 'ho-send');

    expect(rec.calls).toHaveLength(1);
    const call = rec.calls[0]!;
    expect(call.type).toBe('handoff.created');
    const handoffId = call.payload.handoffId as string;
    expect(handoffId).toMatch(/^h-/);
    expect(call.payload).toEqual(handoffPayload({ handoffId, projectId: ATLAS, need: n2, toId: first, ask: '', due: week.date }));
    expect(call.payload).toMatchObject({ toId: first, ask: n2.title, due: week.date });
    expect(api.overlay).toBeNull();
  });

  it.each(LOCALES)('a role-less member is listed under ho.noRole, after the role group, and me never appears (%s)', (locale) => {
    const log = roleAndRoleless();
    const t = createTranslator(locale).t;
    const html = modalHtml(log.state, 'u-me', locale, 'pr', 'nr');

    expect(html).not.toContain('data-person="u-me"');
    expect(html).toContain('data-person="u-a"');
    expect(html).toContain('data-person="u-b"');
    expect(html).toContain(t('ho.noRole'));
    expect(html).toContain('Product');

    const roleIdx = html.indexOf('Product');
    const noRoleIdx = html.indexOf(t('ho.noRole'));
    const bIdx = html.indexOf('data-person="u-b"');
    expect(roleIdx).toBeGreaterThan(-1);
    expect(noRoleIdx).toBeGreaterThan(roleIdx);
    expect(bIdx).toBeGreaterThan(noRoleIdx);
    expect(personTag(html, 'u-b')).toContain('data-testid="ho-person"');
  });

  it.each(LOCALES)('the handoff modal has no dot symbol (%s)', (locale) => {
    const live = sample(locale).state;
    const n2 = needByCode(live, ATLAS, 'N2')!;
    guards(`handoff modal ${locale}`, modalHtml(live, 'u-alex', locale, ATLAS, n2.id));

    const log = sharedParentPrivateChild();
    guards(`handoff modal private ${locale}`, modalHtml(log.state, 'u-alex', locale, 'p', 'n-child'));
    guards(`handoff modal missing ${locale}`, modalHtml(live, 'u-alex', locale, ATLAS, 'no-such-need'));

    const solo = soloProject();
    guards(`handoff modal nobody ${locale}`, modalHtml(solo.state, 'u-me', locale, 'p0', 'n0'));
  });
});
