import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { InviteInfo } from '@meetless/api';
import { rolesOf, SEP, type Id } from '@meetless/core';
import { addableUsers, addMemberCommands, canCreateRole, inviteStatus, memberRows, roleCommands, routeErrorText } from '@renderer/setup/model';
import { Avatar, Button, Screen, Text, TextField } from '@/components/ui';
import { useApp, useProjectId } from '@/state';
import { colors, radius, space } from '@/theme';
import { Chips, H2 } from './fields';

/**
 * Members, roles and invite codes for a project: everyone with their role labels (each
 * removable), add a member (optionally with a role), roles with create and assign, then invites.
 */
export function MembersScreen() {
  const { live, me, t, submit } = useApp();
  const projectId = useProjectId();
  const [pickUser, setPickUser] = useState('');
  const [pickRole, setPickRole] = useState('');
  const [roleName, setRoleName] = useState('');
  const [roleBusy, setRoleBusy] = useState(false);

  if (!live.projects[projectId])
    return (
      <Screen>
        <Text color="textSecondary">{t('home.empty')}</Text>
      </Screen>
    );
  const rows = memberRows(live, projectId);
  const nameOf = (userId: Id) => rows.find((r) => r.userId === userId)?.name ?? userId;
  const addable = addableUsers(live, projectId);
  const roles = rolesOf(live, projectId).filter((r): r is { roleId: Id; name: string; memberIds: Id[] } => r.roleId !== null);

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
  const run = (cmds: ReturnType<typeof roleCommands.assign>) => cmds.forEach((cmd) => void submit(cmd.type, cmd.payload));

  return (
    <Screen title={t('pj.members')}>
      <View style={{ gap: space[2] }} testID="page-members">
        {rows.map((row) => (
          <View key={row.userId} style={styles.row} testID="member">
            <Avatar userId={row.userId} />
            <Text style={{ flex: 1 }} numberOfLines={1}>
              {row.name}
              {row.userId === me ? <Text size="sm" color="textSecondary">{` ${t('pj.you')}`}</Text> : null}
            </Text>
            <View style={styles.pills}>
              {row.roleIds.map((roleId) => (
                <View key={roleId} style={styles.pill}>
                  <Text size="xs" tight>
                    {live.roles[roleId]?.name ?? ''}
                  </Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={t('pj.removeRole')} testID="member-role-remove" hitSlop={8} onPress={() => run(roleCommands.remove(roleId, row.userId))}>
                    <Text size="xs" color="textTertiary" tight>
                      ×
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>

      <H2>{t('pj.addMember')}</H2>
      {addable.length === 0 ? (
        <Text size="sm" color="textSecondary">
          {t('pj.allIn')}
        </Text>
      ) : (
        <View style={{ gap: space[3] }}>
          <Chips testID="members-pick" value={pickUser} onChange={setPickUser} options={addable.map((u) => ({ value: u.id, label: u.displayName }))} />
          <Chips testID="members-role" value={pickRole} onChange={setPickRole} options={[{ value: '', label: t('pj.noRole') }, ...roles.map((r) => ({ value: r.roleId, label: r.name }))]} />
          <Button variant="primary" label={t('pj.addMember')} disabled={!pickUser} testID="members-add" onPress={() => void addMember()} style={{ alignSelf: 'flex-start' }} />
        </View>
      )}

      <H2>{t('pj.roles')}</H2>
      <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <TextField value={roleName} onChangeText={setRoleName} placeholder={t('pj.roleName')} accessibilityLabel={t('pj.roleName')} testID="role-name" onSubmitEditing={() => void addRole()} />
        </View>
        <Button variant="primary" label={t('pj.addRole')} disabled={!canCreateRole(roleName, roleBusy)} testID="role-add" onPress={() => void addRole()} />
      </View>
      {roles.map((r) => {
        const assignable = rows.filter((row) => !r.memberIds.includes(row.userId));
        return (
          <View key={r.roleId} style={styles.role} testID="role">
            <Text numberOfLines={2}>
              {r.name}
              <Text size="sm" color="textSecondary">{`${SEP}${r.memberIds.map(nameOf).join(SEP)}`}</Text>
            </Text>
            {assignable.length ? (
              <View style={{ gap: space[1] }}>
                <Text size="xs" color="textTertiary" tight>
                  {t('pj.assign')}
                </Text>
                <Chips testID="role-assign" value="" onChange={(userId) => userId && run(roleCommands.assign(r.roleId, userId))} options={assignable.map((row) => ({ value: row.userId, label: row.name }))} />
              </View>
            ) : null}
          </View>
        );
      })}
      <Text size="sm" color="textSecondary">
        {t('pj.rolesNote')}
      </Text>

      <Invites projectId={projectId} />
    </Screen>
  );
}

/** Invite codes: a role choice and create, the code shown once with copy, then the list with revoke. */
function Invites({ projectId }: { projectId: Id }) {
  const { t, live, api, errorText, fmtDateTime } = useApp();
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<{ inviteId: Id; code: string } | null>(null);
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
    } else setError(routeErrorText(t, errorText, r.code));
  };
  const revoke = async (inviteId: Id) => {
    setRevokeError(null);
    const r = await api('invites.revoke', { projectId, inviteId });
    if (r.ok) setInvites((cur) => cur.map((i) => (i.id === inviteId ? { ...i, revokedAt: new Date().toISOString() } : i)));
    else setRevokeError({ inviteId, code: r.code });
  };

  return (
    <View style={{ gap: space[3] }}>
      <H2>{t('inv.title')}</H2>
      <Text size="sm" color="textSecondary">
        {t('inv.sub')}
      </Text>
      <Chips testID="invite-role" value={roleId} onChange={setRoleId} options={[{ value: '', label: t('pj.noRole') }, ...roles.map((r) => ({ value: r.id, label: r.name }))]} />
      <Button variant="primary" label={t('inv.create')} busy={busy} testID="invite-create" onPress={() => void create()} style={{ alignSelf: 'flex-start' }} />
      {code ? (
        <View style={[styles.row, styles.code]}>
          <Text mono weight="medium" testID="invite-code" selectable>
            {code}
          </Text>
          <Text size="sm" color="textSecondary" style={{ flex: 1 }}>
            {t('inv.once')}
          </Text>
          <Button size="sm" label={t('inv.copy')} testID="invite-copy" onPress={() => void Clipboard.setStringAsync(code)} />
        </View>
      ) : null}
      <Text size="sm" color="textTertiary" tight>
        {t('inv.list')}
      </Text>
      {error ? (
        <Text size="sm" color="danger" testID="invite-error">
          {error}
        </Text>
      ) : invites.length === 0 ? (
        <Text size="sm" color="textSecondary">
          {t('inv.none')}
        </Text>
      ) : (
        <View style={{ gap: space[2] }} testID="invite-list">
          {invites.map((inv) => {
            const status = inviteStatus(inv);
            const who = inv.usedBy ? (live.users[inv.usedBy]?.displayName ?? inv.usedBy) : '';
            return (
              <View key={inv.id} style={[styles.row, { flexWrap: 'wrap' }]} testID="invite">
                <Text size="sm" color="textSecondary" tight>
                  {t('inv.createdAt', { t: fmtDateTime(inv.createdAt) })}
                </Text>
                <Text size="sm" tight style={{ flex: 1 }}>
                  {inv.roleId ? (live.roles[inv.roleId]?.name ?? t('pj.noRole')) : t('pj.noRole')}
                </Text>
                {status === 'open' ? (
                  <Text size="xs" weight="medium" color="info" tight>
                    {t('inv.open')}
                  </Text>
                ) : status === 'used' ? (
                  <Text size="xs" weight="medium" color="success" tight>
                    {t('inv.used', { who })}
                  </Text>
                ) : (
                  <Text size="xs" weight="medium" color="textTertiary" tight>
                    {t('inv.revoked')}
                  </Text>
                )}
                {status === 'open' ? <Button size="sm" label={t('inv.revoke')} testID="invite-revoke" onPress={() => void revoke(inv.id)} /> : null}
                {revokeError?.inviteId === inv.id ? (
                  <Text size="sm" color="danger" testID="invite-revoke-error">
                    {routeErrorText(t, errorText, revokeError.code)}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 40 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1], justifyContent: 'flex-end', flexShrink: 1 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: space[1], backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: space[2], paddingVertical: 2 },
  role: { gap: space[2], borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: space[3] },
  code: { backgroundColor: colors.sidebar, borderRadius: radius.md, paddingHorizontal: space[3] },
});
