import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOT_RE, emptyState, type Artifact, type ArtifactVersion, type State } from '@meetless/core';
import { createTranslator, SUPPORTED_LOCALES, type Locale } from '@meetless/i18n';
import { ArtifactViewer, OfficeView } from '../../src/renderer/artifacts/ArtifactViewer';
import { PagesPreview } from '../../src/renderer/artifacts/PagesPreview';
import { downloadBlob } from '../../src/renderer/artifacts/blobs';
import { mountEditor, type DocsApi } from '../../src/renderer/artifacts/docsApi';
import { OFFICE_LOAD_TIMEOUT_MS, type OfficeEvent, type OfficeReason, type OfficeState } from '../../src/renderer/artifacts/office';
import { fakeApi, fakeBridge, render } from '../support/app';
import { guards } from '../support/guards';
import { Log } from '../support/log';

/*
 * Task 6: the OnlyOffice view-mode state machine's rendering, and the LibreOffice page-image
 * fallback. `officeStep` itself is covered by office.test.ts; this is "static render of the
 * presentational parts" (brief), so it renders `OfficeView` and `PagesPreview` directly with a
 * given `OfficeState`, rather than the real async `office.config` round trip (there is no jsdom
 * in this repo, so a component's own `useEffect` never runs in `render()`; `ArtifactViewer`'s own
 * test below only ever sees the `config` phase for that reason).
 */

const LOCALES: Locale[] = [...SUPPORTED_LOCALES];
const TODAY = '2026-11-24';
const noop = () => undefined;
const H1 = `sha256:${'a'.repeat(64)}`;
const H2 = `sha256:${'b'.repeat(64)}`;

function docxFixture(): { live: State; artifact: Artifact; version: ArtifactVersion } {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale: 'en' });
  log.emit('project.created', 'u-alex', { projectId: 'p1', name: 'P1' });
  log.emit('artifact.created', 'u-alex', { artifactId: 'a1', projectId: 'p1', kind: 'docx', title: 'Spec', where: 'Word', needIds: [] });
  log.emit('artifact.version_added', 'u-alex', {
    artifactId: 'a1',
    versionId: 'a1:v1',
    label: 'v1',
    date: '2026-11-20',
    note: 'Draft',
    blobHash: H1,
    mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  log.emit(
    'artifactVersion.derived',
    'system',
    { artifactId: 'a1', versionId: 'a1:v1', status: 'ready', pageHashes: [H1, H2], texts: ['Intro paragraph', 'Second page text'], error: null, converter: 'LibreOffice' },
  );
  const artifact = log.state.artifacts['a1']!;
  return { live: log.state, artifact, version: artifact.versions[0]! };
}

function pdfFixture() {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale: 'en' });
  log.emit('project.created', 'u-alex', { projectId: 'p1', name: 'P1' });
  log.emit('artifact.created', 'u-alex', { artifactId: 'a2', projectId: 'p1', kind: 'pdf', title: 'Report', where: 'PDF', needIds: [] });
  log.emit('artifact.version_added', 'u-alex', { artifactId: 'a2', versionId: 'a2:v1', label: 'v1', date: '2026-11-20', note: 'Final', blobHash: H1, mediaType: 'application/pdf' });
  const artifact = log.state.artifacts['a2']!;
  return { live: log.state, artifact, version: artifact.versions[0]! };
}

