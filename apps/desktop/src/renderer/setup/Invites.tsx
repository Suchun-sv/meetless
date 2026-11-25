import { useEffect, useState } from 'react';
import type { InviteInfo } from '@meetless/api';
import type { Id, State } from '@meetless/core';
import { useApp } from '../app/AppContext';
import { Btn } from '../ui/primitives';
import { inviteStatus, routeErrorText } from './model';
import './setup.css';

/** An invite's role name: the role's own name, or the "no role" label when it carries none. */
function roleNameFor(live: State, roleId: Id | null, noRoleLabel: string): string {
  if (!roleId) return noRoleLabel;
  return live.roles[roleId]?.name ?? noRoleLabel;
}

/** A revoke that failed on one invite row: shown inline on that row, never on the others. */
export interface RevokeError {
  inviteId: Id;
  code: string;
}

/**
 * The invite list, presentational per the file-structure rule: `Invites` loads `invites` in an
 * effect and passes them here, so a static test can render this with props (effects never run
 * in `renderToStaticMarkup`). `error`, when set, is a failed `invites.list` or `invites.create`
 * (both are S routes, `HTTP_404` until S merges): it replaces the list, since there is nothing
 * live to show either way, but never the create form above it. `revokeError` is different: a
 * failed `invites.revoke` never discards the already-loaded rows (there is live data to show,
 * and wiping it loses history for no reason) — it shows inline on the one row it happened on.
 */
export function InviteList({
  invites,
  live,
  onRevoke,
  error,
  revokeError,
}: {
  invites: InviteInfo[];
  live: State;
  onRevoke: (inviteId: Id) => void;
  error?: string | null;
  revokeError?: RevokeError | null;
}) {
  const { t, fmtDateTime, errorText } = useApp();
  if (error) {
    return (
      <p className="small tone-danger" data-testid="invite-error">
        {error}
      </p>
    );
  }
  if (invites.length === 0) return <p className="small muted">{t('inv.none')}</p>;
  return (
    <div className="tools" data-testid="invite-list">
      {invites.map((inv) => {
        const status = inviteStatus(inv);
        const who = inv.usedBy ? (live.users[inv.usedBy]?.displayName ?? inv.usedBy) : '';
        return (
          <div className="tool" key={inv.id} data-testid="invite" data-invite={inv.id}>
            <span className="small muted">{t('inv.createdAt', { t: fmtDateTime(inv.createdAt) })}</span>
            <span className="grow">{roleNameFor(live, inv.roleId, t('pj.noRole'))}</span>
            {status === 'open' && <span className="st tone-info">{t('inv.open')}</span>}
            {status === 'used' && <span className="st tone-success">{t('inv.used', { who })}</span>}
            {status === 'revoked' && <span className="st tone-muted">{t('inv.revoked')}</span>}
            {status === 'open' && (
              <Btn testId="invite-revoke" onClick={() => onRevoke(inv.id)}>
                {t('inv.revoke')}
              </Btn>
            )}
            {revokeError && revokeError.inviteId === inv.id && (
              <span className="small tone-danger" data-testid="invite-revoke-error">
                {routeErrorText(t, errorText, revokeError.code)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Invite codes (contract §4 `redeemInvite`): a role select and create, the created code shown
 * once (held only in this component's own state, never written to storage or logged), then the
 * list. `invites.create|list|revoke` are S routes and answer `HTTP_404` until S merges, which
 * reads `pj.unsupported` here (ruling R22; other codes keep `errorText`). A failed
 * `invites.list` or `invites.create` shows in place of the list (`InviteList`'s `error`); a
 * failed `invites.revoke` never discards the list (it already loaded fine) and shows inline on
 * the one row it happened on (`InviteList`'s `revokeError`). Either way the create form keeps
 * working.
 */
export function Invites({ projectId }: { projectId: Id }) {
  const { t, live, api, errorText } = useApp();
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<RevokeError | null>(null);
  const [roleId, setRoleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api('invites.list', { projectId }).then((r) => {
      if (!alive) return;
      if (r.ok) setInvites(r.data.invites);
      else setError(routeErrorText(t, errorText, r.code));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const roles = Object.values(live.roles).filter((r) => r.projectId === projectId);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    const r = await api('invites.create', { projectId, roleId: roleId || null });
    setBusy(false);
    if (r.ok) {
      setError(null);
      setCode(r.data.code);
      setInvites((cur) => [r.data.invite, ...cur]);
    } else {
      setError(routeErrorText(t, errorText, r.code));
    }
  };

  const revoke = async (inviteId: Id) => {
    setRevokeError(null);
    const r = await api('invites.revoke', { projectId, inviteId });
    if (r.ok) setInvites((cur) => cur.map((i) => (i.id === inviteId ? { ...i, revokedAt: new Date().toISOString() } : i)));
    else setRevokeError({ inviteId, code: r.code });
  };

  return (
    <div className="setup-invites">
      <h2 className="h3">{t('inv.title')}</h2>
      <p className="small muted">{t('inv.sub')}</p>
      <div className="tools">
        <div className="tool">
          <select className="sel" value={roleId} onChange={(e) => setRoleId(e.target.value)} aria-label={t('inv.role')} data-testid="invite-role">
            <option value="">{t('pj.noRole')}</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <Btn kind="primary" testId="invite-create" disabled={busy} onClick={() => void create()}>
            {t('inv.create')}
          </Btn>
        </div>
      </div>
      {code && (
        <p className="small invite-code-row">
          <span className="mono" data-testid="invite-code">
            {code}
          </span>
          <span className="muted">{t('inv.once')}</span>
          <Btn testId="invite-copy" onClick={() => void navigator.clipboard?.writeText(code)}>
            {t('inv.copy')}
          </Btn>
        </p>
      )}
      <h3 className="small muted">{t('inv.list')}</h3>
      <InviteList invites={invites} live={live} onRevoke={(id) => void revoke(id)} error={error} revokeError={revokeError} />
    </div>
  );
}
