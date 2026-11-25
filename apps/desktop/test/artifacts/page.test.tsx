import { describe, expect, it } from 'vitest';
import { DOT_RE, noDots, viewFor, type State } from '@meetless/core';
import { createTranslator, SUPPORTED_LOCALES, type Locale } from '@meetless/i18n';
import type { Route } from '../../src/renderer/app/routes';
import { ArtifactsPage } from '../../src/renderer/artifacts/ArtifactsPage';
import { LinkNeedsModal } from '../../src/renderer/artifacts/LinkNeedsModal';
import { NewArtifactModal } from '../../src/renderer/artifacts/NewArtifactModal';
import { NewVersionModal } from '../../src/renderer/artifacts/NewVersionModal';
import { addVersion, copyAgentPrompt, createArtifact } from '../../src/renderer/artifacts/actions';
import { keepLinkable, linkableNeeds } from '../../src/renderer/artifacts/model';
import type { SubmitResult } from '@meetless/client/bridge';
import type { EventType } from '@meetless/core';
import { fakeApi, render, sample } from '../support/app';
import { clientState } from '../support/client-state';
import { guards } from '../support/guards';
import { Log } from '../support/log';

const LOCALES: Locale[] = [...SUPPORTED_LOCALES];
const PAPER = 'sample-paper';
const TODAY = '2026-11-24';
const composer = () => null;

/** Both of the two state sources a renderer client holds (contract 12.14/12.22, ruling R15). */
function liveSources(locale: Locale): State[] {
  const log = sample(locale);
  return [clientState(log, 'u-alex'), viewFor(log.state, 'u-alex')];
}

