import { createElement, useEffect, useRef } from 'react';
import { OFFICE_LOAD_TIMEOUT_MS } from '@renderer/artifacts/office';
import type { Locale } from '@meetless/i18n';
import { officeEditorConfig, officeMessage, type OfficeEvent } from '../model';

/**
 * The read-only OnlyOffice editor in an iframe (web and desktop): public/office-frame.html, whose
 * script is a file because the desktop CSP refuses inline script (a srcdoc frame would inherit it).
 * Once the page has loaded it gets the editor config by postMessage, and it answers with the same
 * messages as the native WebView page.
 */
export function OfficeFrame({ documentServerUrl, config, locale, mobile, onEvent }: { documentServerUrl: string; config: Record<string, unknown>; locale: Locale; mobile: boolean; baseUrl: string | null; onEvent: (e: OfficeEvent) => void }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const ev = officeMessage(e.data);
      if (ev) onEvent(ev);
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [onEvent]);
  // `config` is stable for one office.config answer; the frame is keyed on the version by its parent.
  const init = () => {
    const full = officeEditorConfig(config, locale, mobile);
    frame.current?.contentWindow?.postMessage({ source: 'meetless-office-init', documentServerUrl, config: full, timeoutMs: OFFICE_LOAD_TIMEOUT_MS }, location.origin);
  };
  return createElement('iframe', { ref: frame, 'data-testid': 'oo-frame', src: '/office-frame.html', onLoad: init, title: 'OnlyOffice', style: { border: 0, width: '100%', height: '100%', flex: 1 } });
}
