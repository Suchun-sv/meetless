import { useState } from 'react';
import { rolesOf, SEP, type Id } from '@meetless/core';
import { useApp } from '../app/AppContext';
import type { PageProps } from '../app/pages';
import { Avatar, Btn } from '../ui/primitives';
import { Invites } from './Invites';
import { addMemberCommands, addableUsers, canCreateRole, memberRows, roleCommands } from './model';
import './setup.css';

/**
 * Members, roles and invite codes for a project (contract §8, design §8.4): everyone with their
 * role pills (each removable), an "Add member" form, "Roles" with create and per-role assign,
 * then invite codes. A setup page, like `RoundsPage` and `NewProjectPage`: no composer
 * (`test/skeleton.test.tsx`'s `COMPOSER_VIEWS` does not carry `members`, and `Shell`'s own
 * `composer()` would otherwise render one for any view that has a `projectId`).
 */
export function MembersPage(_props: PageProps) {
  const { route, live, me, t, submit } = useApp();
  const [pickUser, setPickUser] = useState('');
  const [pickRole, setPickRole] = useState('');
  const [roleName, setRoleName] = useState('');
  const [roleBusy, setRoleBusy] = useState(false);
  const [assignPick, setAssignPick] = useState<Record<Id, string>>({});

  if (!('projectId' in route)) return null;
  const { projectId } = route;

  const rows = memberRows(live, projectId);
  const nameById = new Map(rows.map((r) => [r.userId, r.name]));
  const nameOf = (userId: Id) => nameById.get(userId) ?? userId;
  const addable = addableUsers(live, projectId);
  const createdRoles = rolesOf(live, projectId).filter((r): r is { roleId: Id; name: string; memberIds: Id[] } => r.roleId !== null);

  const addMember = async () => {
    if (!pickUser) return;
    for (const cmd of addMemberCommands(projectId, pickUser, pickRole || null)) {
      const r = await submit(cmd.type, cmd.payload);
      if (r.kind === 'rejected') return;
    }
    setPickUser('');
    setPickRole('');
  };

  const addRole = async () => {
    if (!canCreateRole(roleName, roleBusy)) return;
    const [cmd] = roleCommands.create(projectId, roleName);
    if (!cmd) return;
    setRoleBusy(true);
    const r = await submit(cmd.type, cmd.payload);
    setRoleBusy(false);
    if (r.kind !== 'rejected') setRoleName('');
  };

  const assign = async (roleId: Id, userId: string) => {
    if (!userId) return;
    const [cmd] = roleCommands.assign(roleId, userId);
    if (!cmd) return;
    const r = await submit(cmd.type, cmd.payload);
    if (r.kind !== 'rejected') setAssignPick((p) => ({ ...p, [roleId]: '' }));
  };

  const removeFromRole = (roleId: Id, userId: Id) => {
    const [cmd] = roleCommands.remove(roleId, userId);
    if (!cmd) return;
    void submit(cmd.type, cmd.payload);
  };

  return (
    <div className="page" data-testid="page-members">
      <h1>{t('pj.members')}</h1>
      <div className="members-list">
        {rows.map((row) => (
          <div className="member-row" key={row.userId} data-testid="member" data-member={row.userId}>
            <Avatar userId={row.userId} />
            <span className="grow">
              {row.name}
              {row.userId === me && <span className="small muted"> {t('pj.you')}</span>}
            </span>
            <span className="member-roles">
              {row.roleIds.map((roleId) => (
                <span className="pill" key={roleId}>
                  {live.roles[roleId]?.name}
                  <button
                    type="button"
                    className="pill-rm"
                    aria-label={t('pj.removeRole')}
                    data-testid="member-role-remove"
                    onClick={() => removeFromRole(roleId, row.userId)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>

      <h2 className="h3">{t('pj.addMember')}</h2>
      <div className="tools">
        <div className="tool">
          {addable.length === 0 ? (
            <p className="small muted grow">{t('pj.allIn')}</p>
          ) : (
            <select className="sel" value={pickUser} onChange={(e) => setPickUser(e.target.value)} aria-label={t('pj.pickUser')} data-testid="members-pick">
              <option value="">{t('pj.pickUser')}</option>
              {addable.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          )}
          <select className="sel" value={pickRole} onChange={(e) => setPickRole(e.target.value)} aria-label={t('pj.roles')} data-testid="members-role">
            <option value="">{t('pj.noRole')}</option>
            {createdRoles.map((r) => (
              <option key={r.roleId} value={r.roleId}>
                {r.name}
              </option>
            ))}
          </select>
          <Btn kind="primary" testId="members-add" disabled={!pickUser} onClick={() => void addMember()}>
            {t('pj.addMember')}
          </Btn>
        </div>
      </div>

      <h2 className="h3">{t('pj.roles')}</h2>
      <div className="tools">
        <div className="tool">
          <input className="inp" value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder={t('pj.roleName')} aria-label={t('pj.roleName')} data-testid="role-name" />
          <Btn kind="primary" testId="role-add" disabled={!canCreateRole(roleName, roleBusy)} onClick={() => void addRole()}>
            {t('pj.addRole')}
          </Btn>
        </div>
        {createdRoles.map((r) => {
          const inRole = new Set(r.memberIds);
          const assignable = rows.filter((row) => !inRole.has(row.userId));
          return (
            <div className="tool" key={r.roleId} data-testid="role" data-role={r.roleId}>
              <span className="grow">
                {r.name}
                {SEP}
                <span className="small muted">{r.memberIds.map(nameOf).join(SEP)}</span>
              </span>
              <select
                className="sel"
                value={assignPick[r.roleId] ?? ''}
                onChange={(e) => void assign(r.roleId, e.target.value)}
                aria-label={t('pj.assign')}
                data-testid="role-assign"
              >
                <option value="">{t('pj.assign')}</option>
                {assignable.map((row) => (
                  <option key={row.userId} value={row.userId}>
                    {row.name}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      <p className="small muted">{t('pj.rolesNote')}</p>

      <Invites projectId={projectId} />
    </div>
  );
}