describe('OfficeView (static render of the presentational office-path parts)', () => {
  it('fallback names the reason and shows LibreOffice pages for a docx', () => {
    const { live, artifact, version } = docxFixture();
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const state: OfficeState = { phase: 'fallback', reason: 'not_configured' };
      const html = render(
        fakeApi({ live, me: 'u-alex', locale, today: TODAY }),
        <OfficeView state={state} artifact={artifact} version={version} onEvent={noop} />,
      );
      guards(`office fallback docx ${locale}`, html);
      expect(html).toContain('data-testid="af-fallback" data-reason="not_configured"');
      expect(html).toContain(tr.t('af.reason.not_configured'));
      expect(html).toContain(tr.t('af.fallbackReason', { reason: tr.t('af.reason.not_configured') }));
      // The LibreOffice sentence only because pages are shown; the original file is offered too (I8).
      expect(html).toContain(tr.t('af.fallbackPages'));
      expect(html).toContain('data-testid="af-original"');
      expect(html).toContain('data-testid="af-pages"');
      expect(html).toContain('Intro paragraph');
      expect(html).toContain(tr.t('af.previewBy', { engine: 'LibreOffice' }));
      expect(html).not.toContain('data-testid="af-pdf-fallback"');
    }
  });

  it('a pdf fallback shows the note and the original file, no pages', () => {
    const { live, artifact, version } = pdfFixture();
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const state: OfficeState = { phase: 'fallback', reason: 'unavailable' };
      const html = render(
        fakeApi({ live, me: 'u-alex', locale, today: TODAY }),
        <OfficeView state={state} artifact={artifact} version={version} onEvent={noop} />,
      );
      guards(`office fallback pdf ${locale}`, html);
      expect(html).toContain('data-testid="af-fallback" data-reason="unavailable"');
      expect(html).toContain(tr.t('af.reason.unavailable'));
      expect(html).toContain(tr.t('af.fallbackReason', { reason: tr.t('af.reason.unavailable') }));
      expect(html).toContain(tr.t('af.pdfFallback'));
      expect(html).toContain('data-testid="af-original"');
      expect(html).toContain(tr.t('af.original'));
      expect(html).not.toContain('data-testid="af-pages"');
      // No LibreOffice pages follow for a PDF, so the fallback never promises them (I8).
      expect(html).not.toContain(tr.t('af.fallbackPages'));
    }
  });

  it('a pending or failed preview still offers the original file, and never the LibreOffice sentence (I8)', () => {
    const { live, artifact, version } = docxFixture();
    const pendingVersion = { ...version, derived: null };
    const failedVersion = { ...version, derived: { status: 'failed' as const, pageHashes: [], texts: [], error: 'boom', converter: null } };
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      for (const [name, v, copy] of [
        ['pending', pendingVersion, 'af.previewPending'],
        ['failed', failedVersion, 'af.previewFailed'],
      ] as const) {
        const html = render(
          fakeApi({ live, me: 'u-alex', locale, today: TODAY }),
          <OfficeView state={{ phase: 'fallback', reason: 'not_configured' }} artifact={artifact} version={v} onEvent={noop} />,
        );
        guards(`office fallback ${name} ${locale}`, html);
        expect(html).toContain(tr.t('af.fallbackReason', { reason: tr.t('af.reason.not_configured') }));
        expect(html).toContain(tr.t(copy));
        expect(html).toContain('data-testid="af-original"');
        expect(html).not.toContain(tr.t('af.fallbackPages'));
      }
    }
  });

  it('a version with no file names the reason only: no pages promise, no endless preview, no download (I8)', () => {
    const { live, artifact, version } = docxFixture();
    const { live: pdfLive, artifact: pdfArtifact, version: pdfVersion } = pdfFixture();
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      for (const [name, l, a, v] of [
        ['docx', live, artifact, { ...version, blobHash: null, mediaType: null, derived: null }],
        ['pdf', pdfLive, pdfArtifact, { ...pdfVersion, blobHash: null }],
      ] as const) {
        const html = render(
          fakeApi({ live: l, me: 'u-alex', locale, today: TODAY }),
          <OfficeView state={{ phase: 'fallback', reason: 'no_file' }} artifact={a} version={v} onEvent={noop} />,
        );
        guards(`office fallback no file ${name} ${locale}`, html);
        expect(html).toContain(tr.t('af.fallbackReason', { reason: tr.t('af.reason.no_file') }));
        expect(html).not.toContain(tr.t('af.fallbackPages'));
        expect(html).not.toContain(tr.t('af.previewPending'));
        expect(html).not.toContain(tr.t('af.pdfFallback'));
        expect(html).not.toContain('data-testid="af-original"');
      }
    }
  });

  it('pending and failed derivations say so (PagesPreview directly)', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const api = fakeApi({ live: emptyState(), me: 'u-alex', locale, today: TODAY });

      const pending = render(api, <PagesPreview kind="docx" derived={null} urls={[]} />);
      guards(`pages pending ${locale}`, pending);
      expect(pending).toContain(tr.t('af.previewPending'));
      expect(pending).not.toContain('data-testid="af-pages"');

      const failed = render(
        api,
        <PagesPreview kind="docx" derived={{ status: 'failed', pageHashes: [], texts: [], error: 'boom', converter: null }} urls={[]} />,
      );
      guards(`pages failed ${locale}`, failed);
      expect(failed).toContain(tr.t('af.previewFailed'));
      expect(failed).not.toContain('data-testid="af-pages"');
    }
  });

  it('the fallback marks and labels the target page (route.page) in the LibreOffice pages', () => {
    const { live, artifact, version } = docxFixture();
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const state: OfficeState = { phase: 'fallback', reason: 'unavailable' };
      const html = render(
        fakeApi({ live, me: 'u-alex', locale, today: TODAY }),
        <OfficeView state={state} artifact={artifact} version={version} page={1} onEvent={noop} />,
      );
      guards(`office page mark ${locale}`, html);
      // Page 1 (zero-based) is marked (`.on`, `aria-current="page"`) and labelled "page 2".
      expect(html).toContain('class="oo-page on" data-page="1" aria-current="page"');
      expect(html).toContain(tr.t('af.page', { n: 2 }));
      // Page 0 is neither marked nor current.
      expect(html).toContain('class="oo-page" data-page="0"');
      expect(html).not.toMatch(/data-page="0"[^>]*aria-current/);
    }
  });

  it('the ready state renders the OnlyOffice frame host and the read-only bar, with the page hint', () => {
    const { live, artifact, version } = docxFixture();
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const state: OfficeState = { phase: 'ready', documentServerUrl: 'http://127.0.0.1:55435', config: {} };
      const html = render(
        fakeApi({ live, me: 'u-alex', locale, today: TODAY }),
        <OfficeView state={state} artifact={artifact} version={version} page={2} onEvent={noop} />,
      );
      guards(`office ready ${locale}`, html);
      expect(html).toContain('data-testid="oo-frame"');
      expect(html).toContain(tr.t('af.viewer'));
      expect(html).toContain(tr.t('af.readonly'));
      expect(html).toContain('data-testid="af-page-hint"');
      expect(html).toContain(tr.t('af.pageHint', { n: 3 }));
      expect(html).not.toContain('data-testid="af-fallback"');
    }
  });

  it('the loading state shows the frame host and the bar too, but no page hint yet', () => {
    const { live, artifact, version } = docxFixture();
    const state: OfficeState = { phase: 'loading', documentServerUrl: 'http://127.0.0.1:55435', config: {} };
    const html = render(
      fakeApi({ live, me: 'u-alex', locale: 'en', today: TODAY }),
      <OfficeView state={state} artifact={artifact} version={version} page={2} onEvent={noop} />,
    );
    guards('office loading', html);
    expect(html).toContain('data-testid="oo-frame"');
    expect(html).toContain(createTranslator('en').t('af.viewer'));
    expect(html).not.toContain('data-testid="af-page-hint"');
  });

  it('no DOT_RE character in any office state, in both locales', () => {
    const { live, artifact, version } = docxFixture();
    const { live: pdfLive, artifact: pdfArtifact, version: pdfVersion } = pdfFixture();
    const reasons: OfficeReason[] = ['not_configured', 'unsupported_kind', 'no_file', 'unavailable'];
    for (const locale of LOCALES) {
      const states: OfficeState[] = [
        { phase: 'config' },
        { phase: 'loading', documentServerUrl: 'http://127.0.0.1:55435', config: {} },
        { phase: 'ready', documentServerUrl: 'http://127.0.0.1:55435', config: {} },
        ...reasons.map((reason): OfficeState => ({ phase: 'fallback', reason })),
      ];
      for (const state of states) {
        const html = render(
          fakeApi({ live, me: 'u-alex', locale, today: TODAY }),
          <OfficeView state={state} artifact={artifact} version={version} page={1} onEvent={noop} />,
        );
        guards(`office dots docx ${locale} ${state.phase}`, html);
        expect(DOT_RE.test(html), `${locale} ${state.phase}`).toBe(false);
      }
      const pdfHtml = render(
        fakeApi({ live: pdfLive, me: 'u-alex', locale, today: TODAY }),
        <OfficeView state={{ phase: 'fallback', reason: 'unavailable' }} artifact={pdfArtifact} version={pdfVersion} onEvent={noop} />,
      );
      guards(`office dots pdf ${locale}`, pdfHtml);
      expect(DOT_RE.test(pdfHtml)).toBe(false);
    }
  });
});

