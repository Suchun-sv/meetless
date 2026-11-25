import { useApp, type AppApi } from '../app/AppContext';

/** Whether the renderer runs on the Meetless server's own page (the web bridge), not in Electron or behind the dev bridge. */
export function isWeb(app: Pick<AppApi, 'snapshot'>): boolean {
  return app.snapshot.host === 'web';
}

/**
 * Stands in, on the web, for a control that needs the local machine (a local git repository,
 * Overleaf git capture, Notion connect; design 2026-11-25 §6): 「请在桌面版使用」 as muted text.
 */
export function DesktopOnly({ testId = 'desktop-only' }: { testId?: string }) {
  const { t } = useApp();
  return (
    <p className="small muted" data-testid={testId}>
      {t('web.desktopOnly')}
    </p>
  );
}
