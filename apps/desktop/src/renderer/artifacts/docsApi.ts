import { OFFICE_LOAD_TIMEOUT_MS, type OfficeEvent } from './office';

/**
 * The slice of the OnlyOffice `api.js` global that `OnlyOfficeFrame` uses (view mode only; task 6
 * brief). Real editor instances expose far more; this is deliberately the minimum we call.
 */
export interface DocEditorInstance {
  destroyEditor(): void;
}

export interface DocsApi {
  DocEditor: new (id: string, config: Record<string, unknown>) => DocEditorInstance;
}

declare global {
  interface Window {
    DocsAPI?: DocsApi;
  }
}

/**
 * The minimum a `<script>` element needs to support (task 6 fix round 1): settable `src`/`async`,
 * `load`/`error` listeners, and `remove()` so a failed load can be cleaned out of the document. A
 * real `HTMLScriptElement` already satisfies this; tests inject a fake one instead of needing jsdom.
 */
export interface ScriptEl {
  src: string;
  async: boolean;
  addEventListener(type: 'load' | 'error', listener: () => void): void;
  remove(): void;
}

/** The document access `loadDocsApi` needs: create a script element, and mount it. */
export interface DocLike {
  createScript(): ScriptEl;
  appendScript(script: ScriptEl): void;
}

/** The window access `loadDocsApi` needs: read the global the loaded script defines. */
export interface WinLike {
  getDocsApi(): DocsApi | undefined;
}

function browserEnv(): { doc: DocLike; win: WinLike } {
  return {
    doc: {
      createScript: () => document.createElement('script'),
      appendScript: (script) => document.head.appendChild(script as unknown as Node),
    },
    win: { getDocsApi: () => window.DocsAPI },
  };
}

const cache = new Map<string, Promise<DocsApi>>();

/**
 * Adds one `<script src="<documentServerUrl>/web-apps/apps/api/documents/api.js">` per
 * `documentServerUrl` (the promise is cached, so a second call for the same server while it is
 * still loading, or once it has loaded, reuses it instead of appending another script), resolving
 * `window.DocsAPI`. Rejects on a script load error, a missing `DocsAPI` global after `load`, or
 * after `timeoutMs`.
 *
 * Task 6 fix round 1: on every rejection path the cache entry is deleted and the failed script is
 * removed from the document, so a later call for the same url retries instead of replaying the
 * same rejected promise for the rest of the session (the bug: a one-off network blip or a slow
 * first load used to permanently disable the OnlyOffice path). The load timer is cleared on every
 * settle path (success, script error, missing-global, and the timeout itself).
 */
export function loadDocsApi(documentServerUrl: string, timeoutMs: number = OFFICE_LOAD_TIMEOUT_MS, env: { doc: DocLike; win: WinLike } = browserEnv()): Promise<DocsApi> {
  const cached = cache.get(documentServerUrl);
  if (cached) return cached;
  const promise = new Promise<DocsApi>((resolve, reject) => {
    const script = env.doc.createScript();
    script.src = `${documentServerUrl}/web-apps/apps/api/documents/api.js`;
    script.async = true;
    const fail = (err: Error) => {
      clearTimeout(timer);
      cache.delete(documentServerUrl);
      script.remove();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error('timeout')), timeoutMs);
    script.addEventListener('load', () => {
      clearTimeout(timer);
      const api = env.win.getDocsApi();
      if (api) resolve(api);
      else fail(new Error('script_failed'));
    });
    script.addEventListener('error', () => fail(new Error('script_failed')));
    env.doc.appendScript(script);
  });
  cache.set(documentServerUrl, promise);
  return promise;
}

/**
 * Creates the editor and watches it (I7): once `DocsAPI.DocEditor` exists, it must call
 * `onAppReady` within `timeoutMs`, else `onEvent({ type: 'timeout' })` fires and the viewer falls
 * back (a DocumentServer still warming up, a hung docservice, a frame that never boots).
 * `app_ready` and `editor_error` clear the timer and pass through; an error after `ready` still
 * reaches `onEvent`. `dispose` clears the timer and destroys the editor. No DOM is touched here,
 * so tests drive it with a fake `DocsApi` and fake timers.
 */
export function mountEditor(
  DocsAPI: DocsApi,
  editorId: string,
  config: Record<string, unknown>,
  onEvent: (e: OfficeEvent) => void,
  timeoutMs: number = OFFICE_LOAD_TIMEOUT_MS,
): { dispose(): void } {
  let called = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const settle = (e: OfficeEvent) => {
    called = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    onEvent(e);
  };
  const editor = new DocsAPI.DocEditor(editorId, {
    ...config,
    events: {
      onAppReady: () => settle({ type: 'app_ready' }),
      onError: () => settle({ type: 'editor_error' }),
    },
  });
  if (!called) {
    timer = setTimeout(() => {
      timer = null;
      if (!called) onEvent({ type: 'timeout' });
    }, timeoutMs);
  }
  return {
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      called = true;
      editor.destroyEditor();
    },
  };
}
