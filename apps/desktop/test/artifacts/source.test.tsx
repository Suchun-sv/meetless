import { describe, expect, it } from 'vitest';
import { CAPTURE_CODES, type CaptureStatus, type CommitInfo } from '@meetless/client/bridge';
import type { Artifact, State } from '@meetless/core';
import { DOT_RE, emptyState, noDots } from '@meetless/core';
import { createTranslator, SUPPORTED_LOCALES, type Locale } from '@meetless/i18n';
import { capErrorText, commitsFetchKey, createCaptureRunner, createNotionConnector, createNotionReader, createOverleafSyncer, type NotionRead } from '../../src/renderer/artifacts/capture-ui';
import { NotionPage, SourceView } from '../../src/renderer/artifacts/SourcePanel';
import { sourceRow, type SourceRow } from '../../src/renderer/artifacts/source-model';
import { Btn } from '../../src/renderer/ui/primitives';
import { fakeApi, fakeBridge, render } from '../support/app';
import { guards } from '../support/guards';
import { Log } from '../support/log';

/*
 * Task 7: the capture UI (source panel and capture buttons). `SourceView` is presentational, so
 * most of these tests feed it a hand-built `SourcePanelData` rather than driving the real bridge
 * calls behind `useSourcePanel` (that plumbing mirrors task 6's `useOfficeState`, which this repo
 * -- no jsdom, no simulated clicks -- can only exercise up to its first synchronous state, exactly
 * as `viewer.test.tsx` already does for `OfficeArtifactViewer`). `createCaptureRunner` is the
 * concurrency guard and the notices behind `useCaptureRun`: it is a plain object, not a hook, so
 * it is unit-tested directly, including while a call is still pending.
 */

const LOCALES: Locale[] = [...SUPPORTED_LOCALES];
const TODAY = '2026-11-24';
const noop = () => undefined;

function fixture(kind: Artifact['kind'], url: string | null = null): { live: State; artifact: Artifact } {
  const log = new Log();
  log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale: 'en' });
  log.emit('project.created', 'u-alex', { projectId: 'p1', name: 'P1' });
  log.emit('artifact.created', 'u-alex', { artifactId: 'a1', projectId: 'p1', kind, title: 'Spec', where: 'X', url, needIds: [] });
  const artifact = log.state.artifacts['a1']!;
  return { live: log.state, artifact };
}

/** A `SourcePanelData` with every handler a no-op, for a given `row` and overrides. */
function panelData(row: SourceRow, over: Partial<Parameters<typeof SourceView>[0]['data']> = {}): Parameters<typeof SourceView>[0]['data'] {
  return {
    row,
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
    ...over,
  };
}

function row(over: Partial<SourceRow>): SourceRow {
  return { kind: 'repo', ready: false, code: null, repoName: null, syncedAt: null, lastRunAt: null, ...over };
}

describe('sourceRow', () => {
  it('maps each artifact kind to its source and readiness', () => {
    const commit: CommitInfo = { commit: 'abc1234', parents: [], author: 'Alex', date: '2026-11-20', subject: 'Fix' };
    const status: CaptureStatus = {
      overleafToken: true,
      notion: 'connected',
      sources: [
        { artifactId: 'a-code', kind: 'repo', ready: true, code: null, repo: { id: 'r1', name: 'meetless', head: commit.commit, branch: 'main' }, syncedAt: null, lastRunAt: '2026-11-20T09:00:00Z' },
        { artifactId: 'a-ol', kind: 'overleaf', ready: false, code: 'no_token', repo: null, syncedAt: null, lastRunAt: null },
        { artifactId: 'a-notion', kind: 'notion', ready: true, code: null, repo: null, syncedAt: null, lastRunAt: null },
      ],
    };
    const { artifact: code } = fixture('code');
    const { artifact: overleaf } = fixture('overleaf', 'https://git.overleaf.com/abc123');
    const { artifact: notion } = fixture('notion', 'https://notion.so/page');
    const { artifact: pdf } = fixture('pdf');

    expect(sourceRow({ ...code, id: 'a-code' }, status)).toEqual({ kind: 'repo', ready: true, code: null, repoName: 'meetless', syncedAt: null, lastRunAt: '2026-11-20T09:00:00Z' });
    expect(sourceRow({ ...overleaf, id: 'a-ol' }, status)).toEqual({ kind: 'overleaf', ready: false, code: 'no_token', repoName: null, syncedAt: null, lastRunAt: null });
    expect(sourceRow({ ...notion, id: 'a-notion' }, status)).toEqual({ kind: 'notion', ready: true, code: null, repoName: null, syncedAt: null, lastRunAt: null });
    // Upload kind (pdf), and unknown to `st` (no matching source): not ready, no reason yet.
    expect(sourceRow(pdf, status)).toEqual({ kind: 'upload', ready: false, code: null, repoName: null, syncedAt: null, lastRunAt: null });
    // `st` not yet loaded.
    expect(sourceRow(code, null)).toEqual({ kind: 'repo', ready: false, code: null, repoName: null, syncedAt: null, lastRunAt: null });
  });
});

