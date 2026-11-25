import type { ComponentType, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { Id } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { OVERLAYS, type Overlay } from '../app/overlays';
import { PAGES } from '../app/pages';
import { DRAWER_VIEWS } from '../app/routes';
import { Composer } from '../chat/Composer';
import { NeedDrawer } from '../needs/NeedDrawer';
import { installKeyboardInset } from '../ui/viewport';
import { closeNav, useNavOpen } from './nav';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { Topbar } from './Topbar';
import './shell.css';

/**
 * The signed-in app: sidebar, top bar, the page for the route with the composer, the status bar,
 * the need drawer on the right, and the overlay. Host duties (contract §8): render
 * `PAGES[route.view]` with `composer`, `NeedDrawer` for `DRAWER_VIEWS` with a `needId`, and
 * `OVERLAYS[overlay.kind]`. Tracks the last project visited: `Sidebar` is tested on its own and so
 * cannot remember it across renders itself, and `newInputTarget` needs it once the user is on a
 * global view.
 *
 * Under 760px (design 2026-11-25 §7) the sidebar is a drawer: `nav-open` on `.app` shows it over
 * the `nav-scrim`, which closes it on a tap; any route change closes it too (`shell/nav.ts`). The
 * keyboard inset is kept on the root for the phone composer.
 */
export function Shell() {
  const { route, overlay } = useApp();
  const [lastProjectId, setLastProjectId] = useState<Id | null>(null);
  useEffect(() => {
    if ('projectId' in route) setLastProjectId(route.projectId);
  }, [route]);
  useEffect(() => installKeyboardInset(window), []);
  const navOpen = useNavOpen(route);
  const Page = PAGES[route.view];
  const drawer = 'projectId' in route && DRAWER_VIEWS.has(route.view) && route.needId ? { projectId: route.projectId, needId: route.needId } : null;
  const OverlayView = overlay ? (OVERLAYS[overlay.kind] as ComponentType<{ overlay: Overlay }>) : null;
  const composer = (opts?: { inline?: boolean }): ReactNode => {
    if (route.view === 'home') return <Composer scope="home" inline={opts?.inline} />;
    if (!('projectId' in route)) return null; // agents, newProject
    return <Composer scope={route.projectId} inline={opts?.inline} />;
  };
  return (
    <div className={`app${drawer ? ' with-drawer' : ''}${navOpen ? ' nav-open' : ''}`}>
      <Sidebar lastProjectId={lastProjectId} />
      {navOpen && <div className="nav-scrim" data-testid="nav-scrim" onClick={closeNav} />}
      <main className="main">
        <Topbar />
        <div className={`scroll v-${route.view}`}>
          <Page composer={composer} />
        </div>
        <StatusBar />
      </main>
      {drawer && <NeedDrawer key={drawer.needId} projectId={drawer.projectId} needId={drawer.needId} />}
      {OverlayView && overlay && <OverlayView overlay={overlay} />}
    </div>
  );
}
