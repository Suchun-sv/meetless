import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { DOT_RE, projectBadges, replay, viewFor, waitingCount, type DomainEvent, type Id, type State } from '@meetless/core';
import { createTranslator, SUPPORTED_LOCALES, type Locale } from '@meetless/i18n';
import type { SubmitResult } from '@meetless/client/bridge';
import type { AppApi, Overlay } from '../src/renderer/app/AppContext';
import { DRAWER_VIEWS, GLOBAL_VIEWS, PROJECT_VIEWS, SIDEBAR_SECTIONS, VIEW_TITLE_KEY, type Route, type View } from '../src/renderer/app/routes';
import { App } from '../src/renderer/App';
import { SignIn } from '../src/renderer/setup/SignIn';
import { Shell } from '../src/renderer/shell/Shell';
import { Sidebar } from '../src/renderer/shell/Sidebar';
import { StatusBar } from '../src/renderer/shell/StatusBar';
import { Topbar } from '../src/renderer/shell/Topbar';
import { fakeApi, fakeBridge, render, sample } from './support/app';
import { guards, marksBeforeCodes, nonGeometryStyles } from './support/guards';
import { Log } from './support/log';

const LOCALES: Locale[] = [...SUPPORTED_LOCALES];
const PAPER = 'sample-paper';
const ATLAS = 'sample-atlas';
const TODAY = '2026-11-24';
const COMPOSER_VIEWS = new Set<View>(['home', 'dash', 'board', 'inputs', 'artifacts', 'stream', 'deliveries']);
const OVERLAY_KINDS: Overlay['kind'][] = ['confirm', 'handoff', 'link'];

const routeFor = (view: View, projectId: Id, needId: Id | null = null): Route =>
  (GLOBAL_VIEWS as readonly View[]).includes(view) ? ({ view } as Route) : ({ view, projectId, needId } as Route);
const overlayFor = (kind: Overlay['kind'], projectId: Id, needId: Id): Overlay => (kind === 'confirm' ? { kind, projectId } : { kind, projectId, needId });
const testids = (html: string, id: string) => html.split(`data-testid="${id}"`).length - 1;
const codeOf = (s: State, projectId: Id, code: string) => Object.values(s.needs).find((n) => n.projectId === projectId && n.code === code)!.id;

/** What the client of `userId` holds: a replay of only the events the service streams to that user. */
function streamState(events: readonly DomainEvent[], scopes: readonly { projectId: Id | null; privateTo: Id | null }[], full: State, userId: Id): State {
  return replay(
    events.filter((_e, i) => {
      const sc = scopes[i]!;
      if (sc.privateTo !== null && sc.privateTo !== userId) return false;
      return sc.projectId === null || (full.projects[sc.projectId]?.memberIds.includes(userId) ?? false);
    }),
  );
}

/** Every screen of the shell for one user: each page, each drawer view with a need, each overlay; plus sign-in. */
function screens(live: State, me: Id, locale: Locale, projectId: Id, needId: Id): [string, string][] {
  const api = (route: Route, overlay: Overlay | null = null) => fakeApi({ live, me, locale, route, overlay, today: TODAY });
  const out: [string, string][] = [];
  for (const v of [...GLOBAL_VIEWS, ...PROJECT_VIEWS]) out.push([`page ${v}`, render(api(routeFor(v, projectId)), <Shell />)]);
  for (const v of DRAWER_VIEWS) out.push([`drawer ${v}`, render(api(routeFor(v, projectId, needId)), <Shell />)]);
  for (const k of OVERLAY_KINDS) out.push([`overlay ${k}`, render(api(routeFor('board', projectId), overlayFor(k, projectId, needId)), <Shell />)]);
  out.push(['signin', render(api({ view: 'home' }), <SignIn />)]);
  return out;
}

/** Calls the onClick of the element with `testid` that `Comp` renders (inside the provider, so hooks work). */
function click(Comp: () => ReactNode, api: AppApi, testid: string, nth = 0) {
  let out: ReactNode = null;
  const Probe = () => {
    out = Comp();
    return null;
  };
  render(api, <Probe />);
  const found: ReactElement<Record<string, unknown>>[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object' && 'props' in node) {
      const e = node as ReactElement<Record<string, unknown>>;
      if (e.props['data-testid'] === testid) found.push(e);
      walk(e.props.children);
    }
  };
  walk(out);
  (found[nth]!.props.onClick as () => void)();
}

