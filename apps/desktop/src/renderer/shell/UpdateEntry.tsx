import { useEffect, useState } from 'react';
import type { UpdateState } from '@meetless/client/bridge';
import { useApp } from '../app/AppContext';
import { Modal } from '../ui/Modal';
import { Btn } from '../ui/primitives';
import './update.css';

/*
 * The app-update entry in the sidebar user row (docs/RELEASE.md). The update UI follows Gleeok's
 * update dialog (app/src/renderer, `installRelease` / `latestRelease`): it offers the version, the
 * user confirms with the release notes in view, and a progress line follows the install.
 */

/** Asks the main process for the update state on mount and follows its `update` events. Shows nothing without an updater. */
export function UpdateEntry() {
  const { bridge } = useApp();
  const [state, setState] = useState<UpdateState | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    let alive = true;
    const off = bridge.subscribe((e) => {
      if (e.type === 'update') setState(e.update);
    });
    bridge
      .updatesCheck()
      .then((r) => {
        if (alive && r.ok) setState(r.update);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      off();
    };
  }, [bridge]);
  const retry = () => {
    void bridge
      .updatesCheck()
      .then((r) => {
        if (r.ok) setState(r.update);
      })
      .catch(() => undefined);
  };
  const install = () => {
    setConfirming(false);
    // The outcome arrives as `update` events (progress, failure); a restart ends the app.
    void bridge.updatesInstall().catch(() => undefined);
  };
  return <UpdateView state={state} confirming={confirming} onAsk={() => setConfirming(true)} onCancel={() => setConfirming(false)} onInstall={install} onRetry={retry} />;
}

/** What the entry shows for `state`; exported for the component tests. */
export function UpdateView({
  state,
  confirming,
  onAsk,
  onCancel,
  onInstall,
  onRetry,
}: {
  state: UpdateState | null;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onInstall: () => void;
  onRetry?: () => void;
}) {
  const { t, tr } = useApp();
  // The version and the hot commit running. Hot updates apply silently (src/main/hot-update.ts).
  const hotLine = state?.hot ? (
    <div className="upd-s faint" data-testid="update-version">
      {`v${state.current}${state.hot.commit ? ` ${state.hot.commit}` : ''}`}
    </div>
  ) : null;
  if (!state?.available) {
    if (!state?.checkError || !onRetry) return hotLine ? <div className="upd" data-testid="update">{hotLine}</div> : null;
    // A failed check (network, proxy, timeout) says so, instead of showing nothing.
    return (
      <div className="upd" data-testid="update">
        {hotLine}
        <button type="button" className="link upd-s tone-danger" data-testid="update-retry" onClick={onRetry}>
          {t('upd.checkFailed')}
        </button>
      </div>
    );
  }
  const { version, notes } = state.available;
  const progress =
    state.phase === 'downloading'
      ? state.percent === null
        ? t('upd.downloadingNoPct')
        : t('upd.downloading', { n: state.percent })
      : state.phase === 'installing'
        ? t('upd.installing')
        : state.phase === 'restarting'
          ? t('upd.restarting')
          : null;
  const reason = state.phase === 'failed' ? tr.tDynamic(tr.has(`upd.err.${state.error}`) ? `upd.err.${state.error}` : 'upd.err.UPDATE_FAILED') : null;
  return (
    <div className="upd" data-testid="update">
      <div className="upd-row">
        <span className="upd-t">{t('upd.available', { v: version })}</span>
        {progress === null &&
          (state.install === 'self' ? (
            <button type="button" className="link upd-go" data-testid="update-install" onClick={onAsk}>
              {t('upd.install')}
            </button>
          ) : (
            <a className="link upd-go" data-testid="update-download" href={state.releasesUrl} target="_blank" rel="noreferrer">
              {t('upd.download')}
            </a>
          ))}
      </div>
      {progress !== null && (
        <div className="upd-s" data-testid="update-progress" aria-live="polite">
          {progress}
        </div>
      )}
      {reason !== null && <div className="upd-s tone-danger">{t('upd.failed', { reason })}</div>}
      {confirming && (
        <Modal onClose={onCancel} testId="update-confirm">
          <h2>{t('upd.confirmTitle', { v: version })}</h2>
          <p className="muted small">{t('upd.confirmBody')}</p>
          <div className="upd-notes-h small faint">{t('upd.notes')}</div>
          <div className="upd-notes">
            {notes.map((n, i) => (
              <p key={i}>{n}</p>
            ))}
          </div>
          <div className="row gap6 upd-foot">
            <button type="button" className="btn" onClick={onCancel}>
              {t('common.cancel')}
            </button>
            <Btn kind="primary" testId="update-confirm-go" onClick={onInstall}>
              {t('upd.confirm')}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
