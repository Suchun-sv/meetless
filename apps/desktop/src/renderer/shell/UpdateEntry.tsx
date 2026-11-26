import { useEffect, useState } from 'react';
import type { MeetlessBridge, UpdateState } from '@meetless/client/bridge';
import { useApp } from '../app/AppContext';
import { Modal } from '../ui/Modal';
import { Btn } from '../ui/primitives';
import './update.css';

/*
 * App updates in the sidebar, the way Paseo shows them (packages/app/src/desktop/updates): checking
 * and downloading run in the background (src/main/release-updater.ts, hot-update.ts); a callout card
 * above the user row offers what is ready, and the user decides when. An update that is never
 * clicked goes in when the app quits (a full release) or at the next start (a hot update).
 */

/** The main process's update state, followed through `update` events; one check when first asked. */
function useUpdateState(bridge: MeetlessBridge): [UpdateState | null, () => void] {
  const [state, setState] = useState<UpdateState | null>(null);
  const check = () => {
    void bridge
      .updatesCheck()
      .then((r) => {
        if (r.ok) setState(r.update);
      })
      .catch(() => undefined);
  };
  useEffect(() => {
    const off = bridge.subscribe((e) => {
      if (e.type === 'update') setState(e.update);
    });
    check();
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);
  return [state, check];
}

const DISMISSED = 'meetless.update.dismissed';

/** What the callout offers: a full release first (it replaces everything), else a hot update. */
export interface CalloutModel {
  /** Dismissal is per version: the next one shows again. */
  key: string;
  error: boolean;
  version: string;
  notes: string[];
  body: 'downloading' | 'ready' | 'installing' | 'failed';
  percent: number | null;
  primary: 'restart' | 'refresh' | 'download' | 'retry';
  disabled: boolean;
}

export function calloutModel(s: UpdateState | null): CalloutModel | null {
  if (!s) return null;
  if (s.available) {
    const v = `v${s.available.version}`;
    const base = { key: `full:${s.available.version}`, version: v, notes: s.available.notes, percent: s.percent };
    if (s.install === 'manual') return { ...base, error: false, body: 'ready', primary: 'download', disabled: false };
    if (s.phase === 'failed') return { ...base, error: true, body: 'failed', primary: 'retry', disabled: false };
    if (s.phase === 'downloading') return { ...base, error: false, body: 'downloading', primary: 'restart', disabled: true };
    if (s.phase === 'installing' || s.phase === 'restarting') return { ...base, error: false, body: 'installing', primary: 'restart', disabled: true };
    return { ...base, error: false, body: 'ready', primary: 'restart', disabled: false };
  }
  const p = s.hot?.pending;
  if (p) return { key: `hot:${p.commit}`, error: false, version: `v${p.version} ${p.commit.slice(0, 7)}`, notes: p.notes, body: 'ready', percent: null, primary: p.apply === 'reload' ? 'refresh' : 'restart', disabled: false };
  return null;
}

/** The update callout card above the sidebar user row (desktop only). */
export function UpdateCallout() {
  const { bridge, t } = useApp();
  const [state, check] = useUpdateState(bridge);
  const [dismissed, setDismissed] = useState(() => window.localStorage.getItem(DISMISSED));
  const [notes, setNotes] = useState(false);
  const m = calloutModel(state);
  if (!m || m.key === dismissed) return null;
  const dismiss = () => {
    window.localStorage.setItem(DISMISSED, m.key);
    setDismissed(m.key);
  };
  const act = () => {
    if (m.primary === 'retry') return check();
    if (m.primary === 'download') return void window.open(state!.releasesUrl, '_blank', 'noreferrer');
    void bridge.updatesInstall().catch(() => undefined);
  };
  const label = m.primary === 'refresh' ? t('upd.refreshNow') : m.primary === 'retry' ? t('upd.retry') : m.primary === 'download' ? t('upd.download') : m.body === 'installing' ? t('upd.installing') : t('upd.restartUpdate');
  return (
    <div className="upd-card" data-testid="update-callout">
      <div className="upd-card-h">
        <strong className={m.error ? 'tone-danger' : undefined}>{m.error ? t('upd.cFailed') : t('upd.cAvail')}</strong>
        <span className="upd-s">{m.version}</span>
        <span className="grow" />
        <button type="button" className="wg-act" aria-label={t('upd.dismiss')} title={t('upd.dismiss')} data-testid="update-dismiss" onClick={dismiss}>
          ×
        </button>
      </div>
      {m.body === 'downloading' && <div className="upd-s">{t('upd.cDownloading', { n: m.percent ?? 0 })}</div>}
      <div className="row gap6 wrap">
        <button type="button" className="btn" data-testid="update-notes" onClick={() => setNotes(true)}>
          {t('upd.whatsNew')}
        </button>
        <Btn kind="primary" testId="update-go" disabled={m.disabled} onClick={act}>
          {label}
        </Btn>
      </div>
      {notes && (
        <Modal onClose={() => setNotes(false)} testId="update-notes-dialog">
          <h2>{t('upd.notesTitle', { v: m.version })}</h2>
          <div className="upd-notes">
            {(m.notes.length ? m.notes : [`Meetless ${m.version}`]).map((n, i) => (
              <p key={i}>{n}</p>
            ))}
          </div>
          <div className="row gap6 upd-foot">
            <button type="button" className="btn" onClick={() => setNotes(false)}>
              {t('upd.done')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** The status line in the sidebar user row: version and hot commit, where updates stand, and 「检查更新」. */
export function UpdateEntry() {
  const { bridge, t, fmtClock } = useApp();
  const [state, check] = useUpdateState(bridge);
  if (!state) return null;
  const pending = state.hot?.pending;
  const status = state.checkError
    ? t('upd.checkFailed')
    : state.available && state.phase === 'downloading'
      ? t('upd.sFound', { v: `v${state.available.version}`, n: state.percent ?? 0 })
      : state.available && state.phase === 'failed'
        ? t('upd.cFailed')
        : state.available
          ? t('upd.sReady', { v: `v${state.available.version}` })
          : pending
            ? t('upd.sReady', { v: `v${pending.version} ${pending.commit.slice(0, 7)}` })
            : state.lastChecked
              ? t('upd.sUpToDate', { t: fmtClock(state.lastChecked as never) })
              : t('upd.sUpToDateNoTime');
  return (
    <div className="upd" data-testid="update">
      <div className="upd-s faint" data-testid="update-version">
        {`v${state.current}${state.hot?.commit ? ` ${state.hot.commit}` : ''}`}
      </div>
      <div className={`upd-s${state.checkError || state.phase === 'failed' ? ' tone-danger' : ''}`} data-testid="update-status">
        {status}
      </div>
      <button type="button" className="link upd-s" data-testid="update-check" onClick={check}>
        {t('upd.check')}
      </button>
    </div>
  );
}