describe('page-level guards', () => {
  it('each guard catches its probe', () => {
    expect(marksBeforeCodes('<span class="km km-ext"></span><span>N1</span>').length).toBeGreaterThan(0);
    expect(marksBeforeCodes('<div><span class="kind-hyp">H</span><span class="mono">H2 title</span></div>').length).toBeGreaterThan(0);
    expect(marksBeforeCodes('<span class="needchip-marker">x</span>Np3').length).toBeGreaterThan(0);
    expect(marksBeforeCodes('<i></i><b>H2</b>').length).toBeGreaterThan(0);
    expect(marksBeforeCodes('<svg/><span>Hp1</span>').length).toBeGreaterThan(0);
    expect(marksBeforeCodes('<span>◆</span><span>N4</span>').length).toBeGreaterThan(0);
    expect(marksBeforeCodes('<p>★ N1 is open</p>').length).toBeGreaterThan(0);
    expect(marksBeforeCodes('<button class="needchip"><span class="mono faint">N1</span><span class="nc-t">Title</span></button>')).toEqual([]);
    expect(marksBeforeCodes('<span class="need-mark">x</span><span>N2</span>').length).toBeGreaterThan(0);
    expect(marksBeforeCodes('<p>Ask about N1 and H2 today</p><span class="brand-mark"></span>Meetless')).toEqual([]);
    // Letter badges: a short element right before a code.
    for (const html of [
      '<span>N</span><span>N1</span>',
      '<span>H</span> <span class="mono">H2</span>',
      '<div><span>N</span></div><div><span class="mono">N1</span></div>',
      '<b>Np</b>Np3',
      '<span>假设</span><span>Hp1</span>',
      '<span>需</span> <span>N2</span>',
      '<span>EXT</span><span>N4</span>',
      '<i>3</i><b>H12</b>',
      '<span class="badge">Ext</span> <span>N1</span>',
      '<span class="pill tone-info">Hyp</span><span>H2</span>',
    ])
      expect(marksBeforeCodes(html), html).not.toEqual([]);
    // Ordinary text stays allowed: a label word followed by a space, a short word with a space, a name.
    for (const html of [
      '<span>Owner</span> <span>N1</span>',
      '<span class="lbl">Need </span><span>N1</span>',
      '<span>to</span> <span>N1</span>',
      '<span>Lin</span><span>N1</span>',
      '<span>负责人</span> <span>N1</span>',
      '<div><h3>Needs</h3><button class="needchip"><span class="mono faint">N1</span><span class="nc-t">Title</span></button></div>',
      // Two-character words that are no badges: a heading, a label before a chip, a number in a table cell.
      '<div><h3>需求</h3><button class="needchip"><span class="mono faint">N1</span><span class="nc-t">Title</span></button></div>',
      '<span>关联</span><button class="needchip"><span class="mono faint">N2</span></button>',
      '<span>关联</span><span>N1</span>',
      '<table><tr><td>12</td><td>N1</td></tr></table>',
      '<table><tr><td>12</td><td><span class="mono">H3</span></td></tr></table>',
    ])
      expect(marksBeforeCodes(html), html).toEqual([]);
    expect(nonGeometryStyles('<div style="left:10%;width:2%"></div>')).toEqual([]);
    expect(nonGeometryStyles('<div style="min-width:0;max-height:40px;flex-basis:20%;grid-column:1 / 3;gap:4px;inset:0;transform:translateX(-50%) scale(1.02)"></div>')).toEqual([]);
    expect(nonGeometryStyles('<div style="color:red;left:1px"></div>')).toEqual(['color:red']);
    expect(nonGeometryStyles('<div style="background:var(--color-ai)"></div>').length).toBe(1);
    expect(nonGeometryStyles('<div style="opacity:0.5;z-index:2;cursor:pointer"></div>')).toEqual(['opacity:0.5', 'z-index:2', 'cursor:pointer']);
    expect(nonGeometryStyles('<div style="transform:rotate(45deg)"></div>')).toEqual(['transform:rotate(45deg)']);
  });
});

