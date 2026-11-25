import { describe, expect, it } from 'vitest';
import { answer, viewFor } from '@meetless/core';
import { createTranslator, SUPPORTED_LOCALES } from '@meetless/i18n';
import { needRoute } from '../src/renderer/app/AppContext';
import { PAGES } from '../src/renderer/app/pages';
import { OVERLAYS } from '../src/renderer/app/overlays';
import { defaultRoute, DRAWER_VIEWS, GLOBAL_VIEWS, materialRoute, PROJECT_VIEWS, SIDEBAR_SECTIONS, VIEW_TITLE_KEY, type Route, type View } from '../src/renderer/app/routes';
import { Log } from './support/log';

const VIEWS: View[] = [...GLOBAL_VIEWS, ...PROJECT_VIEWS];

describe('routes', () => {
  it('every view has a page and a title key in both locales', () => {
    expect(GLOBAL_VIEWS).toEqual(['home', 'agents', 'newProject']);
    expect(PROJECT_VIEWS).toEqual(['dash', 'board', 'inputs', 'artifacts', 'stream', 'deliveries', 'members', 'rounds']);
    expect(Object.keys(PAGES).sort()).toEqual([...VIEWS].sort());
    expect(Object.keys(VIEW_TITLE_KEY).sort()).toEqual([...VIEWS].sort());
    for (const v of VIEWS) {
      expect(typeof PAGES[v], v).toBe('function');
      expect(VIEW_TITLE_KEY[v]).toBe(`nav.${v}`);
      for (const l of SUPPORTED_LOCALES) expect(createTranslator(l).has(VIEW_TITLE_KEY[v]), `${l} ${v}`).toBe(true);
    }
    expect(Object.keys(OVERLAYS).sort()).toEqual(['confirm', 'handoff', 'link']);
    expect(defaultRoute()).toEqual({ view: 'home' });
  });

  it('drawer views are project views; sidebar sections are the six prototype sections', () => {
    expect(SIDEBAR_SECTIONS).toEqual(['dash', 'board', 'inputs', 'artifacts', 'stream', 'deliveries']);
    expect([...DRAWER_VIEWS].sort()).toEqual(['board', 'deliveries', 'stream']);
    for (const v of [...DRAWER_VIEWS, ...SIDEBAR_SECTIONS]) expect(PROJECT_VIEWS).toContain(v);
  });

  it('openNeed keeps a drawer view and otherwise opens the board', () => {
    for (const view of ['board', 'stream', 'deliveries'] as const)
      expect(needRoute({ view, projectId: 'p1', needId: null }, 'p1', 'n1')).toEqual({ view, projectId: 'p1', needId: 'n1' });
    for (const view of ['dash', 'inputs', 'artifacts', 'members', 'rounds'] as const)
      expect(needRoute({ view, projectId: 'p1', focusId: 'in-1' }, 'p1', 'n1')).toEqual({ view: 'board', projectId: 'p1', needId: 'n1' });
    for (const view of ['home', 'agents', 'newProject'] as const) expect(needRoute({ view }, 'p1', 'n1')).toEqual({ view: 'board', projectId: 'p1', needId: 'n1' });
    // A need of another project opens that project's board, even from a drawer view.
    expect(needRoute({ view: 'stream', projectId: 'p1', needId: 'n1' }, 'p2', 'n9')).toEqual({ view: 'board', projectId: 'p2', needId: 'n9' });
  });

  it('a material citation opens the artifact at its version and page, or the input at its paragraph (R68)', () => {
    const atPage: Route = { view: 'artifacts', projectId: 'p1', focusId: 'a1', versionId: 'v2', page: 0 };
    expect(materialRoute({ kind: 'artifact', id: 'a1', projectId: 'p1', versionId: 'v2', page: 0 })).toEqual(atPage);
    expect(materialRoute({ kind: 'artifact', id: 'a1', projectId: 'p1', versionId: null, page: null })).toEqual({ view: 'artifacts', projectId: 'p1', focusId: 'a1' });
    expect(materialRoute({ kind: 'input', id: 'in1', projectId: 'p1', versionId: null, page: null, paraId: 'p4' })).toEqual({ view: 'inputs', projectId: 'p1', focusId: 'in1', paraId: 'p4' });
    expect(materialRoute({ kind: 'input', id: 'in1', projectId: 'p1', versionId: null, page: null })).toEqual({ view: 'inputs', projectId: 'p1', focusId: 'in1' });
    // Opening a need from there drops the material position.
    expect(needRoute(atPage, 'p1', 'n1')).toEqual({ view: 'board', projectId: 'p1', needId: 'n1' });

    // From a real answer: the cited page of the newest version.
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-a', displayName: 'A', locale: 'en' });
    log.emit('project.created', 'u-a', { projectId: 'p1', name: 'P' });
    log.emit('artifact.created', 'u-a', { artifactId: 'a1', projectId: 'p1', kind: 'pptx', title: 'Deck', where: 'local', needIds: [] });
    log.emit('artifact.version_added', 'u-a', { artifactId: 'a1', versionId: 'v2', label: 'v2', date: '2026-11-22', note: '' });
    log.emit('artifactVersion.derived', 'system', { artifactId: 'a1', versionId: 'v2', status: 'ready', pageHashes: [], texts: ['Cover', 'Churn baseline is four percent'], error: null, converter: 'test' });
    const a = answer(viewFor(log.state, 'u-a'), { userId: 'u-a', scope: { kind: 'project', projectId: 'p1' }, text: 'churn baseline?', today: '2026-11-24' }).answer;
    expect(a.intent === 'retrieval' && materialRoute(a.materials[0]!)).toEqual({ view: 'artifacts', projectId: 'p1', focusId: 'a1', versionId: 'v2', page: 1 });
  });
});
