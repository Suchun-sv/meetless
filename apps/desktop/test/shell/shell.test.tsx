import { describe, expect, it, vi } from 'vitest';
import { DOT_RE, projectBadges, toConfirm, viewFor, type Id, type State } from '@meetless/core';
import { focusComposer, registerComposer } from '../../src/renderer/chat/focus';
import { Shell } from '../../src/renderer/shell/Shell';
import { Sidebar } from '../../src/renderer/shell/Sidebar';
import { Topbar } from '../../src/renderer/shell/Topbar';
import { fakeApi, render, sample } from '../support/app';
import { guards } from '../support/guards';
import { alexApi, LOCALES, privateTitle, textOf, zhouApi } from './u1';

const PAPER = 'sample-paper';
const ATLAS = 'sample-atlas';

/** The id of a need by its code, in `projectId` (contract §8 test idiom). */
function codeOf(s: State, projectId: Id, code: string): Id {
  return Object.values(s.needs).find((n) => n.projectId === projectId && n.code === code)!.id;
}

describe.each(LOCALES)('sidebar (%s)', (l) => {
  it('Home count, both projects, the open project with six sections plus members and rounds', () => {
    const api = alexApi(l, { route: { view: 'board', projectId: ATLAS } });
    const html = render(api, <Sidebar />);
    for (const id of ['side-new', 'nav-home', 'nav-new-project', 'nav-board', 'nav-members', 'nav-rounds', 'nav-agents', 'lang-zh-CN', 'lang-en', 'sign-out'])
      expect(html).toContain(`data-testid="${id}"`);
    expect(html.match(/data-testid="nav-project"/g)).toHaveLength(2);
    expect(textOf(html)).toContain(api.t('app.sample'));
    guards(`sidebar ${l}`, html);
  });
});

it('a closed project shows its total; the open one does not', () => {
  const api = alexApi('en', { route: { view: 'dash', projectId: ATLAS } });
  const html = render(api, <Sidebar />);
  const total = projectBadges(api.live, api.me, PAPER, api.today).total;
  expect(total).toBeGreaterThan(0); // the sample has board items waiting on sample-paper
  const paperRow = /data-testid="nav-project" data-project="sample-paper"[^>]*>([\s\S]*?)<\/button>/.exec(html)![1]!;
  expect(paperRow).toContain(`<span class="nav-n soft">${total}</span>`);
  const atlasRow = /data-testid="nav-project" data-project="sample-atlas"[^>]*>([\s\S]*?)<\/button>/.exec(html)![1]!;
  expect(atlasRow).not.toContain('nav-n soft');
});

it('a user with no projects sees nav.noProjects and no project rows', () => {
  const api = fakeApi({ live: viewFor(sample('en').state, 'u-eve'), me: 'u-eve', route: { view: 'home' } });
  const html = render(api, <Sidebar />);
  expect(html).toContain(api.t('nav.noProjects'));
  expect(html).not.toContain('data-testid="nav-project"');
});

describe.each(LOCALES)('topbar (%s)', (l) => {
  it('crumb, member avatars and To confirm with its count on a project view', () => {
    const api = alexApi(l, { route: { view: 'stream', projectId: ATLAS } });
    const html = render(api, <Topbar />);
    const confirmCount = toConfirm(api.live, api.me, ATLAS, api.today).count;
    expect(html).toContain('data-testid="topbar-confirm"');
    expect(html).toContain('data-testid="top-members"');
    expect(textOf(html)).toContain(String(confirmCount));
    expect(textOf(html)).toContain(api.live.projects[ATLAS]!.name);
    guards(`topbar ${l}`, html);
  });
});

it('topbar on Home has no To confirm button', () => {
  const html = render(alexApi('en', { route: { view: 'home' } }), <Topbar />);
  expect(html).not.toContain('data-testid="topbar-confirm"');
  expect(html).not.toContain('data-testid="top-members"');
});

it('the host renders the page, the drawer only on drawer views with a needId, and the overlay', () => {
  const needId = codeOf(sample('en').state, ATLAS, 'N1');
  expect(render(alexApi('en', { route: { view: 'board', projectId: ATLAS, needId } }), <Shell />)).toContain('data-testid="drawer"');
  expect(render(alexApi('en', { route: { view: 'dash', projectId: ATLAS, needId } }), <Shell />)).not.toContain('data-testid="drawer"');
});

it('the composer is passed on project views and Home, not on agents and new project', () => {
  expect(render(alexApi('en', { route: { view: 'home' } }), <Shell />)).toContain('data-testid="composer"');
  expect(render(alexApi('en', { route: { view: 'dash', projectId: ATLAS } }), <Shell />)).toContain('data-testid="composer"');
  expect(render(alexApi('en', { route: { view: 'agents' } }), <Shell />)).not.toContain('data-testid="composer"');
  expect(render(alexApi('en', { route: { view: 'newProject' } }), <Shell />)).not.toContain('data-testid="composer"');
});

it.each(LOCALES)('no dot symbol in the shell (%s)', (l) => expect(DOT_RE.test(textOf(render(alexApi(l), <Shell />)))).toBe(false));

it.each(LOCALES)('shell guards (%s): no kind marks before a need code, no non-geometry inline styles', (l) => {
  const needId = codeOf(sample(l).state, ATLAS, 'N1');
  guards(`shell ${l}`, render(alexApi(l, { route: { view: 'board', projectId: ATLAS, needId } }), <Shell />));
});

it('Zhou’s shell never shows Alex’s private hypothesis', () => {
  expect(textOf(render(zhouApi('en', { route: { view: 'dash', projectId: PAPER } }), <Shell />))).not.toContain(privateTitle('en'));
});

describe('chat/focus: registerComposer + focusComposer', () => {
  it('focuses the registered element', () => {
    const focus = vi.fn();
    registerComposer({ focus } as unknown as HTMLTextAreaElement);
    focusComposer();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no composer is registered', () => {
    registerComposer(null);
    expect(() => focusComposer()).not.toThrow();
  });
});
