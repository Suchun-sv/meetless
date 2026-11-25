import { afterEach, describe, expect, it } from 'vitest';
import type { Id } from '@meetless/core';
import type { AppApi } from '../../src/renderer/app/AppContext';
import { BackButton } from '../../src/renderer/needs/NeedDrawer';
import { closeNav } from '../../src/renderer/shell/nav';
import { Shell } from '../../src/renderer/shell/Shell';
import { Sidebar } from '../../src/renderer/shell/Sidebar';
import { Topbar } from '../../src/renderer/shell/Topbar';
import { click } from '../collab/harness';
import { render } from '../support/app';
import { guards } from '../support/guards';
import { alexApi, LOCALES, textOf } from '../shell/u1';

/*
 * The phone shell (design 2026-11-25 §7): the nav drawer's toggle, scrim and route-change close,
 * and the need page's back button. There is no jsdom: each step calls the handler the rendered
 * tree holds, then renders again.
 */

const ATLAS = 'sample-atlas';

afterEach(closeNav);

const appClasses = (html: string) => /<div class="(app[^"]*)"/.exec(html)![1]!.split(' ');
const toggleTag = (html: string) => /<button[^>]*data-testid="nav-toggle"[^>]*>/.exec(html)![0];

function shell(api: AppApi, name: string): string {
  const html = render(api, <Shell />);
  guards(name, html);
  return html;
}

function expectOpen(html: string, open: boolean) {
  expect(appClasses(html).includes('nav-open')).toBe(open);
  expect(toggleTag(html)).toContain(`aria-expanded="${open}"`);
  expect(html.includes('data-testid="nav-scrim"')).toBe(open);
}

describe.each(LOCALES)('phone shell (%s)', (l) => {
  it('nav-toggle toggles nav-open on .app and aria-expanded on itself', async () => {
    const api = alexApi(l, { route: { view: 'dash', projectId: ATLAS } });
    const closed = shell(api, `${l} closed`);
    expectOpen(closed, false);
    expect(toggleTag(closed)).toContain(`aria-label="${api.t('web.menu')}"`);
    await click(api, () => Topbar(), 'nav-toggle');
    expectOpen(shell(api, `${l} open`), true);
    await click(api, () => Topbar(), 'nav-toggle');
    expectOpen(shell(api, `${l} closed again`), false);
  });

  it('a tap on nav-scrim closes it', async () => {
    const api = alexApi(l, { route: { view: 'home' } });
    await click(api, () => Topbar(), 'nav-toggle');
    expectOpen(shell(api, `${l} open`), true);
    await click(api, () => Shell(), 'nav-scrim');
    expectOpen(shell(api, `${l} after scrim`), false);
  });

  it('a route change closes it: a sidebar row, or any go(); it does not reopen on the way back', async () => {
    const api = alexApi(l, { route: { view: 'dash', projectId: ATLAS } });
    await click(api, () => Topbar(), 'nav-toggle');
    await click(api, () => Sidebar(), 'nav-home');
    expect(api.route).toEqual({ view: 'home' });
    expectOpen(shell(api, `${l} after nav-home`), false);
    await click(api, () => Topbar(), 'nav-toggle');
    expectOpen(shell(api, `${l} open on home`), true);
    api.go({ view: 'board', projectId: ATLAS });
    expectOpen(shell(api, `${l} after go`), false);
    api.go({ view: 'home' });
    expectOpen(shell(api, `${l} back home`), false);
  });

  it('the need page has drawer-back, which closes it with closeNeed', async () => {
    const base = alexApi(l);
    const needId: Id = Object.values(base.live.needs).find((n) => n.projectId === ATLAS && n.privateTo === null)!.id;
    const api = alexApi(l, { route: { view: 'board', projectId: ATLAS, needId } });
    const html = shell(api, `${l} need`);
    const back = /<button[^>]*data-testid="drawer-back"[^>]*>([\s\S]*?)<\/button>/.exec(html);
    expect(back).not.toBeNull();
    expect(textOf(back![1]!)).toBe(api.t('web.back'));
    await click(api, () => BackButton(), 'drawer-back');
    expect(api.route).toEqual({ view: 'board', projectId: ATLAS, needId: null });
    expect(shell(api, `${l} after back`)).not.toContain('data-testid="drawer"');
  });
});
