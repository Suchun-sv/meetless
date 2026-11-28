/** A brand-new need: kind, title, acceptance (external) or expect and verify (hypothesis), DDL and the only-me switch. */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Segmented, Sheet, Text, TextField } from '@/components/ui';
import { newId, useApp, useGo } from '@/state';
import { space } from '@/theme';
import { currentRound, projectRounds, type Id, type NeedKind } from '@meetless/core';
import { runCmds } from '../confirm/model/run';
import { newNeedCommand } from './model/edit';
import { Chip, Row } from './ui/kit';

export function NewNeedSheet({ open, projectId, onClose }: { open: boolean; projectId: Id; onClose: () => void }) {
  const { t, live, today, submit, notify, errorText } = useApp();
  const go = useGo();
  const [needId, setNeedId] = useState(() => newId('n'));
  const [kind, setKind] = useState<NeedKind>('ext');
  const [title, setTitle] = useState('');
  const [accept, setAccept] = useState('');
  const [expect, setExpect] = useState('');
  const [verify, setVerify] = useState('');
  const [roundId, setRoundId] = useState<Id | null>(null);
  const [priv, setPriv] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setNeedId(newId('n'));
    setTitle('');
    setAccept('');
    setExpect('');
    setVerify('');
    setPriv(false);
    setRoundId(currentRound(live, projectId)?.id ?? null);
    // Reset only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const cmd = newNeedCommand({ kind, title, accept, expect, verify, roundId, private: priv }, projectId, needId, today, t('nn.manual'));
  const create = async () => {
    if (!cmd) return;
    setBusy(true);
    try {
      if (await runCmds([cmd], submit)) {
        onClose();
        go({ view: 'board', projectId, needId });
      }
    } catch {
      notify('error', errorText('NETWORK'));
    } finally {
      setBusy(false);
    }
  };
  const rounds = projectRounds(live, projectId).filter((r) => r.status !== 'delivered');
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('nn.title')}
      footer={
        <>
          <Button label={t('common.cancel')} variant="ghost" onPress={onClose} disabled={busy} />
          <Button testID="nn-create" label={t('nn.create')} variant="primary" busy={busy} disabled={!cmd} onPress={create} />
        </>
      }
    >
      <Segmented value={kind} options={(['ext', 'hyp'] as const).map((k) => ({ value: k, label: t(`kind.${k}`) }))} onChange={setKind} />
      <TextField testID="nn-title" label={t('nn.titlePh')} value={title} onChangeText={setTitle} editable={!busy} />
      {kind === 'ext' ? (
        <TextField label={t('nn.accept')} value={accept} onChangeText={setAccept} editable={!busy} />
      ) : (
        <>
          <TextField label={t('nn.expect')} value={expect} onChangeText={setExpect} editable={!busy} />
          <TextField label={t('nn.verify')} value={verify} onChangeText={setVerify} editable={!busy} />
        </>
      )}
      <View style={{ gap: space[1] }}>
        <Text size="sm" weight="medium" color="textSecondary" tight>
          {t('nn.round')}
        </Text>
        <Row wrap>
          {rounds.map((r) => (
            <Chip key={r.id} label={r.title || t('round', { n: r.n })} on={roundId === r.id} onPress={() => setRoundId(r.id)} />
          ))}
          <Chip label={t('round.none')} on={roundId === null} onPress={() => setRoundId(null)} />
        </Row>
      </View>
      <Segmented value={priv ? 'only' : 'project'} options={[{ value: 'project', label: t('pv.project') }, { value: 'only', label: t('pv.only') }]} onChange={(v) => setPriv(v === 'only')} />
    </Sheet>
  );
}