describe('capErrorText', () => {
  it('returns the capture copy for a known code, and falls back to errorText for a code with none (CAPTURE_FAILED)', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const api = fakeApi({ live: emptyState(), me: 'u-alex', locale });
      expect(capErrorText(api.t, api.errorText, 'no_repo')).toBe(tr.t('cap.err.no_repo'));
      // CAPTURE_FAILED (the bridge's own unexpected-failure code) is not in CAPTURE_CODES, so no
      // `cap.err.CAPTURE_FAILED` key was ever added; capErrorText must fall back to errorText.
      expect(CAPTURE_CODES as readonly string[]).not.toContain('CAPTURE_FAILED');
      expect(capErrorText(api.t, api.errorText, 'CAPTURE_FAILED')).toBe(api.errorText('CAPTURE_FAILED'));
    }
  });

  it('every cap.err code has copy in both locales', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      for (const c of CAPTURE_CODES) expect(tr.has(`cap.err.${c}`), `${locale} cap.err.${c}`).toBe(true);
    }
  });
});

describe('createCaptureRunner', () => {
  it('runs once, is a no-op for a second concurrent call, and notifies the recorded+queued count', async () => {
    let calls = 0;
    let resolve!: (v: { ok: true; runId: string; result: { read: number; recorded: number; duplicate: number; queued: number; rejected: never[]; skipped: never[] } }) => void;
    const bridge = fakeBridge({
      captureRun: () =>
        new Promise((res) => {
          calls++;
          resolve = res as typeof resolve;
        }),
    });
    const api = fakeApi({ live: emptyState(), me: 'u-alex', bridge });
    const runner = createCaptureRunner({ bridge, t: api.t, errorText: api.errorText, notify: api.notify }, 'p1');

    expect(runner.running).toBe(false);
    const p1 = runner.run();
    const p2 = runner.run(); // no-op: a second call while one is in flight.
    expect(runner.running).toBe(true);

    // The button would render disabled right now (real `Btn`, not a hand-rolled string).
    const html = render(api, <Btn testId="cap-run" disabled={runner.running}>{api.t('cap.running')}</Btn>);
    expect(html).toMatch(/data-testid="cap-run"[^>]*disabled/);

    resolve({ ok: true, runId: 'r1', result: { read: 3, recorded: 2, duplicate: 0, queued: 1, rejected: [], skipped: [] } });
    await Promise.all([p1, p2]);

    expect(calls).toBe(1);
    expect(runner.running).toBe(false);
    expect(api.notices.some((n) => n.text === api.t('cap.text', { n: 3 }))).toBe(true);
  });

  it('notifies cap.none when nothing was recorded or queued, and cap.skippedN when something was skipped', async () => {
    const bridge = fakeBridge({
      captureRun: async () => ({ ok: true, runId: 'r1', result: { read: 1, recorded: 0, duplicate: 0, queued: 0, rejected: [], skipped: [{ artifactId: 'a1', code: 'no_repo' as const }] } }),
    });
    const api = fakeApi({ live: emptyState(), me: 'u-alex', bridge });
    const runner = createCaptureRunner({ bridge, t: api.t, errorText: api.errorText, notify: api.notify }, 'p1');
    await runner.run();
    expect(api.notices.some((n) => n.text === api.t('cap.none'))).toBe(true);
    expect(api.notices.some((n) => n.text === api.t('cap.skippedN', { n: 1 }))).toBe(true);
  });

  it('a run that only met duplicates says nothing new, never "Captured" (M1)', async () => {
    const bridge = fakeBridge({
      captureRun: async () => ({ ok: true, runId: 'r1', result: { read: 2, recorded: 0, duplicate: 2, queued: 0, rejected: [], skipped: [] } }),
    });
    const api = fakeApi({ live: emptyState(), me: 'u-alex', bridge });
    await createCaptureRunner({ bridge, t: api.t, errorText: api.errorText, notify: api.notify }, 'p1').run({ artifactIds: ['a1'] });
    expect(api.notices.map((n) => n.text)).toEqual([api.t('cap.none')]);
  });

  it('when the one requested artifact was skipped, the notice names why instead of cap.skippedN (M2)', async () => {
    for (const locale of LOCALES) {
      const bridge = fakeBridge({
        captureRun: async () => ({ ok: true, runId: 'r1', result: { read: 0, recorded: 0, duplicate: 0, queued: 0, rejected: [], skipped: [{ artifactId: 'a1', code: 'git_failed' as const }] } }),
      });
      const api = fakeApi({ live: emptyState(), me: 'u-alex', locale, bridge });
      await createCaptureRunner({ bridge, t: api.t, errorText: api.errorText, notify: api.notify }, 'p1').run({ artifactIds: ['a1'] });
      const texts = api.notices.map((n) => n.text);
      expect(texts).toContain(api.t('cap.err.git_failed'));
      expect(texts).not.toContain(api.t('cap.skippedN', { n: 1 }));
    }
  });

  it('notifies capErrorText on a bridge refusal', async () => {
    const bridge = fakeBridge({ captureRun: async () => ({ ok: false, code: 'no_repo' }) });
    const api = fakeApi({ live: emptyState(), me: 'u-alex', bridge });
    const runner = createCaptureRunner({ bridge, t: api.t, errorText: api.errorText, notify: api.notify }, 'p1');
    await runner.run();
    expect(api.notices.some((n) => n.tone === 'error' && n.text === api.t('cap.err.no_repo'))).toBe(true);
  });
});

