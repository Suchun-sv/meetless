import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { Id } from '@meetless/core';
import { renameCommand } from '@renderer/shell/rename';
import { space } from '@/theme';
import { Button, Divider, Sheet, Text, TextField } from '@/components/ui';
import { useApp } from '@/state';
import { RepoPathField } from '@/features/chat/cc/CcHandoff';
import { useCcAvailable } from '@/features/chat/cc/useCcAvailable';

/**
 * Project settings from the tree (the 「项目设置」 link or a long press): rename, and archive
 * (off the tree and Home, still readable under 「已归档」, nothing deleted) or restore.
 */
export function ProjectSheet({ projectId, onClose }: { projectId: Id | null; onClose: () => void }) {
  const { live, t, submit, me } = useApp();
  const ccOn = useCcAvailable(projectId ?? 'home') === true;
  const router = useRouter();
  const project = projectId ? live.projects[projectId] : undefined;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDraft(project?.name ?? '');
    setError(null);
  }, [projectId, project?.name]);

  if (!projectId || !project) return <Sheet open={false} onClose={onClose} children={null} />;

  const rename = async () => {
    const out = renameCommand(projectId, project.name, draft);
    if (out.kind === 'error') return setError(t(out.key));
    if (out.kind === 'none') return onClose();
    setBusy(true);
    const r = await submit(out.type, out.payload);
    setBusy(false);
    if (r.kind !== 'rejected') onClose();
  };
  const archive = async () => {
    setBusy(true);
    const r = await submit('project.archived', { projectId });
    setBusy(false);
    if (r.kind !== 'rejected') {
      onClose();
      router.navigate('/');
    }
  };
  const restore = async () => {
    setBusy(true);
    const r = await submit('project.unarchived', { projectId });
    setBusy(false);
    if (r.kind !== 'rejected') onClose();
  };

  return (
    <Sheet open onClose={onClose} title={t('pj.setup')}>
      <TextField label={t('pj.name')} value={draft} onChangeText={setDraft} error={error} onSubmitEditing={() => void rename()} testID="project-rename-input" />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Button label={t('pj.rename')} variant="primary" size="sm" busy={busy} onPress={() => void rename()} testID="project-rename-save" />
      </View>
      <Divider />
      {/* Claude Code session (A3): the read-only repo the session sees, and continuing it elsewhere. */}
      {ccOn ? <RepoPathField projectId={projectId} /> : null}
      {ccOn && project.createdBy === me ? (
        <Button
          label={t('cc.handoff.title')}
          size="sm"
          style={{ alignSelf: 'flex-start' }}
          onPress={() => {
            onClose();
            router.push(`/p/${encodeURIComponent(projectId)}/handoff?cc=1` as Href);
          }}
          testID="project-cc-handoff"
        />
      ) : null}
      <Divider />
      <View style={{ gap: space[2], paddingBottom: space[4] }}>
        <Text size="sm" color="textSecondary">
          {t('pj.archiveNote')}
        </Text>
        {project.archived ? (
          <Button label={t('pj.restore')} onPress={() => void restore()} busy={busy} style={{ alignSelf: 'flex-start' }} testID="project-restore-here" />
        ) : (
          <Button label={t('pj.archive')} variant="danger" onPress={() => void archive()} busy={busy} style={{ alignSelf: 'flex-start' }} testID="project-archive" />
        )}
      </View>
    </Sheet>
  );
}
