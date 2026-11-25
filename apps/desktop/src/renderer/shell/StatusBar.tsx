import type { SyncState } from '@meetless/client/bridge';
import type { MessageKey } from '@meetless/i18n';
import { useApp } from '../app/AppContext';
import type { Tone } from '../ui/tone';

const SYNC_TONE: Record<SyncState, Tone> = { online: 'neutral', connecting: 'neutral', offline: 'warning', signed_out: 'muted' };

/**
 * Sync status as coloured text, records the local replay could not apply (never hidden), the
 * notices, and the outbox (queued changes are not yet effective).
 */
export function StatusBar() {
  const { snapshot, skipped, notices, dismissNotice, t, errorText, bridge } = useApp();
  const st = snapshot.status;
  const queued = snapshot.outbox.filter((o) => o.status === 'queued').length;
  const rejected = snapshot.outbox.filter((o) => o.status === 'rejected');
  return (
    <div className="statusbar">
      <span className={`small tone-${SYNC_TONE[st.state]}`} data-testid="sync-status" data-state={st.state}>
        {t(`sync.${st.state}` as MessageKey)}
      </span>
      {skipped.length > 0 && (
        <span className="small tone-warning" data-testid="sync-skipped">
          {t('sync.skipped', { n: skipped.length })}
        </span>
      )}
      {queued > 0 && <span className="small tone-warning">{t('outbox.queued', { n: queued })}</span>}
      {rejected.map((o) => (
        <span key={o.id} className="sb-item small tone-danger">
          {t('outbox.rejected', { reason: errorText(o.error?.code ?? '') })}
          <button type="button" className="link" onClick={() => void bridge.dismissOutbox(o.id)}>
            {t('outbox.dismiss')}
          </button>
        </span>
      ))}
      {notices.map((n) => (
        <span key={n.id} className={`sb-item small tone-${n.tone === 'error' ? 'danger' : 'info'}`} role={n.tone === 'error' ? 'alert' : 'status'}>
          {n.text}
          <button type="button" className="link" onClick={() => dismissNotice(n.id)}>
            {t('close')}
          </button>
        </span>
      ))}
    </div>
  );
}