describe('ArtifactsPage (sample, me u-alex)', () => {
  it('renders the list, the header, changes, linked needs and versions, in both locales', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      for (const live of liveSources(locale)) {
        const a1 = `${PAPER}:A1`;
        const route: Route = { view: 'artifacts', projectId: PAPER, focusId: a1 };
        const html = render(fakeApi({ live, me: 'u-alex', locale, route, today: TODAY }), <ArtifactsPage composer={composer} />);
        guards(`artifacts ${locale}`, html);

        expect(html).toContain('data-testid="page-artifacts"');
        expect(html).toContain('data-testid="af-new"');
        // The list: at least the focused artifact's row, with its id and no dot before the title.
        expect(html).toContain(`data-testid="af-item" data-artifact="${a1}"`);
        // Header: "copy for agent" (it is a shared artifact); no "open in source" (the sample sets no url).
        expect(html).toContain('data-testid="af-copy"');
        expect(html).not.toContain('data-testid="af-open"');
        expect(html).not.toContain('data-testid="af-share"');
        // Changes: the newest version's note (v2).
        expect(html).toContain(tr.t('af.changes'));
        expect(html).toContain(noDots(live.artifacts[a1]!.versions[0]!.note));
        // Linked needs: N4, N6, N7, as NeedChip (code and title only, no mark before the code).
        expect(html).toContain(tr.t('af.needs'));
        for (const code of ['N4', 'N6', 'N7']) expect(html).toContain(code);
        expect(html).toContain('data-testid="af-link"');
        // Versions: both versions, newest selected.
        expect(html).toContain(tr.t('af.versions'));
        expect(html).toContain('data-testid="af-add-version"');
        const versionIds = [...html.matchAll(/data-testid="af-version" data-version="([^"]+)"/g)].map((m) => m[1]);
        expect(versionIds.sort()).toEqual([`${a1}:v1`, `${a1}:v2`].sort());
        expect(html).toMatch(new RegExp(`<button[^>]*class="ver on"[^>]*data-version="${a1}:v2"`));
      }
    }
  });

  it('selects route.versionId when it belongs to the focused artifact', () => {
    const live = clientState(sample('en'), 'u-alex');
    const a1 = `${PAPER}:A1`;
    const route: Route = { view: 'artifacts', projectId: PAPER, focusId: a1, versionId: `${a1}:v1` };
    const html = render(fakeApi({ live, me: 'u-alex', route, today: TODAY }), <ArtifactsPage composer={composer} />);
    guards('artifacts versionId', html);
    expect(html).toMatch(new RegExp(`<button[^>]*class="ver on"[^>]*data-version="${a1}:v1"`));
    expect(html).toContain(noDots(live.artifacts[a1]!.versions[1]!.note)); // v1's note (versions[1], the older one)
    expect(html).not.toContain(noDots(live.artifacts[a1]!.versions[0]!.note));
  });

  it('falls back to the newest version when route.versionId does not belong to the focused artifact', () => {
    const live = clientState(sample('en'), 'u-alex');
    const a1 = `${PAPER}:A1`;
    const a2 = `${PAPER}:A2`;
    const route: Route = { view: 'artifacts', projectId: PAPER, focusId: a1, versionId: `${a2}:v1` };
    const html = render(fakeApi({ live, me: 'u-alex', route, today: TODAY }), <ArtifactsPage composer={composer} />);
    guards('artifacts versionId mismatch', html);
    expect(html).toMatch(new RegExp(`<button[^>]*class="ver on"[^>]*data-version="${a1}:v2"`));
  });

  it('selects route.focusId through selectedArtifact, else the first of the list', () => {
    const live = clientState(sample('en'), 'u-alex');
    const noFocus = render(fakeApi({ live, me: 'u-alex', route: { view: 'artifacts', projectId: PAPER }, today: TODAY }), <ArtifactsPage composer={composer} />);
    guards('artifacts no focus', noFocus);
    const a2 = `${PAPER}:A2`;
    const focused = render(
      fakeApi({ live, me: 'u-alex', route: { view: 'artifacts', projectId: PAPER, focusId: a2 }, today: TODAY }),
      <ArtifactsPage composer={composer} />,
    );
    guards('artifacts focus a2', focused);
    expect(focused).toMatch(new RegExp(`<button[^>]*class="li on"[^>]*data-artifact="${a2}"`));
  });

  it('no rendered text contains a DOT_RE character in either locale', () => {
    for (const locale of LOCALES) {
      for (const live of liveSources(locale)) {
        const a1 = `${PAPER}:A1`;
        const html = render(
          fakeApi({ live, me: 'u-alex', locale, route: { view: 'artifacts', projectId: PAPER, focusId: a1 }, today: TODAY }),
          <ArtifactsPage composer={composer} />,
        );
        guards(`artifacts dots ${locale}`, html);
        expect(DOT_RE.test(html), locale).toBe(false);
      }
    }
  });

  it('an empty project shows af.empty and the add button; open-in-source only with a URL', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale: 'en' });
    log.emit('project.created', 'u-alex', { projectId: 'p-empty', name: 'Empty' });
    const tr = createTranslator('en');

    const emptyHtml = render(
      fakeApi({ live: log.state, me: 'u-alex', route: { view: 'artifacts', projectId: 'p-empty' }, today: TODAY }),
      <ArtifactsPage composer={composer} />,
    );
    guards('artifacts empty', emptyHtml);
    expect(emptyHtml).toContain(tr.t('af.empty'));
    expect(emptyHtml).toContain('data-testid="af-new"');
    expect(emptyHtml).not.toContain('data-testid="af-open"');

    log.emit('artifact.created', 'u-alex', { artifactId: 'no-url', projectId: 'p-empty', kind: 'pdf', title: 'No URL', where: 'PDF', needIds: [] });
    const noUrlHtml = render(
      fakeApi({ live: log.state, me: 'u-alex', route: { view: 'artifacts', projectId: 'p-empty', focusId: 'no-url' }, today: TODAY }),
      <ArtifactsPage composer={composer} />,
    );
    guards('artifacts no url', noUrlHtml);
    expect(noUrlHtml).not.toContain('data-testid="af-open"');

    log.emit('artifact.created', 'u-alex', {
      artifactId: 'with-url',
      projectId: 'p-empty',
      kind: 'pdf',
      title: 'With URL',
      where: 'PDF',
      url: 'https://files.example.com/a.pdf',
      needIds: [],
    });
    const withUrlHtml = render(
      fakeApi({ live: log.state, me: 'u-alex', route: { view: 'artifacts', projectId: 'p-empty', focusId: 'with-url' }, today: TODAY }),
      <ArtifactsPage composer={composer} />,
    );
    guards('artifacts with url', withUrlHtml);
    expect(withUrlHtml).toContain('data-testid="af-open"');
  });

  it('my private artifact shows pv.mine and the share action; Zhou’s render has neither it nor its title', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const log = new Log();
      log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale });
      log.emit('user.registered', 'system', { userId: 'u-zhou', displayName: 'Zhou', locale });
      log.emit('project.created', 'u-alex', { projectId: 'p-priv', name: 'Priv' });
      log.emit('project.member_added', 'u-alex', { projectId: 'p-priv', userId: 'u-zhou' });
      log.emit('artifact.created', 'u-alex', {
        artifactId: 'secret',
        projectId: 'p-priv',
        kind: 'docx',
        title: 'Secret roadmap',
        where: 'Word',
        needIds: [],
        private: true,
      });

      const alexLive = clientState(log, 'u-alex');
      const alexHtml = render(
        fakeApi({ live: alexLive, me: 'u-alex', locale, route: { view: 'artifacts', projectId: 'p-priv', focusId: 'secret' }, today: TODAY }),
        <ArtifactsPage composer={composer} />,
      );
      guards(`artifacts private alex ${locale}`, alexHtml);
      expect(alexHtml).toContain('Secret roadmap');
      expect(alexHtml).toContain(tr.t('pv.mine'));
      expect(alexHtml).toContain('data-testid="af-share"');
      expect(alexHtml).not.toContain('data-testid="af-copy"');

      const zhouLive = clientState(log, 'u-zhou');
      expect(zhouLive.artifacts['secret']).toBeUndefined();
      const zhouHtml = render(
        fakeApi({ live: zhouLive, me: 'u-zhou', locale, route: { view: 'artifacts', projectId: 'p-priv', focusId: 'secret' }, today: TODAY }),
        <ArtifactsPage composer={composer} />,
      );
      guards(`artifacts private zhou ${locale}`, zhouHtml);
      expect(zhouHtml).not.toContain('Secret roadmap');
      expect(zhouHtml).not.toContain('data-testid="af-item"');
      expect(zhouHtml).toContain(tr.t('af.empty'));
    }
  });
});

