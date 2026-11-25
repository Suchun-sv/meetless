import { Component, type ReactNode } from 'react';

declare global {
  interface Window {
    /** Set by public/boot.js: reports a boot failure to the server (web only). */
    __meetlessReport?: (kind: string, message: string, stack?: string) => void;
    /** Set by public/boot.js: replaces the root with the bilingual boot error. */
    __meetlessShowBootError?: (message: string) => void;
    /** Set once React has mounted, so the boot guard stops replacing the page. */
    __meetlessMounted?: boolean;
  }
}

/**
 * The last line of defence around the whole app: a render error shows a plain bilingual message with
 * the error text instead of a blank page, and is reported like a boot error (web only). There is no
 * locale yet at this level, so both languages show.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    window.__meetlessReport?.('render', error.message, error.stack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="signin" role="alert" data-testid="app-error">
        <div className="signin-card">
          <p>Meetless 出错了，请刷新页面 / Meetless hit an error. Reload the page.</p>
          <pre className="small muted">{error.message}</pre>
        </div>
      </div>
    );
  }
}
