import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { Scene } from '@meetless/core';
import { Button, Screen, Segmented, Text, TextField } from '@/components/ui';
import { newId, useApp, useProject, useProjectId } from '@/state';
import { space } from '@/theme';
import { useOpenTarget } from '../chat/ui/nav';
import { canImport, EMPTY_DRAFT, importErrorKey, importOutcome, PASTE_SCENES, pasteHint, pasteRequest, type PasteDraft } from './model/paste';
import { useFileImport } from './ui/useFileImport';

/**
 * 粘贴导入 (新输入): paste a mail, meeting notes or a chat log, or pick a file. Needs are detected on
 * import and wait in To confirm; the new input opens afterwards.
 */
export function ImportScreen() {
  const { t, live, today, api, notify, errorText } = useApp();
  const projectId = useProjectId();
  const project = useProject();
  const open = useOpenTarget();
  const pickFile = useFileImport();
  const [d, setD] = useState<PasteDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<PasteDraft>) => setD((cur) => ({ ...cur, ...p }));

  if (!project) return <Screen title={t('xp.import')}>{<Text color="textSecondary">{t('xp.notFound')}</Text>}</Screen>;

  const hint = pasteHint(d.text);
  const done = (out: { open: Parameters<typeof open>[0]; extracts: number }) => {
    notify('info', out.extracts > 0 ? t('imp.done', { n: out.extracts }) : t('imp.doneNone'));
    setD(EMPTY_DRAFT);
    open(out.open);
  };

  const go = async () => {
    if (!canImport(d, busy)) return;
    setBusy(true);
    try {
      const res = await api('inputs.import', pasteRequest(live, projectId, d, today, newId('in'))).catch(() => null);
      if (!res) return notify('error', t('ch.fileFailed'));
      const out = importOutcome(res, projectId);
      if ('code' in out) {
        const k = importErrorKey(out.code);
        return notify('error', k ? t(k) : errorText(out.code));
      }
      done(out);
    } finally {
      setBusy(false);
    }
  };

  const file = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const out = await pickFile({ projectId, priv: d.priv, from: d.from });
      if (out) done(out);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('xp.import')}>
      <TextField label={t('in.mdName')} value={d.title} onChangeText={(v) => set({ title: v })} testID="imp-title" />
      <TextField
        multiline
        value={d.text}
        onChangeText={(v) => set({ text: v })}
        placeholder={t('cm.ph')}
        style={styles.text}
        testID="imp-text"
        hint={hint === 'add' ? t('imp.hintAdd') : t('cm.hint')}
      />
      <TextField label={t('in.fromPh')} value={d.from} onChangeText={(v) => set({ from: v })} testID="imp-from" />
      <View style={styles.field}>
        <Text size="sm" weight="medium" color="textSecondary" tight>
          {t('in.scene')}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Segmented<'auto' | Scene>
            size="sm"
            value={d.scene ?? 'auto'}
            onChange={(v) => set({ scene: v === 'auto' ? null : v })}
            options={[{ value: 'auto', label: t('imp.auto') }, ...PASTE_SCENES.map((s) => ({ value: s, label: t(`lin.type.${s}`) }))]}
          />
        </ScrollView>
      </View>
      <View style={styles.row}>
        <Segmented
          size="sm"
          value={d.priv ? 'only' : 'project'}
          onChange={(v) => set({ priv: v === 'only' })}
          options={[
            { value: 'project', label: t('pv.project') },
            { value: 'only', label: t('pv.only') },
          ]}
        />
        <View style={styles.grow} />
        <Button label={t('cm.attach')} onPress={() => void file()} disabled={busy} testID="imp-file" />
        <Button variant="primary" label={t('in.mdGo')} busy={busy} disabled={!canImport(d, busy)} onPress={() => void go()} testID="imp-go" />
      </View>
      <Text size="xs" color="textTertiary">
        {t('imp.files')}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  text: { minHeight: 220 },
  field: { gap: space[1] },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[2] },
  grow: { flexGrow: 1 },
});