/**
 * Review fix round 1 (Important #1): nothing rendered this diff's three modals through `guards()`, so
 * the void `<input type="checkbox"/>` the review found right before each need's code in
 * `NewArtifactModal` and `LinkNeedsModal` shipped undetected. Each modal now gets its own
 * `guards()`-covered render, in both locales.
 */
describe('artifact modals (sample, me u-alex): guards() on every render', () => {
  it('NewArtifactModal renders cleanly in both locales', () => {
    for (const locale of LOCALES) {
      const live = clientState(sample(locale), 'u-alex');
      const html = render(
        fakeApi({ live, me: 'u-alex', locale, route: { view: 'artifacts', projectId: PAPER }, today: TODAY }),
        <NewArtifactModal projectId={PAPER} onClose={() => undefined} onCreated={() => undefined} />,
      );
      guards(`NewArtifactModal ${locale}`, html);
      expect(html).toContain('data-testid="afn-modal"');
      expect(html).toContain('data-testid="afn-need"');
    }
  });

  it('NewVersionModal renders cleanly in both locales, for a file-kind and a url-kind artifact', () => {
    for (const locale of LOCALES) {
      const live = clientState(sample(locale), 'u-alex');
      for (const artifactId of [`${PAPER}:A1`, `${PAPER}:A2`]) {
        const artifact = live.artifacts[artifactId]!;
        const html = render(
          fakeApi({ live, me: 'u-alex', locale, route: { view: 'artifacts', projectId: PAPER }, today: TODAY }),
          <NewVersionModal artifact={artifact} onClose={() => undefined} />,
        );
        guards(`NewVersionModal ${locale} ${artifactId}`, html);
        expect(html).toContain('data-testid="afv-modal"');
      }
    }
  });

  it('LinkNeedsModal renders cleanly in both locales, with no duplicated caption or header text', () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const live = clientState(sample(locale), 'u-alex');
      const artifact = live.artifacts[`${PAPER}:A1`]!;
      const html = render(
        fakeApi({ live, me: 'u-alex', locale, route: { view: 'artifacts', projectId: PAPER }, today: TODAY }),
        <LinkNeedsModal artifact={artifact} onClose={() => undefined} />,
      );
      guards(`LinkNeedsModal ${locale}`, html);
      expect(html).toContain('data-testid="afl-modal"');
      expect(html).toContain('data-testid="afl-need"');
      // Review fix round 2: the header (af.link) and the checklist caption (af.linkPick) must read as
      // two distinct lines, in both locales — not the same string twice (zh-CN: 「关联需求」 vs 「选择要关联的需求」).
      const header = tr.t('af.link');
      const caption = tr.t('af.linkPick');
      expect(caption).not.toBe(header);
      expect(html.split(header).length - 1).toBe(1);
      expect(html).toContain(caption);
    }
  });
});