describe('mountEditor (I7: the editor must call back in time)', () => {
  afterEach(() => void vi.useRealTimers());

  function fakeDocsApi(onCreate?: (events: { onAppReady: () => void; onError: () => void }) => void): { api: DocsApi; destroyed: () => number } {
    let destroyed = 0;
    class DocEditor {
      constructor(_id: string, config: Record<string, unknown>) {
        onCreate?.(config['events'] as { onAppReady: () => void; onError: () => void });
      }
      destroyEditor() {
        destroyed++;
      }
    }
    return { api: { DocEditor }, destroyed: () => destroyed };
  }

  it('an editor that never calls back times out after OFFICE_LOAD_TIMEOUT_MS', () => {
    vi.useFakeTimers();
    const events: OfficeEvent[] = [];
    const { api } = fakeDocsApi();
    mountEditor(api, 'oo-editor-x', {}, (e) => events.push(e));
    vi.advanceTimersByTime(OFFICE_LOAD_TIMEOUT_MS - 1);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(events).toEqual([{ type: 'timeout' }]);
  });

  it('app_ready clears the timer; a later editor error still falls back', () => {
    vi.useFakeTimers();
    const events: OfficeEvent[] = [];
    let cb!: { onAppReady: () => void; onError: () => void };
    const { api } = fakeDocsApi((e) => (cb = e));
    mountEditor(api, 'oo-editor-x', {}, (e) => events.push(e));
    cb.onAppReady();
    vi.advanceTimersByTime(OFFICE_LOAD_TIMEOUT_MS * 2);
    expect(events).toEqual([{ type: 'app_ready' }]);
    cb.onError();
    expect(events).toEqual([{ type: 'app_ready' }, { type: 'editor_error' }]);
  });

  it('dispose clears the timer and destroys the editor', () => {
    vi.useFakeTimers();
    const events: OfficeEvent[] = [];
    const fake = fakeDocsApi();
    const editor = mountEditor(fake.api, 'oo-editor-x', {}, (e) => events.push(e));
    editor.dispose();
    vi.advanceTimersByTime(OFFICE_LOAD_TIMEOUT_MS * 2);
    expect(events).toEqual([]);
    expect(fake.destroyed()).toBe(1);
  });
});

