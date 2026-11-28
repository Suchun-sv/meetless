import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ARTIFACT_KINDS, clip, currentRound, noDots, type Artifact, type ArtifactKind, type Id } from '@meetless/core';
import { Button, Sheet, Text, TextField } from '@/components/ui';
import { newId, useApp } from '@/state';
import { colors, radius, space } from '@/theme';
import { isPrivate, type Visibility } from '../../privacy/model';
import { VisibilityToggle } from '../../privacy/ui';
import { ChipRow } from '../../inputs/ui/common';
import { pickFile, type PickedFile } from '../../inputs/ui/files';
import { addVersion, checkUrl, createArtifact, DEFAULT_WHERE, fileKinds, keepLinkable, linkableNeeds, mediaTypeFor, type ActionDeps } from '../model';

function useDeps(): ActionDeps {
  const { submit, bridge, notify, errorText } = useApp();
  return { submit, uploadBlob: (b, m) => bridge.uploadBlob(b, m), notify, errorText };
}

function FilePick({ label, kind, file, onFile }: { label: string; kind: ArtifactKind; file: PickedFile | null; onFile: (f: PickedFile | null) => void }) {
  const { t } = useApp();
  const pick = async () => {
    const m = mediaTypeFor(kind);
    onFile(await pickFile(m ? [m] : null));
  };
  return (
    <View style={{ gap: space[1] }}>
      <Text size="sm" weight="medium" color="textSecondary">
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <Button label={t('af.file')} size="sm" onPress={() => void pick()} />
        <Text size="sm" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
          {file ? noDots(file.name) : ''}
        </Text>
      </View>
    </View>
  );
}