describe('createNotionConnector (fix round 1, review finding 2: the unmount race)', () => {
  it('a notionConnect() that resolves after destroy() opens nothing, starts no poll and updates no state', async () => {
    let resolveConnect!: (v: { ok: true; authorizeUrl: string }) => void;
    let captureStatusCalls = 0;
    const bridge = fakeBridge({
      notionConnect: () => new Promise((res) => void (resolveConnect = res as typeof resolveConnect)),
      // If a poll ever started, it would call this; it must not, because connect() resolves after destroy().
      captureStatus: async () => {
        captureStatusCalls++;
        return { ok: true, status: { overleafToken: false, notion: 'connected' as const, sources: [] } };
      },
    });
    const onConnected = () => {
      throw new Error('onConnected must not be called: connect() resolved after destroy()');
    };
    const waitingChanges: boolean[] = [];
    const connector = createNotionConnector(bridge, 'p1', onConnected, (w) => waitingChanges.push(w));

    connector.connect(); // notionConnect() is now pending.
    connector.destroy(); // the component unmounts before it resolves.
    resolveConnect({ ok: true, authorizeUrl: 'https://api.notion.com/v1/oauth/authorize?x' });
    // Flush the microtask the `.then()` runs on.
    await Promise.resolve();
    await Promise.resolve();

    expect(waitingChanges).toEqual([]); // no setWaiting(true): window.open/poll were never reached.
    expect(connector.waiting).toBe(false);
    expect(captureStatusCalls).toBe(0); // no poll was ever started, so captureStatus was never called.
  });
});