describe('downloadBlob (M7)', () => {
  it('returns the bridge refusal, so the caller can show errorText(code)', async () => {
    const bridge = fakeBridge({ readBlob: async () => ({ ok: false, code: 'NOT_FOUND' }) });
    expect(await downloadBlob(bridge, H1, 'Spec.docx', 'application/pdf')).toEqual({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('ArtifactViewer (routing)', () => {
  it('a file-kind version with no office.config answer yet shows the loading placeholder, with data-office-phase="config"', () => {
    const { live, artifact, version } = docxFixture();
    for (const locale of LOCALES) {
      const html = render(fakeApi({ live, me: 'u-alex', locale, today: TODAY }), <ArtifactViewer artifact={artifact} version={version} page={1} />);
      guards(`artifact viewer office routing ${locale}`, html);
      expect(html).toContain('data-testid="af-viewer"');
      expect(html).toContain('data-office-phase="config"');
      expect(DOT_RE.test(html)).toBe(false);
    }
  });

  it('a version-less artifact shows af.noVersions', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale: 'en' });
    log.emit('project.created', 'u-alex', { projectId: 'p1', name: 'P1' });
    log.emit('artifact.created', 'u-alex', { artifactId: 'a3', projectId: 'p1', kind: 'docx', title: 'Empty', where: 'Word', needIds: [] });
    const html = render(fakeApi({ live: log.state, me: 'u-alex', today: TODAY }), <ArtifactViewer artifact={log.state.artifacts['a3']!} version={null} />);
    guards('artifact viewer no version', html);
    expect(html).toContain(createTranslator('en').t('af.noVersions'));
    expect(html).not.toContain('data-office-phase');
  });

  it('a code artifact reads from its capture source (task 7 routing), never the office path, with or without a version', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale: 'en' });
    log.emit('project.created', 'u-alex', { projectId: 'p1', name: 'P1' });
    log.emit('artifact.created', 'u-alex', { artifactId: 'a4', projectId: 'p1', kind: 'code', title: 'Repo', where: 'GitHub', needIds: [] });
    log.emit('artifact.version_added', 'u-alex', { artifactId: 'a4', versionId: 'a4:v1', label: 'v1', date: '2026-11-20', note: 'First commit' });
    const artifact = log.state.artifacts['a4']!;
    const version = artifact.versions[0]!;
    const api = fakeApi({ live: log.state, me: 'u-alex', today: TODAY });

    const withVersion = render(api, <ArtifactViewer artifact={artifact} version={version} />);
    guards('artifact viewer code (version selected)', withVersion);
    expect(withVersion).toContain('data-testid="af-viewer" data-kind="code"');
    expect(withVersion).toContain('data-testid="af-source" data-kind="repo"');
    expect(withVersion).not.toContain('data-office-phase');
    expect(withVersion).not.toContain('data-testid="oo-frame"');
    // The version's own note still only shows in the side pane (ArtifactSide); the centre viewer
    // is the artifact's capture source regardless of which version is selected.
    expect(withVersion).not.toContain('First commit');

    // No version at all: still the source view, not af.noVersions (there is nothing to preview
    // either way; the repo's commits are the real content for a code artifact).
    const noVersion = render(api, <ArtifactViewer artifact={artifact} version={null} />);
    guards('artifact viewer code (no version)', noVersion);
    expect(noVersion).toContain('data-testid="af-source" data-kind="repo"');
    expect(noVersion).not.toContain(createTranslator('en').t('af.noVersions'));
  });
});
