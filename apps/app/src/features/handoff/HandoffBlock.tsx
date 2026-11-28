import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Handoff, Need } from '@meetless/core';
import { Avatar, Button, Text, TextField } from '@/components/ui';
import { useApp } from '@/state';
import { colors, radius, space, tones } from '@/theme';
import { useOpenTarget } from '../chat/ui/nav';
import { ACTION_LABEL, canSendNote, handoffBlock, handoffCommand, noteValue, PRIMARY_ACTIONS, type BlockLine, type HandoffAction } from './model/handoff';

const LINE_COLOR: Record<BlockLine['tone'], 'textTertiary' | 'textSecondary' | 'warning' | 'success'> = {
  faint: 'textTertiary',
  muted: 'textSecondary',
  warning: 'warning',
  success: 'success',
};

/**
 * The handoff block (交接区块) for one handoff of a need: who and state, due, the ask, the latest
 * note, the fetch and staleness lines with 「提醒刷新」, and the actions on offer to me. A2's need
 * detail renders one per live handoff (`liveHandoffs`), else the closed one (`shownHandoff`).
 */
export function HandoffBlock({ need, h }: { need: Need; h: Handoff }) {
  const { t, me, live, submit, fmtDay, fmtDateTime } = useApp();
  const open = useOpenTarget();
  const [form, setForm] = useState<'ask' | 'reopen' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setForm(null);
    setNote('');
    setBusy(false);
  }, [h.id]);

  const v = handoffBlock(t, live, h, me, { day: fmtDay, dateTime: fmtDateTime });

  const run = async (a: Exclude<HandoffAction, 'copy' | 'decide'>, text?: string) => {
    const cmd = handoffCommand(a, h, text);
    setBusy(true);
    try {
      const r = await submit(cmd.type, cmd.payload as never);
      // A rejection keeps the form and its note so it can be edited and sent again.
      if (r.kind === 'accepted' || r.kind === 'queued' || r.kind === 'duplicate') {
        setForm(null);
        setNote('');
      }
    } finally {
      setBusy(false);
    }
  };

  const press = (a: Exclude<HandoffAction, 'remind'>) => {
    switch (a) {
      case 'copy':
        return open({ kind: 'link', projectId: need.projectId, needId: need.id });
      case 'decide':
        return open({ kind: 'confirm', projectId: need.projectId });
      case 'ask':
      case 'reopen':
        return setForm((f) => (f === a ? null : a));
      default:
        return void run(a);
    }
  };

  return (
    <View style={[styles.block, v.hot && styles.hot]} testID="hob">
      <View style={styles.row}>
        <Avatar userId={v.otherId} size="sm" />
        <Text size="sm" weight="medium" tight style={[styles.grow, v.line.hot ? { color: tones.info.fg } : null]}>
          {v.line.text}
        </Text>
        {v.due && (
          <Text size="xs" color="textTertiary">
            {v.due}
          </Text>
        )}
      </View>
      <Text size="sm" selectable>
        {v.ask}
      </Text>
      {v.note && (
        <Text size="sm" color="textSecondary">
          {v.note}
        </Text>
      )}
      {v.lines.map((l, i) => (
        <Text key={i} size="xs" color={LINE_COLOR[l.tone]}>
          {l.text}
        </Text>
      ))}
      {v.warn && (
        <View style={styles.warn}>
          <Text size="sm" color="warning" style={styles.grow}>
            {v.warn.text}
          </Text>
          {v.warn.remind && <Button size="sm" label={t('ho.remind')} disabled={busy} onPress={() => void run('remind')} testID="ho-remind" />}
        </View>
      )}
      {v.actions.length > 0 && (
        <View style={styles.actions}>
          {v.actions.map((a) => (
            <Button key={a} size="sm" variant={PRIMARY_ACTIONS.has(a) ? 'primary' : 'secondary'} label={t(ACTION_LABEL[a])} disabled={busy} onPress={() => press(a)} testID={`ho-${a}`} />
          ))}
        </View>
      )}
      {form && (
        <View style={styles.form}>
          <TextField multiline value={note} onChangeText={setNote} placeholder={t(form === 'ask' ? 'ho.notePh' : 'ho.reopenPh')} editable={!busy} testID="ho-note" style={styles.note} />
          <Button
            size="sm"
            label={t(form === 'ask' ? 'ho.sendQuestion' : 'ho.sendBack')}
            disabled={busy || !canSendNote(form, note)}
            onPress={() => void run(form, noteValue(note))}
            testID="ho-note-send"
            style={styles.end}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space[2], borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: space[3], backgroundColor: colors.bg },
  hot: { borderColor: tones.info.fg, backgroundColor: tones.info.bg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  grow: { flex: 1 },
  warn: { flexDirection: 'row', alignItems: 'center', gap: space[2], backgroundColor: tones.warning.bg, borderRadius: radius.md, padding: space[2] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  form: { gap: space[2] },
  note: { minHeight: 64 },
  end: { alignSelf: 'flex-end' },
});