describe('createOverleafSyncer (I4: one sync at a time)', () => {
  it('a second sync while one is in flight is a no-op; syncing is true until it settles, then the panel refreshes', async () => {
    let calls = 0;
    let resolve!: (v: { ok: false; code: string }) => void;
    const bridge = fakeBridge({
      overleafSync: () =>
        new Promise((res) => {
          calls++;
          resolve = res as typeof resolve;
        }),
    });
    const changes: boolean[] = [];
    let refreshed = 0;
    const syncer = createOverleafSyncer(bridge, 'a1', () => void refreshed++, (v) => changes.push(v));
    const p1 = syncer.sync();
    const p2 = syncer.sync();
    expect(syncer.syncing).toBe(true);
    resolve({ ok: false, code: 'git_failed' });
    await Promise.all([p1, p2]);
    expect(calls).toBe(1);
    expect(syncer.syncing).toBe(false);
    expect(changes).toEqual([true, false]);
    expect(refreshed).toBe(1);
  });
});

describe('commitsFetchKey (I3: the commit list refetches after a sync or a capture)', () => {
  it('changes when syncedAt or lastRunAt changes for the same repo, and is null with no repo', () => {
    const repo = { id: 'r1', name: 'paper', head: 'abc', branch: 'main' };
    const base = { artifactId: 'a1', kind: 'overleaf' as const, ready: true, code: null, repo, syncedAt: '2026-11-24T09:00:00Z', lastRunAt: null };
    const before = commitsFetchKey(base);
    const afterSync = commitsFetchKey({ ...base, syncedAt: '2026-11-24T10:00:00Z' });
    const afterRun = commitsFetchKey({ ...base, lastRunAt: '2026-11-24T10:05:00Z' });
    expect(before).not.toBeNull();
    expect(afterSync).not.toBe(before);
    expect(afterRun).not.toBe(before);
    expect(commitsFetchKey({ ...base })).toBe(before);
    expect(commitsFetchKey({ ...base, repo: null })).toBeNull();
    expect(commitsFetchKey(undefined)).toBeNull();
  });
});

describe('createNotionReader and NotionPage (I5)', () => {
  it('a failed read shows the reason and refreshes the panel, so notion_not_connected brings back Connect', async () => {
    const states: NotionRead[] = [];
    let failed = 0;
    const bridge = fakeBridge({ notionPage: async () => ({ ok: false, code: 'notion_not_connected' }) });
    const reader = createNotionReader(bridge, 'a1', (s) => states.push(s), () => void failed++);
    await reader.read();
    expect(states).toEqual([{ phase: 'reading' }, { phase: 'error', code: 'notion_not_connected' }]);
    expect(failed).toBe(1);

    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const api = fakeApi({ live: emptyState(), me: 'u-alex', locale, today: TODAY });
      const html = render(api, <NotionPage read={states[1]!} onRead={noop} />);
      guards(`notion error ${locale}`, html);
      expect(html).toContain('data-testid="af-notion-error"');
      expect(html).toContain(tr.t('cap.err.notion_not_connected'));
      expect(html).not.toContain('data-testid="af-notion-page"');
    }
  });

  it('a read in flight shows the reading state with the button disabled, and ignores a second click', async () => {
    let calls = 0;
    let resolve!: (v: { ok: true; paragraphs: string[]; fetchedAt: string }) => void;
    const bridge = fakeBridge({
      notionPage: () =>
        new Promise((res) => {
          calls++;
          resolve = res as typeof resolve;
        }),
    });
    const states: NotionRead[] = [];
    const reader = createNotionReader(bridge, 'a1', (s) => states.push(s), noop);
    const p1 = reader.read();
    const p2 = reader.read();
    resolve({ ok: true, paragraphs: ['One'], fetchedAt: '2026-11-24T09:00:00Z' });
    await Promise.all([p1, p2]);
    expect(calls).toBe(1);
    expect(states.at(-1)).toEqual({ phase: 'ready', paragraphs: ['One'] });

    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const api = fakeApi({ live: emptyState(), me: 'u-alex', locale, today: TODAY });
      const html = render(api, <NotionPage read={{ phase: 'reading' }} onRead={noop} />);
      guards(`notion reading ${locale}`, html);
      expect(html).toMatch(/data-testid="af-notion-read"[^>]*disabled/);
      expect(html).toContain(tr.t('af.notionReading'));
    }
  });

  it('a read page renders its paragraphs through noDots', () => {
    const dotted = 'Latency · done • recall next';
    for (const locale of LOCALES) {
      const api = fakeApi({ live: emptyState(), me: 'u-alex', locale, today: TODAY });
      const html = render(api, <NotionPage read={{ phase: 'ready', paragraphs: ['First paragraph', dotted] }} onRead={noop} />);
      guards(`notion paragraphs ${locale}`, html);
      expect(html).toContain('data-testid="af-notion-page"');
      expect(html).toContain('First paragraph');
      expect(html).toContain(noDots(dotted));
      expect(DOT_RE.test(html)).toBe(false);
    }
  });

  it('a read that resolves after destroy() updates nothing', async () => {
    let resolve!: (v: { ok: false; code: string }) => void;
    const bridge = fakeBridge({ notionPage: () => new Promise((res) => void (resolve = res as typeof resolve)) });
    const states: NotionRead[] = [];
    let failed = 0;
    const reader = createNotionReader(bridge, 'a1', (s) => states.push(s), () => void failed++);
    const p = reader.read();
    reader.destroy();
    resolve({ ok: false, code: 'notion_failed' });
    await p;
    expect(states).toEqual([{ phase: 'reading' }]);
    expect(failed).toBe(0);
  });
});