function NeedTicks({ needs, selected, onToggle }: { needs: { id: Id; code: string; title: string }[]; selected: Id[]; onToggle: (id: Id) => void }) {
  return (
    <View style={{ gap: space[1] }}>
      {needs.map((n) => {
        const on = selected.includes(n.id);
        return (
          <Pressable key={n.id} testID="af-need-tick" accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => onToggle(n.id)} style={[st.tick, on && st.tickOn]}>
            <Text size="xs" mono color="textSecondary">
              {n.code}
            </Text>
            <Text size="sm" numberOfLines={1} style={{ flex: 1 }}>
              {clip(n.title, 60)}
            </Text>
            <Text size="xs" weight="medium" color={on ? 'text' : 'textTertiary'}>
              {on ? '✓' : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function NewArtifactSheet({ open, projectId, onClose, onCreated }: { open: boolean; projectId: Id; onClose: () => void; onCreated: (id: Id) => void }) {
  const { live, today, t, errorText } = useApp();
  const deps = useDeps();
  const [kind, setKind] = useState<ArtifactKind>('pdf');
  const [title, setTitle] = useState('');
  const [where, setWhere] = useState(DEFAULT_WHERE.pdf);
  const [url, setUrl] = useState('');
  const [vis, setVis] = useState<Visibility>('project');
  const [needIds, setNeedIds] = useState<Id[]>([]);
  const [file, setFile] = useState<PickedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const priv = isPrivate(vis);
  const needs = linkableNeeds(live, projectId, priv);
  const urlOk = checkUrl(kind, url) === 'ok';
  const canCreate = title.trim().length > 0 && urlOk && !busy;

  const changeKind = (k: ArtifactKind) => {
    setKind(k);
    setWhere(DEFAULT_WHERE[k]);
    setUrl('');
    setFile(null);
  };
  const changeVis = (v: Visibility) => {
    setVis(v);
    if (!isPrivate(v)) setNeedIds((xs) => keepLinkable(live, xs, false));
  };
  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    const artifactId = newId('a');
    const ok = await createArtifact(deps, {
      artifactId,
      versionId: newId('v'),
      projectId,
      kind,
      title: title.trim(),
      where: where.trim(),
      url: url.trim() || null,
      needIds: keepLinkable(live, needIds, priv),
      isPrivate: priv,
      file,
      today,
      roundId: currentRound(live, projectId)?.id ?? null,
    });
    setBusy(false);
    if (!ok) return;
    setTitle('');
    setUrl('');
    setNeedIds([]);
    setFile(null);
    onClose();
    onCreated(artifactId);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('af.new')}
      footer={
        <>
          <Button label={t('common.cancel')} onPress={onClose} />
          <Button testID="afn-create" label={t('common.create')} variant="primary" busy={busy} disabled={!canCreate} onPress={() => void create()} />
        </>
      }
    >
      <Text size="sm" weight="medium" color="textSecondary">
        {t('af.kind')}
      </Text>
      <ChipRow value={kind} onChange={changeKind} options={ARTIFACT_KINDS.map((k) => ({ value: k, label: DEFAULT_WHERE[k] }))} />
      <TextField testID="afn-title" label={t('af.title')} value={title} onChangeText={setTitle} />
      <TextField label={t('af.where')} value={where} onChangeText={setWhere} />
      <TextField testID="afn-url" label={t('af.url')} value={url} onChangeText={setUrl} autoCapitalize="none" error={url && !urlOk ? errorText('BAD_URL') : null} />
      <VisibilityToggle value={vis} onChange={changeVis} />
      {needs.length > 0 ? (
        <>
          <Text size="sm" weight="medium" color="textSecondary">
            {t('af.link')}
          </Text>
          <NeedTicks needs={needs} selected={needIds} onToggle={(id) => setNeedIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]))} />
        </>
      ) : null}
      {fileKinds.has(kind) ? <FilePick label={t('af.firstVersion')} kind={kind} file={file} onFile={setFile} /> : null}
    </Sheet>
  );
}

export function NewVersionSheet({ open, artifact, onClose }: { open: boolean; artifact: Artifact; onClose: () => void }) {
  const { live, today, t } = useApp();
  const deps = useDeps();
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<PickedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const isFile = fileKinds.has(artifact.kind);
  const canSave = label.trim().length > 0 && !busy && (isFile ? !!file : checkUrl(artifact.kind, url) === 'ok');
  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    const ok = await addVersion(deps, {
      artifactId: artifact.id,
      versionId: newId('v'),
      kind: artifact.kind,
      label: label.trim(),
      note: note.trim(),
      url: isFile ? null : url.trim() || null,
      file: isFile ? file : null,
      today,
      roundId: currentRound(live, artifact.projectId)?.id ?? null,
    });
    setBusy(false);
    if (!ok) return;
    setLabel('');
    setNote('');
    setUrl('');
    setFile(null);
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('af.addVersion')}
      footer={
        <>
          <Button label={t('common.cancel')} onPress={onClose} />
          <Button testID="afv-save" label={t('common.save')} variant="primary" busy={busy} disabled={!canSave} onPress={() => void save()} />
        </>
      }
    >
      <TextField testID="afv-label" label={t('af.label')} value={label} onChangeText={setLabel} />
      <TextField label={t('af.note')} value={note} onChangeText={setNote} multiline />
      {isFile ? <FilePick label={t('af.file')} kind={artifact.kind} file={file} onFile={setFile} /> : <TextField label={t('af.url')} value={url} onChangeText={setUrl} autoCapitalize="none" />}
    </Sheet>
  );
}

export function LinkNeedsSheet({ open, artifact, onClose }: { open: boolean; artifact: Artifact; onClose: () => void }) {
  const { live, t, submit } = useApp();
  const needs = linkableNeeds(live, artifact.projectId, artifact.privateTo !== null);
  const [selected, setSelected] = useState<Id[]>(artifact.needIds);
  const save = async () => {
    const r = await submit('artifact.linked', { artifactId: artifact.id, needIds: selected });
    if (r.kind !== 'rejected') onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('af.link')}
      footer={
        <>
          <Button label={t('common.cancel')} onPress={onClose} />
          <Button testID="afl-save" label={t('common.save')} variant="primary" onPress={() => void save()} />
        </>
      }
    >
      {needs.length === 0 ? (
        <Text size="sm" color="textSecondary">
          {t('af.needsNone')}
        </Text>
      ) : (
        <>
          <Text size="sm" color="textSecondary">
            {t('af.linkPick')}
          </Text>
          <NeedTicks needs={needs} selected={selected} onToggle={(id) => setSelected((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]))} />
        </>
      )}
    </Sheet>
  );
}

const st = StyleSheet.create({
  tick: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[2], minHeight: 36, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  tickOn: { backgroundColor: colors.selected, borderColor: colors.borderStrong },
});
