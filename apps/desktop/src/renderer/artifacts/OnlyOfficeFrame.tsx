import { useEffect, useId, useRef } from 'react';
import type { Locale } from '@meetless/i18n';
import { useApp } from '../app/AppContext';
import { loadDocsApi, mountEditor } from './docsApi';
import { OFFICE_LOAD_TIMEOUT_MS, type OfficeEvent, type OfficeState } from './office';

/**
 * The embedded OnlyOffice DocumentServer editor host, read-only (task 6 brief; design §8.5). Takes
 * `state` directly, so it renders (and is tested) the same way whatever phase it is in; it only
 * loads `api.js` and creates the editor while `state.phase` is `'loading'` (the dependency is the
 * document server url, which is the same string through the `loading` -> `ready` transition, so
 * that transition — driven by the editor's own `onAppReady` calling `onEvent` — does not tear the
 * editor down). `destroyEditor()` runs on unmount and (via the parent keying this subtree on the
 * version id) on a version change.
 *
 * `api.js` replaces the element it is given with its own iframe. So the editor never gets a node
 * React renders: the effect appends a plain placeholder `<div>` to the `oo-frame` host and hands
 * that over, and the cleanup empties the host again. React only ever owns `oo-frame` itself (and
 * the loading line next to it), so the iframe stays inside `oo-frame` and React never reconciles
 * a node the editor swapped out.
 */
export function OnlyOfficeFrame({ state, locale, onEvent }: { state: OfficeState; locale: Locale; onEvent: (e: OfficeEvent) => void }) {
  const { t } = useApp();
  const editorId = `oo-editor-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<{ dispose(): void } | null>(null);
  const url = state.phase === 'loading' || state.phase === 'ready' ? state.documentServerUrl : null;
  const config = state.phase === 'loading' || state.phase === 'ready' ? state.config : null;

  useEffect(() => {
    const host = hostRef.current;
    if (!url || !config || !host) return undefined;
    let cancelled = false;
    const editorConfig = (config.editorConfig ?? {}) as Record<string, unknown>;
    const placeholder = document.createElement('div');
    placeholder.id = editorId;
    host.appendChild(placeholder);
    loadDocsApi(url, OFFICE_LOAD_TIMEOUT_MS)
      .then((DocsAPI) => {
        if (cancelled) return;
        // `mountEditor` also starts the editor timeout (I7): no `onAppReady` within
        // OFFICE_LOAD_TIMEOUT_MS falls back, instead of `loading` forever.
        editorRef.current = mountEditor(
          DocsAPI,
          editorId,
          { ...config, width: '100%', height: '100%', type: 'desktop', editorConfig: { ...editorConfig, lang: locale } },
          onEvent,
          OFFICE_LOAD_TIMEOUT_MS,
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const timedOut = err instanceof Error && err.message === 'timeout';
        onEvent({ type: timedOut ? 'timeout' : 'script_failed' });
      });
    return () => {
      cancelled = true;
      editorRef.current?.dispose();
      editorRef.current = null;
      host.replaceChildren();
    };
    // `url` already changes if `documentServerUrl` ever does; `config`/`onEvent` are not deps on
    // purpose, so the loading -> ready transition (same url) never tears the editor down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, locale]);

  return (
    <>
      {state.phase === 'loading' && <div className="faint small pad">{t('af.loadingViewer')}</div>}
      <div data-testid="oo-frame" ref={hostRef} className="oo-host" />
    </>
  );
}
