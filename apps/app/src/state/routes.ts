import type { Href } from 'expo-router';
import type { Id } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import type { Route as RendererRoute } from '@renderer/app/routes';

/**
 * The route table. Every page has a file under apps/app/app/ (owner named in its header). Features
 * navigate with `routeToHref(route)` (or `useGo()`), using the old renderer's Route shape plus the
 * views that are their own screens here.
 *
 *   /                                   home (我的)                 A1 features/home
 *   /projects/new                       new project                 A1 features/projects
 *   /reminders                          deadline reminders          A1 features/reminders
 *   /projects                           项目 tab home (phones)      P0 shell
 *   /inbox                              需求 tab, the inbox (B1)    A3 features/inbox
 *   /confirm                            old 待确认 (all projects)   A2 features/confirm
 *   /search                             search                      A4 features/search
 *   /settings                           settings                    A4 features/settings
 *   /agents                             agent access                A4 features/settings
 *   /p/:pid                             看板 dash                   A1 features/dashboard
 *   /p/:pid/board                       需求 board                  A2 features/needs
 *   /p/:pid/need/:needId                need detail and edit        A2 features/needs
 *   /p/:pid/confirm                     待确认                      A2 features/confirm
 *   /p/:pid/inputs[/:inputId]?para=     输入                        A4 features/inputs
 *   /p/:pid/artifacts[/:id]?version=&page=  产物                    A4 features/artifacts
 *   /p/:pid/stream                      动态                        A4 features/activity
 *   /p/:pid/deliveries?round=           交付                        A4 features/deliveries
 *   /p/:pid/members, /p/:pid/rounds     members, rounds             A1 features/projects
 *   /p/:pid/chat                        project agent (phone)       A3 features/chat
 *   /p/:pid/import                      paste import (new input)    A3 features/import
 *   /p/:pid/handoff?need=               handoff (form for a need)   A3 features/handoff
 *   /p/:pid/lineage                     脉络 segment (project)      A3 features/lineage
 *   /p/:pid/lineage/:needId             脉络 of one need            A3 features/lineage
 */
export type ExtraGlobalView = 'search' | 'settings' | 'reminders' | 'projects' | 'confirmAll' | 'inbox';
export type ExtraProjectView = 'confirm' | 'chat' | 'import' | 'handoff' | 'lineage';

export type AppRoute =
  | RendererRoute
  | { view: ExtraGlobalView }
  | { view: ExtraProjectView; projectId: Id; needId?: Id | null };

/** The six project sections in the sidebar, in order: 看板 需求 输入 产物 动态 交付. */
export const PROJECT_SECTIONS = ['dash', 'board', 'inputs', 'artifacts', 'stream', 'deliveries'] as const;
export type ProjectSection = (typeof PROJECT_SECTIONS)[number];

export const SECTION_TITLE_KEY: Record<ProjectSection | 'members' | 'rounds', MessageKey> = {
  dash: 'nav.dash',
  board: 'nav.board',
  inputs: 'nav.inputs',
  artifacts: 'nav.artifacts',
  stream: 'nav.stream',
  deliveries: 'nav.deliveries',
  members: 'nav.members',
  rounds: 'nav.rounds',
};

const enc = encodeURIComponent;

function query(q: Record<string, string | number | null | undefined>): string {
  const parts = Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${enc(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/** The Expo Router path for a route (renderer shape or the extra views). */
export function routeToHref(r: AppRoute): Href {
  return routePath(r) as Href;
}

export function routePath(r: AppRoute): string {
  switch (r.view) {
    case 'home':
      return '/';
    case 'agents':
      return '/agents';
    case 'newProject':
      return '/projects/new';
    case 'search':
    case 'settings':
    case 'reminders':
    case 'projects':
      return `/${r.view}`;
    case 'confirmAll':
    case 'inbox':
      // mobile-v2: the old 待确认 page lives inside the 「需求」 inbox.
      return '/inbox';
  }
  const p = `/p/${enc(r.projectId)}`;
  // The handoff form for a need: /handoff?need= (the page reads it).
  if (r.view === 'handoff') return `${p}/handoff${query({ need: r.needId })}`;
  // A need opened from a board, stream or deliveries view goes to its own screen.
  if ('needId' in r && r.needId && r.view !== 'lineage') return `${p}/need/${enc(r.needId)}`;
  switch (r.view) {
    case 'dash':
      return p;
    case 'board':
    case 'stream':
    case 'members':
    case 'rounds':
    case 'confirm':
    case 'chat':
    case 'import':
      return `${p}/${r.view}`;
    case 'lineage':
      return r.needId ? `${p}/lineage/${enc(r.needId)}` : `${p}/lineage`;
    case 'deliveries':
      return `${p}/deliveries${query({ round: r.round })}`;
    case 'inputs':
      return r.focusId ? `${p}/inputs/${enc(r.focusId)}${query({ para: r.paraId })}` : `${p}/inputs`;
    case 'artifacts':
      return r.focusId ? `${p}/artifacts/${enc(r.focusId)}${query({ version: r.versionId, page: r.page })}` : `${p}/artifacts`;
  }
}
