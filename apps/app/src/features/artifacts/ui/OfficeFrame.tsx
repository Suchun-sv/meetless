import { WebView } from 'react-native-webview';
import type { Locale } from '@meetless/i18n';
import { officeHtml, officeMessage, type OfficeEvent } from '../model';

/** The read-only OnlyOffice editor in a WebView (iOS). The page reports back through postMessage. */
export function OfficeFrame({ documentServerUrl, config, locale, mobile, baseUrl, onEvent }: { documentServerUrl: string; config: Record<string, unknown>; locale: Locale; mobile: boolean; baseUrl: string | null; onEvent: (e: OfficeEvent) => void }) {
  const url = documentServerUrl.startsWith('/') && baseUrl ? `${baseUrl.replace(/\/+$/, '')}${documentServerUrl}` : documentServerUrl;
  return (
    <WebView
      testID="oo-frame"
      originWhitelist={['*']}
      source={{ html: officeHtml(url, config, locale, mobile), baseUrl: baseUrl ?? url }}
      onMessage={(e) => {
        const ev = officeMessage(e.nativeEvent.data);
        if (ev) onEvent(ev);
      }}
      style={{ flex: 1, backgroundColor: 'transparent' }}
    />
  );
}
