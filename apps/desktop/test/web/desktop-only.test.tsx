import { describe, expect, it } from 'vitest';
import type { Artifact } from '@meetless/core';
import { createTranslator } from '@meetless/i18n';
import { SourceView } from '../../src/renderer/artifacts/SourcePanel';
import type { SourcePanelData } from '../../src/renderer/artifacts/capture-ui';
import type { SourceRow } from '../../src/renderer/artifacts/source-model';
import { Sidebar } from '../../src/renderer/shell/Sidebar';
import { fakeApi, render, sample } from '../support/app';
import { guards } from '../support/guards';
import { LOCALES } from '../shell/u1';
import { Log } from '../support/log';

const noop = () => undefined;

function fixture(kind: Artifact['kind']) {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale: 'en' });
  log.emit('project.created', 'u-alex', { projectId: 'p1', name: 'P1' });
  log.emit('artifact.created', 'u-alex', { artifactId: 'a1', projectId: 'p1', kind, title: 'Spec', where: 'X', url: kind === 'overleaf' ? 'https://git.overleaf.com/abc' : null, needIds: [] });
  return { live: log.state, artifact: log.state.artifacts['a1']! };
}

function data(kind: SourceRow['kind']): SourcePanelData {
  return {
    row: { kind, ready: false, code: null, repoName: null, syncedAt: null, lastRunAt: null },
    overleafToken: false,
    notionConnected: false,
    notionWaiting: false,
    syncing: false,
    commits: [],
    refresh: noop,
    onPickRepo: noop,
    onUnbindRepo: noop,
    onSaveToken: noop,
    onClearToken: noop,
    onSync: noop,
    onConnectNotion: noop,
    onDisconnectNotion: noop,
  };
}

const CASES: [Artifact['kind'], SourceRow['kind'], string[]][] = [
  ['code', 'repo', ['af-pick-repo']],
  ['overleaf', 'overleaf', ['af-ol-token', 'af-ol-sync']],
  ['notion', 'notion', ['af-notion-connect']],
];

describe('desktop-only features on the web', () => {
  it.each(LOCALES)('(%s) local git, Overleaf and Notion show the notice instead of their controls; electron is as before', (l) => {
    const t = createTranslator(l).t;
    for (const [kind, rowKind, ids] of CASES) {
      const { live, artifact } = fixture(kind);
      const web = fakeApi({ live, me: 'u-alex', locale: l });
      web.snapshot = { ...web.snapshot, host: 'web' };
      const html = render(web, <SourceView artifact={artifact} data={data(rowKind)} />);
      expect(html, kind).toContain('data-testid="desktop-only"');
      expect(html).toContain(t('web.desktopOnly'));
      for (const id of [...ids, 'cap-run']) expect(html, `${kind} ${id}`).not.toContain(`data-testid="${id}"`);
      guards(`${l} ${kind} web source`, html);

      const desk = fakeApi({ live, me: 'u-alex', locale: l });
      desk.snapshot = { ...desk.snapshot, host: 'electron' };
      const deskHtml = render(desk, <SourceView artifact={artifact} data={data(rowKind)} />);
      expect(deskHtml).not.toContain('data-testid="desktop-only"');
      for (const id of [...ids, 'cap-run']) expect(deskHtml, `${kind} ${id}`).toContain(`data-testid="${id}"`);
    }
  });

  it.each(LOCALES)('(%s) the web sidebar has sign-out and no update entry', (l) => {
    const api = fakeApi({ live: sample(l).state, me: 'u-alex', locale: l });
    api.snapshot = { ...api.snapshot, host: 'web' };
    const html = render(api, <Sidebar />);
    expect(html).toContain('data-testid="sign-out"');
    expect(html).not.toContain('data-testid="update"');
    guards(`${l} web sidebar`, html);
  });
});
