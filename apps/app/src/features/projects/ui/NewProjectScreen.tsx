import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { newProjectCommands } from '@renderer/setup/model';
import { Button, Screen, Text, TextField } from '@/components/ui';
import { newId, useApp, useGo } from '@/state';
import { space } from '@/theme';
import { DateField } from './fields';

/**
 * A name, an optional description, optional DDLs (a name and a date each, 「再加一个」), and
 * create: `project.created` then a `round.created` per DDL, then the new project's 看板.
 */
export function NewProjectScreen() {
  const { t, submit, today } = useApp();
  const go = useGo();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [ddls, setDdls] = useState<{ title: string; due: string }[]>([{ title: '', due: '' }]);
  const [busy, setBusy] = useState(false);
  const setDdl = (i: number, patch: Partial<{ title: string; due: string }>) => setDdls((cur) => cur.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const create = async () => {
    if (busy) return;
    const projectId = newId('p');
    const cmds = newProjectCommands({ projectId, name, description, ddls, today, roundId: () => newId('rnd') });
    if (!cmds.length) return;
    setBusy(true);
    let ok = true;
    for (const cmd of cmds) {
      const r = await submit(cmd.type, cmd.payload);
      if (r.kind === 'rejected') {
        ok = cmd.type !== 'project.created';
        break;
      }
    }
    setBusy(false);
    if (ok) go({ view: 'dash', projectId }, { replace: true });
  };
  return (
    <Screen title={t('pj.title')}>
      <View style={{ gap: space[3] }} testID="page-newProject">
        <TextField value={name} onChangeText={setName} placeholder={t('pj.namePh')} accessibilityLabel={t('pj.name')} testID="project-name" onSubmitEditing={() => void create()} />
        <TextField value={description} onChangeText={setDescription} placeholder={t('pj.descr')} accessibilityLabel={t('pj.descr')} testID="project-descr" />
        <Text size="sm" color="textTertiary" tight>
          {t('pj.ddls')}
        </Text>
        {ddls.map((d, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap', alignItems: 'center' }}>
            <View style={{ flex: 1, minWidth: 180 }}>
              <TextField value={d.title} onChangeText={(v) => setDdl(i, { title: v })} placeholder={t('pj.ddlTitle')} accessibilityLabel={t('pj.ddlTitle')} testID="np-ddl-title" />
            </View>
            <DateField value={d.due} onChange={(v) => setDdl(i, { due: v })} label={t('pj.ddlDue')} testID="np-ddl-due" />
          </View>
        ))}
        <Pressable accessibilityRole="button" testID="np-ddl-add" onPress={() => setDdls((cur) => [...cur, { title: '', due: '' }])} style={{ alignSelf: 'flex-start' }} hitSlop={8}>
          <Text size="sm" color="textSecondary">
            {t('pj.addDdl')}
          </Text>
        </Pressable>
        <Button variant="primary" label={t('pj.create')} disabled={!name.trim() || busy} busy={busy} testID="project-create" onPress={() => void create()} style={{ alignSelf: 'flex-start' }} />
      </View>
    </Screen>
  );
}