describe('SourceView', () => {
  it('while an Overleaf sync runs, Sync is disabled and says so (I4)', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const api = fakeApi({ live: emptyState(), me: 'u-alex', locale, today: TODAY });
      const { artifact } = fixture('overleaf', 'https://git.overleaf.com/abc123');
      const html = render(api, <SourceView artifact={artifact} data={panelData(row({ kind: 'overleaf' }), { overleafToken: true, syncing: true })} />);
      guards(`source overleaf syncing ${locale}`, html);
      expect(html).toMatch(/data-testid="af-ol-sync"[^>]*disabled/);
      expect(html).toContain(tr.t('af.olSyncing'));
      const idle = render(api, <SourceView artifact={artifact} data={panelData(row({ kind: 'overleaf' }), { overleafToken: true })} />);
      expect(idle).not.toMatch(/data-testid="af-ol-sync"[^>]*disabled/);
      expect(idle).toContain(tr.t('af.olSync'));
    }
  });

  it('a repo source shows the repo name or af.noRepo, and the pick/unbind actions', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const api = fakeApi({ live: emptyState(), me: 'u-alex', locale, today: TODAY });
      const { artifact } = fixture('code');

      const unbound = render(api, <SourceView artifact={artifact} data={panelData(row({ kind: 'repo' }))} />);
      guards(`source repo unbound ${locale}`, unbound);
      expect(unbound).toContain('data-testid="af-source" data-kind="repo" data-ready="false"');
      expect(unbound).toContain(tr.t('af.noRepo'));
      expect(unbound).toContain('data-testid="af-pick-repo"');
      expect(unbound).not.toContain('data-testid="af-unbind"');

      const bound = render(
        api,
        <SourceView
          artifact={artifact}
          data={panelData(row({ kind: 'repo', ready: true, repoName: 'meetless' }), { commits: [{ commit: 'abc1234567', parents: [], author: 'Alex', date: '2026-11-20', subject: 'Fix thing' }] })}
        />,
      );
      guards(`source repo bound ${locale}`, bound);
      expect(bound).toContain('data-testid="af-unbind"');
      expect(bound).not.toContain('data-testid="af-pick-repo"');
      expect(bound).toContain('meetless');
      expect(bound).toContain('data-testid="af-commit" data-sha="abc1234567"');
      expect(bound).toContain('Fix thing');
    }
  });

  it('the Overleaf token field is a plain text input; the saved state never shows the token', () => {
    for (const locale of LOCALES) {
      const api = fakeApi({ live: emptyState(), me: 'u-alex', locale, today: TODAY });
      const { artifact } = fixture('overleaf', 'https://git.overleaf.com/abc123');

      const noToken = render(api, <SourceView artifact={artifact} data={panelData(row({ kind: 'overleaf' }))} />);
      guards(`source overleaf no-token ${locale}`, noToken);
      expect(noToken).toMatch(/data-testid="af-ol-token"[^>]*type="text"/);
      expect(noToken).not.toContain('type="password"');
      expect(noToken).toContain('data-testid="af-ol-save"');
      expect(noToken).toContain('data-testid="af-ol-sync"');
      expect(noToken).not.toContain('data-testid="af-ol-clear"');

      const saved = render(api, <SourceView artifact={artifact} data={panelData(row({ kind: 'overleaf' }), { overleafToken: true })} />);
      guards(`source overleaf saved ${locale}`, saved);
      expect(saved).not.toContain('data-testid="af-ol-token"');
      expect(saved).not.toContain('type="password"');
      expect(saved).toContain('data-testid="af-ol-clear"');
    }
  });

  it('Notion not connected shows the authorise prompt and no page content; connected shows the read action', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const api = fakeApi({ live: emptyState(), me: 'u-alex', locale, today: TODAY });
      const { artifact } = fixture('notion', 'https://notion.so/page');

      const notConnected = render(api, <SourceView artifact={artifact} data={panelData(row({ kind: 'notion' }))} />);
      guards(`source notion disconnected ${locale}`, notConnected);
      expect(notConnected).toContain(tr.t('af.notionNeedAuth'));
      expect(notConnected).toContain('data-testid="af-notion-connect"');
      expect(notConnected).not.toContain('data-testid="af-notion-page"');
      expect(notConnected).not.toContain('data-testid="af-notion-disconnect"');

      const connected = render(api, <SourceView artifact={artifact} data={panelData(row({ kind: 'notion', ready: true }), { notionConnected: true })} />);
      guards(`source notion connected ${locale}`, connected);
      expect(connected).toContain('data-testid="af-notion-disconnect"');
      expect(connected).toContain('data-testid="af-notion-read"');
      expect(connected).not.toContain('data-testid="af-notion-page"');
    }
  });

  it('Notion waiting-for-authorisation shows af.notionWaiting (R15: guards in both locales)', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const api = fakeApi({ live: emptyState(), me: 'u-alex', locale, today: TODAY });
      const { artifact } = fixture('notion', 'https://notion.so/page');
      const html = render(api, <SourceView artifact={artifact} data={panelData(row({ kind: 'notion' }), { notionWaiting: true })} />);
      guards(`source notion waiting ${locale}`, html);
      expect(html).toContain(tr.t('af.notionWaiting'));
      expect(html).toContain('data-testid="af-notion-connect"');
    }
  });

  it('an upload source shows af.uploadSource', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const api = fakeApi({ live: emptyState(), me: 'u-alex', locale, today: TODAY });
      const { artifact } = fixture('pdf');
      const html = render(api, <SourceView artifact={artifact} data={panelData(row({ kind: 'upload' }))} />);
      guards(`source upload ${locale}`, html);
      expect(html).toContain(tr.t('af.uploadSource'));
    }
  });

  it('a skipped source shows its reason as warning text, and every kind shows the capture button and tip', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const api = fakeApi({ live: emptyState(), me: 'u-alex', locale, today: TODAY });
      const { artifact } = fixture('code');
      const html = render(api, <SourceView artifact={artifact} data={panelData(row({ kind: 'repo', code: 'no_repo' }))} />);
      guards(`source skipped ${locale}`, html);
      expect(html).toContain('class="small tone-warning"');
      expect(html).toContain(tr.t('cap.err.no_repo'));
      // `cap.tip`'s English copy has an apostrophe; React's server renderer escapes it to an
      // entity in the HTML text, so compare against the escaped form, not the raw copy string.
      expect(html).toContain(tr.t('cap.tip').replace(/'/g, '&#x27;'));
      expect(html).toContain('data-testid="cap-run"');
      expect(html).toContain(tr.t('cap.btn'));
    }
  });

  it('shows the last run time when known', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const api = fakeApi({ live: emptyState(), me: 'u-alex', locale, today: TODAY });
      const { artifact } = fixture('code');
      const html = render(api, <SourceView artifact={artifact} data={panelData(row({ kind: 'repo', ready: true, repoName: 'r', lastRunAt: '2026-11-20T09:00:00Z' }))} />);
      guards(`source lastRun ${locale}`, html);
      expect(html).toContain(tr.t('cap.lastRun', { t: api.fmtDateTime('2026-11-20T09:00:00Z') }));
    }
  });
});
