import type { ApiResponse } from '@meetless/api';
import type { Result } from '@meetless/client/bridge';

/**
 * The OnlyOffice view-mode state machine (task 6 brief, contract §3/§8.5, ruling R3). `ArtifactViewer`
 * drives it from `api('office.config', ...)` and from the embedded editor's own callbacks
 * (`OnlyOfficeFrame`); the pure reducer here is what the component tests exercise directly.
 */

/** Why the office path fell back, mirroring `OfficeConfigRes['reason']` plus a failed call. */
export type OfficeReason = 'not_configured' | 'unsupported_kind' | 'no_file' | 'unavailable';

export type OfficeState =
  | { phase: 'config' }
  | { phase: 'loading'; documentServerUrl: string; config: Record<string, unknown> }
  | { phase: 'ready'; documentServerUrl: string; config: Record<string, unknown> }
  | { phase: 'fallback'; reason: OfficeReason };

export type OfficeEvent =
  | { type: 'config'; result: Result<{ data: ApiResponse<'office.config'> }> }
  | { type: 'script_failed' }
  | { type: 'timeout' }
  | { type: 'app_ready' }
  | { type: 'editor_error' };

/** How long `OnlyOfficeFrame` waits for `api.js` to load, and then again for the editor's `onAppReady` (`mountEditor`), before falling back. */
export const OFFICE_LOAD_TIMEOUT_MS = 20_000;

/**
 * `config`: a failed call (any `!ok` code, e.g. `NETWORK` or `TIMEOUT`) falls back with
 * `'unavailable'`; an `available: false` result keeps the server's own reason; `available: true`
 * moves to `loading` with the document server url and config. `script_failed`, `timeout` and
 * `editor_error` fall back with `'unavailable'` from `loading` or `ready` (and are ignored from
 * `config` or `fallback`, since there is no editor to have failed yet). `app_ready` moves `loading`
 * to `ready` (and is ignored elsewhere).
 */
export function officeStep(s: OfficeState, e: OfficeEvent): OfficeState {
  switch (e.type) {
    case 'config': {
      const r = e.result;
      if (!r.ok) return { phase: 'fallback', reason: 'unavailable' };
      const data = r.data;
      if (!data.available) return { phase: 'fallback', reason: data.reason };
      return { phase: 'loading', documentServerUrl: data.documentServerUrl, config: data.config };
    }
    case 'app_ready':
      return s.phase === 'loading' ? { phase: 'ready', documentServerUrl: s.documentServerUrl, config: s.config } : s;
    case 'script_failed':
    case 'timeout':
    case 'editor_error':
      return s.phase === 'loading' || s.phase === 'ready' ? { phase: 'fallback', reason: 'unavailable' } : s;
    default:
      return s;
  }
}