/*
 * Task 7 fix round 1 (review finding 1): before the fix, `ArtifactSide` (unconditionally) and
 * `ArtifactViewer`'s `SourceArtifactViewer` (for code/Notion/Overleaf-without-file) both rendered
 * the full `SourceView`, so the page carried two independently-guarded `cap-run` buttons for the
 * same artifact. Each artifact kind below selects a different branch of that bug: `code` and
 * `notion` used to duplicate the centre pane's panel into the side pane; an upload kind (`pdf`)
 * was never duplicated (the centre shows OnlyOffice or `af.noVersions`, never `SourceView`), so it
 * is included here as the control case that must still show its one `cap-run` in the side pane.
 */
describe('ArtifactsPage: exactly one capture button per selected artifact (fix round 1)', () => {
  it('a code, a Notion, and an upload-kind (pdf) artifact each show data-testid="cap-run" exactly once', () => {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale: 'en' });
    log.emit('project.created', 'u-alex', { projectId: 'p1', name: 'P1' });
    log.emit('artifact.created', 'u-alex', { artifactId: 'a-code', projectId: 'p1', kind: 'code', title: 'Repo', where: 'GitHub', needIds: [] });
    log.emit('artifact.created', 'u-alex', { artifactId: 'a-notion', projectId: 'p1', kind: 'notion', title: 'Doc', where: 'Notion', url: 'https://notion.so/page', needIds: [] });
    log.emit('artifact.created', 'u-alex', { artifactId: 'a-pdf', projectId: 'p1', kind: 'pdf', title: 'Report', where: 'PDF', needIds: [] });

    for (const artifactId of ['a-code', 'a-notion', 'a-pdf']) {
      const route: Route = { view: 'artifacts', projectId: 'p1', focusId: artifactId };
      const html = render(fakeApi({ live: log.state, me: 'u-alex', route, today: TODAY }), <ArtifactsPage composer={composer} />);
      const capRunCount = (html.match(/data-testid="cap-run"/g) ?? []).length;
      expect(capRunCount, `${artifactId}: expected exactly one "cap-run"`).toBe(1);
      // And no af-source root appears twice either (the same duplication would show up here too).
      const sourceCount = (html.match(/data-testid="af-source"/g) ?? []).length;
      expect(sourceCount, `${artifactId}: expected exactly one "af-source"`).toBe(1);
    }
  });
});

/*
 * Final review I6 and M5: the add-artifact modal offers only the needs the chosen privacy can
 * link (core's linkNeeds refuses a shared artifact linking a private need), drops ticked private
 * needs when "Only me" is unticked, and stops on a refused artifact.created; the new-version modal
 * checks its result the same way. M6: "copied" only after the clipboard write succeeded.
 */
