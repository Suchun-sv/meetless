import { describe, expect, it } from 'vitest';
import { officeStep, type OfficeEvent, type OfficeState } from '../../src/renderer/artifacts/office';

const LOADING: OfficeState = { phase: 'loading', documentServerUrl: 'http://127.0.0.1:55435', config: { document: { fileType: 'docx' } } };
const READY: OfficeState = { phase: 'ready', documentServerUrl: 'http://127.0.0.1:55435', config: { document: { fileType: 'docx' } } };
const CONFIG: OfficeState = { phase: 'config' };

describe('officeStep', () => {
  it('an available config loads, app_ready makes it ready', () => {
    const configured = officeStep(CONFIG, {
      type: 'config',
      result: { ok: true, data: { available: true, documentServerUrl: 'http://127.0.0.1:55435', config: { document: { fileType: 'docx' } } } },
    });
    expect(configured).toEqual(LOADING);
    expect(officeStep(configured, { type: 'app_ready' })).toEqual(READY);
    // app_ready is ignored outside loading.
    expect(officeStep(CONFIG, { type: 'app_ready' })).toEqual(CONFIG);
    expect(officeStep(READY, { type: 'app_ready' })).toEqual(READY);
  });

  it('officeStep falls back on script failure, timeout and editor error, from loading or ready', () => {
    for (const type of ['script_failed', 'timeout', 'editor_error'] as const) {
      expect(officeStep(LOADING, { type })).toEqual({ phase: 'fallback', reason: 'unavailable' });
      expect(officeStep(READY, { type })).toEqual({ phase: 'fallback', reason: 'unavailable' });
      // Ignored before there is an editor to have failed.
      expect(officeStep(CONFIG, { type })).toEqual(CONFIG);
    }
  });

  it('officeStep keeps the server reason, and maps a failed call (HTTP_404, NETWORK) to unavailable', () => {
    for (const reason of ['not_configured', 'unsupported_kind', 'no_file', 'unavailable'] as const) {
      const e: OfficeEvent = { type: 'config', result: { ok: true, data: { available: false, reason } } };
      expect(officeStep(CONFIG, e)).toEqual({ phase: 'fallback', reason });
    }
    for (const code of ['HTTP_404', 'NETWORK', 'NOT_AVAILABLE', 'TIMEOUT']) {
      const e: OfficeEvent = { type: 'config', result: { ok: false, code } };
      expect(officeStep(CONFIG, e)).toEqual({ phase: 'fallback', reason: 'unavailable' });
    }
  });

  it('a fallback state ignores every later editor event (there is no editor)', () => {
    const fallback: OfficeState = { phase: 'fallback', reason: 'not_configured' };
    for (const type of ['script_failed', 'timeout', 'editor_error', 'app_ready'] as const) {
      expect(officeStep(fallback, { type })).toEqual(fallback);
    }
  });
});