describe('renderer skeleton (sample, me u-alex)', () => {
  it('each page renders page-<view> in zh-CN and en', () => {
    for (const locale of LOCALES) {
      const live = viewFor(sample(locale).state, 'u-alex');
      for (const v of [...GLOBAL_VIEWS, ...PROJECT_VIEWS]) {
        const html = render(fakeApi({ live, me: 'u-alex', locale, route: routeFor(v, PAPER), today: TODAY }), <Shell />);
        expect(testids(html, `page-${v}`), `${locale} ${v}`).toBe(1);
        expect(html.match(/data-testid="page-/g)!.length).toBe(1);
        for (const id of ['side-new', 'nav-home', 'nav-new-project', 'nav-agents', 'lang-zh-CN', 'lang-en', 'sign-out', 'sync-status']) expect(testids(html, id), `${v} ${id}`).toBe(1);
        expect(html).toContain('data-testid="sync-status" data-state="online"');
        const project = (PROJECT_VIEWS as readonly View[]).includes(v);
        expect(testids(html, 'topbar-confirm'), `${v} topbar-confirm`).toBe(project ? 1 : 0);
        expect(testids(html, 'composer'), `${v} composer`).toBe(COMPOSER_VIEWS.has(v) ? 1 : 0);
        if (COMPOSER_VIEWS.has(v)) expect(html).toContain(`data-testid="composer" data-scope="${v === 'home' ? 'home' : PAPER}"`);
        expect(html).toContain(createTranslator(locale).t(VIEW_TITLE_KEY[v]));
      }
    }
  });

  it('new project is a name field and a create button', () => {
    const live = viewFor(sample('en').state, 'u-alex');
    const html = render(fakeApi({ live, me: 'u-alex', route: { view: 'newProject' } }), <Shell />);
    expect(testids(html, 'project-name')).toBe(1);
    expect(testids(html, 'project-create')).toBe(1);
  });

  it('the sidebar lists only the user’s projects, expands the current one with badges, and shows the sample label', () => {
    const log = new Log({ initial: sample('en').state });
    log.emit('project.created', 'u-zhou', { projectId: 'p-zhou', name: 'Zhou only' });
    const live = log.state;
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const html = render(fakeApi({ live, me: 'u-alex', locale, route: { view: 'dash', projectId: PAPER }, today: TODAY }), <Sidebar />);
      expect([...html.matchAll(/data-testid="nav-project" data-project="([^"]+)"/g)].map((m) => m[1])).toEqual([PAPER, ATLAS]);
      expect(html).not.toContain('Zhou only');
      for (const s of SIDEBAR_SECTIONS) expect(testids(html, `nav-${s}`), s).toBe(1);
      const section = (s: string) => new RegExp(`data-testid="nav-${s}"[^>]*>(.*?)</button>`).exec(html)![1]!;
      const b = projectBadges(live, 'u-alex', PAPER, TODAY);
      expect(b.inputs + b.board).toBeGreaterThan(0);
      for (const [s, n] of [['inputs', b.inputs], ['board', b.board]] as const) expect(section(s).includes(`<span class="nav-n soft">${n}</span>`), s).toBe(n > 0);
      for (const s of ['dash', 'artifacts', 'stream', 'deliveries']) expect(section(s)).not.toContain('nav-n');
      // The collapsed project shows its total; the expanded one does not repeat it.
      const atlas = new RegExp(`data-project="${ATLAS}"[^>]*>(.*?)</button>`).exec(html)![1]!;
      const total = projectBadges(live, 'u-alex', ATLAS, TODAY).total;
      expect(atlas.includes(`<span class="nav-n soft">${total}</span>`)).toBe(total > 0);
      expect(new RegExp(`data-testid="nav-home"[^>]*>(.*?)</button>`).exec(html)![1]).toContain(`<span class="nav-n">${waitingCount(live, 'u-alex', TODAY)}</span>`);
      expect(html).toContain(tr.t('app.sample'));
      expect(html).toContain(`data-testid="lang-${locale}" class="on"`);
    }
    // From a global view no project is expanded.
    const home = render(fakeApi({ live, me: 'u-alex', route: { view: 'home' } }), <Sidebar />);
    expect(testids(home, 'nav-board')).toBe(0);

    const own = new Log();
    own.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex Chen', locale: 'en' });
    own.emit('project.created', 'u-alex', { projectId: 'p-mine', name: 'Mine' });
    const plain = render(fakeApi({ live: own.state, me: 'u-alex', route: { view: 'home' } }), <Sidebar />);
    expect(plain).toContain('data-project="p-mine"');
    expect(plain).not.toContain(createTranslator('en').t('app.sample'));
  });

  it('shell actions: new input opens the current project’s dash, a project opens its dash, 待确认 opens the confirm overlay', () => {
    const live = viewFor(sample('en').state, 'u-alex');
    const api = (route: Route) => fakeApi({ live, me: 'u-alex', route });
    let a = api({ view: 'board', projectId: ATLAS, needId: 'x' });
    click(Sidebar, a, 'side-new');
    expect(a.route).toEqual({ view: 'dash', projectId: ATLAS });
    a = api({ view: 'home' });
    click(Sidebar, a, 'side-new');
    expect(a.route).toEqual({ view: 'dash', projectId: PAPER });
    click(Sidebar, a, 'nav-project', 1);
    expect(a.route).toEqual({ view: 'dash', projectId: ATLAS });
    a = api({ view: 'dash', projectId: PAPER });
    click(Sidebar, a, 'nav-inputs');
    expect(a.route).toEqual({ view: 'inputs', projectId: PAPER });
    click(Sidebar, a, 'nav-new-project');
    expect(a.route).toEqual({ view: 'newProject' });
    click(Sidebar, a, 'lang-zh-CN');
    expect(a.locale).toBe('zh-CN');
    a = api({ view: 'stream', projectId: PAPER });
    click(Topbar, a, 'topbar-confirm');
    expect(a.overlay).toEqual({ kind: 'confirm', projectId: PAPER });
  });

  it('the status bar shows skipped records as warning text, only when there are any', () => {
    const { state, events } = sample('en');
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const a = fakeApi({ live: state, me: 'u-alex', locale });
      expect(render(a, <StatusBar />)).not.toContain('sync-skipped');
      a.skipped = events.slice(0, 2);
      const html = render(a, <StatusBar />);
      expect(html).toContain(`<span class="small tone-warning" data-testid="sync-skipped">${tr.t('sync.skipped', { n: 2 })}</span>`);
      guards(`${locale} status bar`, html);
    }
  });

  it('the drawer host renders NeedDrawer only on board, stream and deliveries with a needId', () => {
    for (const locale of LOCALES) {
      const live = viewFor(sample(locale).state, 'u-alex');
      const n1 = codeOf(live, PAPER, 'N1');
      for (const v of PROJECT_VIEWS) {
        const html = render(fakeApi({ live, me: 'u-alex', locale, route: routeFor(v, PAPER, n1) }), <Shell />);
        const on = DRAWER_VIEWS.has(v);
        expect(testids(html, 'drawer'), v).toBe(on ? 1 : 0);
        expect(html.startsWith(`<div class="app${on ? ' with-drawer' : ''}">`), v).toBe(true);
        if (on) {
          expect(html).toContain(`data-testid="drawer" data-need="${n1}"`);
          expect(html).toContain(live.needs[n1]!.title);
        }
        expect(testids(render(fakeApi({ live, me: 'u-alex', locale, route: routeFor(v, PAPER) }), <Shell />), 'drawer')).toBe(0);
      }
    }
  });

  it('the overlay host renders the component for each overlay kind', () => {
    const live = viewFor(sample('en').state, 'u-alex');
    const n1 = codeOf(live, PAPER, 'N1');
    for (const kind of OVERLAY_KINDS) {
      const html = render(fakeApi({ live, me: 'u-alex', route: { view: 'board', projectId: PAPER }, overlay: overlayFor(kind, PAPER, n1) }), <Shell />);
      for (const k of OVERLAY_KINDS) expect(testids(html, `overlay-${k}`), `${kind} ${k}`).toBe(k === kind ? 1 : 0);
    }
    const none = render(fakeApi({ live, me: 'u-alex', route: { view: 'board', projectId: PAPER } }), <Shell />);
    expect(none).not.toContain('data-testid="overlay-');
  });

  it('no rendered markup contains a DOT_RE character, in both languages', () => {
    for (const locale of LOCALES) {
      const live = viewFor(sample(locale).state, 'u-alex');
      for (const [name, html] of screens(live, 'u-alex', locale, PAPER, codeOf(live, PAPER, 'N1'))) guards(`${locale} ${name}`, html);
      for (const [name, html] of screens(live, 'u-alex', locale, ATLAS, codeOf(live, ATLAS, 'N1'))) guards(`${locale} atlas ${name}`, html);
      const tr = createTranslator(locale);
      // The hypothesis drawer: the code is not preceded by anything either.
      const h = Object.values(live.needs).find((n) => n.projectId === PAPER && n.kind === 'hyp' && n.privateTo === null)!;
      guards(`${locale} hypothesis drawer`, render(fakeApi({ live, me: 'u-alex', locale, route: routeFor('board', PAPER, h.id) }), <Shell />));
      expect(render(fakeApi({ live, me: 'u-alex', locale }), <App bridge={null} />)).not.toMatch(DOT_RE);
      expect(tr.t('app.name')).toBe('Meetless');
    }
  });

  it('Zhou’s render of the sample never contains Alex’s private hypothesis', () => {
    for (const locale of LOCALES) {
      const { state: full, events, scopes } = sample(locale);
      const hyp = Object.values(full.needs).find((n) => n.privateTo === 'u-alex' && n.kind === 'hyp')!;
      expect(hyp.code).toBe('Hp1');
      // The check can see it: Alex's own drawer shows the code and the title.
      const alex = render(fakeApi({ live: viewFor(full, 'u-alex'), me: 'u-alex', locale, route: routeFor('board', hyp.projectId, hyp.id) }), <Shell />);
      expect(alex).toContain('Hp1');
      expect(alex).toContain(hyp.title);
      for (const live of [viewFor(full, 'u-zhou'), streamState(events, scopes, full, 'u-zhou')]) {
        expect(live.needs[hyp.id]).toBeUndefined();
        const shots = [
          ...screens(live, 'u-zhou', locale, ATLAS, codeOf(live, ATLAS, 'N1')),
          // Even a route that names the private need (in its own project, and in Zhou's) shows nothing of it.
          ...screens(live, 'u-zhou', locale, hyp.projectId, hyp.id),
          ...screens(live, 'u-zhou', locale, ATLAS, hyp.id),
        ];
        for (const [name, html] of shots) {
          expect(html.includes('Hp1'), `${locale} ${name}`).toBe(false);
          expect(html.includes(hyp.title), `${locale} ${name}`).toBe(false);
        }
      }
    }
  });

  it('fakeBridge resolves every method it does not override to NOT_AVAILABLE, submit as a rejected SubmitResult', async () => {
    const bridge = fakeBridge({ listRepos: async () => [] });
    expect(await bridge.readBlob('x')).toEqual({ ok: false, code: 'NOT_AVAILABLE' });
    expect(await bridge.api('me', {})).toEqual({ ok: false, code: 'NOT_AVAILABLE' });
    expect(await bridge.captureRun({ projectId: 'p' })).toEqual({ ok: false, code: 'NOT_AVAILABLE' });
    expect(await bridge.listRepos()).toEqual([]);
    expect(typeof bridge.subscribe(() => undefined)).toBe('function');
    // submit answers with a valid SubmitResult (the rejected variant), so code reading r.kind works on the fake.
    const r: SubmitResult = await fakeBridge().submit({ id: 'c1', type: 'project.created', payload: { projectId: 'p-y', name: 'Y' } });
    expect(r).toEqual({ kind: 'rejected', code: 'NOT_AVAILABLE' });
    const viaApi: SubmitResult = await fakeApi({ live: sample('en').state, me: 'u-alex' }).submit('project.created', { projectId: 'p-z', name: 'Z' });
    expect(viaApi).toEqual({ kind: 'rejected', code: 'NOT_AVAILABLE' });
    const calls: unknown[] = [];
    const api: AppApi = fakeApi({ live: sample('en').state, me: 'u-alex', bridge: fakeBridge({ submit: async (cmd) => (calls.push(cmd), { kind: 'accepted', seq: 1 }) }) });
    expect(await api.submit('project.created', { projectId: 'p-x', name: 'X' })).toEqual({ kind: 'accepted', seq: 1 });
    expect(calls).toMatchObject([{ type: 'project.created', payload: { projectId: 'p-x', name: 'X' } }]);
    api.openNeed(PAPER, 'n1');
    expect(api.route).toEqual({ view: 'board', projectId: PAPER, needId: 'n1' });
    api.closeNeed();
    expect(api.route).toEqual({ view: 'board', projectId: PAPER, needId: null });
  });
});