describe('add artifact and new version: privacy and refusals (I6, M5, M6)', () => {
  function privLog(locale: Locale = 'en'): Log {
    const log = new Log();
    log.emit('user.registered', 'system', { userId: 'u-alex', displayName: 'Alex', locale });
    log.emit('project.created', 'u-alex', { projectId: 'p1', name: 'P1' });
    const source = { src: 'doc' as const, date: TODAY, quote: 'q', ref: 'r' };
    log.emit('need.created', 'u-alex', { needId: 'n-shared', projectId: 'p1', kind: 'ext', title: 'Shared need', roundId: null, source });
    log.emit('need.created', 'u-alex', { needId: 'n-mine', projectId: 'p1', kind: 'ext', title: 'My private need', roundId: null, source, private: true });
    return log;
  }

  it('linkableNeeds lists a private need only for a private artifact; keepLinkable drops it when shared', () => {
    const s = privLog().state;
    expect(linkableNeeds(s, 'p1', false).map((n) => n.id)).toEqual(['n-shared']);
    expect(linkableNeeds(s, 'p1', true).map((n) => n.id).sort()).toEqual(['n-mine', 'n-shared']);
    expect(keepLinkable(s, ['n-shared', 'n-mine'], false)).toEqual(['n-shared']);
    expect(keepLinkable(s, ['n-shared', 'n-mine'], true)).toEqual(['n-shared', 'n-mine']);
  });

  it('NewArtifactModal (shared by default) never offers my private need, in both locales', () => {
    for (const locale of LOCALES) {
      const live = privLog(locale).state;
      const html = render(fakeApi({ live, me: 'u-alex', locale, today: TODAY }), <NewArtifactModal projectId="p1" onClose={() => undefined} onCreated={() => undefined} />);
      guards(`NewArtifactModal private needs ${locale}`, html);
      expect(html).toContain('data-need="n-shared"');
      expect(html).not.toContain('data-need="n-mine"');
      expect(html).not.toContain('My private need');
    }
  });

  type Call = { type: EventType; payload: unknown };
  function deps(results: Partial<Record<EventType, SubmitResult>>) {
    const calls: Call[] = [];
    const uploads: number[] = [];
    const notices: string[] = [];
    return {
      calls,
      uploads,
      notices,
      deps: {
        submit: (async (type: EventType, payload: unknown) => {
          calls.push({ type, payload });
          return results[type] ?? ({ kind: 'accepted', seq: calls.length } as SubmitResult);
        }) as never,
        uploadBlob: async (bytes: Uint8Array) => {
          uploads.push(bytes.length);
          return { ok: true as const, hash: `sha256:${'c'.repeat(64)}`, size: bytes.length };
        },
        notify: (_tone: 'error' | 'info', text: string) => void notices.push(text),
        errorText: (code: string) => `error ${code}`,
      },
    };
  }
  const file = { arrayBuffer: async () => new ArrayBuffer(4) };
  const input = {
    artifactId: 'a-new',
    versionId: 'v-new',
    projectId: 'p1',
    kind: 'docx' as const,
    title: 'Spec',
    where: 'Word',
    url: null,
    needIds: ['n-shared'],
    isPrivate: false,
    file,
    today: TODAY,
    roundId: null,
  };

  it('createArtifact stops on a refused artifact.created: no upload, no version, and it reports false', async () => {
    const d = deps({ 'artifact.created': { kind: 'rejected', code: 'PRIVATE_ITEM' } });
    expect(await createArtifact(d.deps, input)).toBe(false);
    expect(d.calls.map((c) => c.type)).toEqual(['artifact.created']);
    expect(d.uploads).toEqual([]);
  });

  it('createArtifact creates, uploads, then adds the first version when accepted (or queued)', async () => {
    for (const kind of ['accepted', 'queued'] as const) {
      const d = deps({ 'artifact.created': kind === 'accepted' ? { kind, seq: 1 } : { kind } as SubmitResult });
      expect(await createArtifact(d.deps, input)).toBe(true);
      expect(d.calls.map((c) => c.type)).toEqual(['artifact.created', 'artifact.version_added']);
      expect(d.uploads).toEqual([4]);
    }
  });

  it('addVersion reports false on a refused artifact.version_added, so the modal stays open (M5)', async () => {
    const d = deps({ 'artifact.version_added': { kind: 'rejected', code: 'NOT_FOUND' } });
    const v = { artifactId: 'a-new', versionId: 'v2', kind: 'docx' as const, label: 'v2', note: '', url: null, file, today: TODAY, roundId: null };
    expect(await addVersion(d.deps, v)).toBe(false);
    const ok = deps({});
    expect(await addVersion(ok.deps, v)).toBe(true);
  });

  it('copyAgentPrompt says copied only after the write succeeds, and an error otherwise (M6)', async () => {
    for (const locale of LOCALES) {
      const tr = createTranslator(locale);
      const notices: { tone: string; text: string }[] = [];
      const notify = (tone: 'error' | 'info', text: string) => void notices.push({ tone, text });
      expect(await copyAgentPrompt(async () => undefined, 'prompt', notify, tr.t)).toBe(true);
      expect(notices).toEqual([{ tone: 'info', text: tr.t('cp.copied') }]);
      notices.length = 0;
      expect(await copyAgentPrompt(async () => Promise.reject(new Error('denied')), 'prompt', notify, tr.t)).toBe(false);
      expect(notices).toEqual([{ tone: 'error', text: tr.t('af.copyFailed') }]);
      notices.length = 0;
      expect(await copyAgentPrompt(undefined, 'prompt', notify, tr.t)).toBe(false);
      expect(notices).toEqual([{ tone: 'error', text: tr.t('af.copyFailed') }]);
    }
  });
});
