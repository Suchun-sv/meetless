import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { Id } from '@meetless/core';
import { Button, Sheet, Text, TextField } from '@/components/ui';
import { useApp } from '@/state';
import { colors, radius, space } from '@/theme';
import { ccHandoff, ccSetRepo, ccStatus, type ApiFn, type CcHandoff } from './api';

/** 在别处继续: the commands that resume this session in a terminal or through Remote Control, each with 复制 and one line on what it does. */
export function CcHandoffBody({ projectId }: { projectId: Id }) {
  const { t, api, notify } = useApp();
  const [h, setH] = useState<CcHandoff | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let live = true;
    ccHandoff(api as unknown as ApiFn, projectId)
      .then((x) => live && setH(x))
      .catch((e: { code?: string }) => live && setFailed(e.code ?? 'ERROR'));
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [api, projectId]);
  if (failed) return <Text color="textSecondary">{failed === 'NOT_AUTHORISED' ? t('cc.viewer') : t('cc.handoff.none')}</Text>;
  if (!h) return null;
  if (h.commands.length === 0) return <Text color="textSecondary">{t('cc.handoff.none')}</Text>;
  const copy = async (i: number, c: string) => {
    const ok = await Clipboard.setStringAsync(c).catch(() => false);
    if (!ok) return notify('error', t('lk.copyFailed'));
    setCopied(i);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1500);
  };
  return (
    <View style={styles.list} testID="cc-handoff">
      {h.commands.map((c, i) => (
        <View key={c.kind} style={styles.item}>
          <View style={styles.row}>
            <Text weight="semibold" style={styles.grow}>
              {t(`cc.handoff.${c.kind}`)}
            </Text>
            <Button size="sm" label={copied === i ? `✓ ${t('cp.copied')}` : t('lk.copy')} onPress={() => void copy(i, c.command)} />
          </View>
          <Text size="sm" color="textSecondary">
            {c.note ?? t(`cc.handoff.${c.kind}Note`)}
          </Text>
          <Text size="xs" mono selectable style={styles.cmd}>
            {c.command}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function CcHandoffSheet({ projectId, open, onClose }: { projectId: Id; open: boolean; onClose: () => void }) {
  const { t } = useApp();
  return (
    <Sheet open={open} onClose={onClose} title={t('cc.handoff.title')} height="auto">
      {open && <CcHandoffBody projectId={projectId} />}
    </Sheet>
  );
}

/** 「代码仓库（只读）」 for project settings: a path on the server; the session sees it as `repo/`, read-only. Owner only. */
export function RepoPathField({ projectId }: { projectId: Id }) {
  const { t, api, notify, errorText } = useApp();
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [owner, setOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    ccStatus(api as unknown as ApiFn, projectId)
      .then((s) => {
        if (!live) return;
        setOwner(s.owner);
        setValue(s.repoPath ?? '');
        setSaved(s.repoPath ?? '');
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, projectId]);
  const save = async () => {
    setBusy(true);
    try {
      const r = await ccSetRepo(api as unknown as ApiFn, projectId, value.trim() || null);
      setSaved(r.repoPath ?? '');
      notify('info', t('cc.repo.saved'));
    } catch (e) {
      notify('error', errorText((e as { code?: string }).code ?? 'ERROR'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.repo} testID="cc-repo">
      <TextField label={t('cc.repo.label')} value={value} onChangeText={setValue} placeholder={t('cc.repo.ph')} editable={owner} autoCapitalize="none" mono />
      {owner && value.trim() !== (saved ?? '') && <Button size="sm" variant="primary" label={t('cc.repo.save')} busy={busy} onPress={() => void save()} style={styles.end} />}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space[4] },
  item: { gap: space[1] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  grow: { flex: 1 },
  cmd: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space[2] + 2, marginTop: space[1] },
  repo: { gap: space[2] },
  end: { alignSelf: 'flex-end' },
});
