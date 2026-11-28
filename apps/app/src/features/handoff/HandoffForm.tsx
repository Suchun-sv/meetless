import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { currentOrLatestRound, noDots, type Id } from '@meetless/core';
import { Avatar, Button, Text, TextField } from '@/components/ui';
import { displayName, newId, useApp } from '@/state';
import { colors, radius, space } from '@/theme';
import { dueChoices, handoffPayload, handoffSheet, initialTo, type DueChoice } from './model/handoff';
import { LinkBox } from './LinkBox';

/**
 * The handoff form (交接弹窗): the need, who takes it (grouped by role), the ask, the due date and
 * what they receive; Send submits `handoff.created`. The owner changes only when they accept. A
 * private need must be shared first; an unknown need shows the missing text.
 */
export function HandoffForm({ projectId, needId, toId, onDone, onCancel }: { projectId: Id; needId: Id; toId?: Id | null; onDone: () => void; onCancel: () => void }) {
  const { t, me, live, today, fmtDay, submit } = useApp();
  const sheet = handoffSheet(live, projectId, needId, me);
  const groups = sheet.state === 'ok' ? sheet.groups : [];
  const [to, setTo] = useState<Id | null>(() => initialTo(groups, toId));
  const [ask, setAsk] = useState('');
  const [due, setDue] = useState<DueChoice['key']>('week');
  const [busy, setBusy] = useState(false);

  if (sheet.state !== 'ok') {
    return (
      <Text size="sm" color="textSecondary">
        {t(sheet.state === 'private' ? 'ho.privateFirst' : 'dr.missing')}
      </Text>
    );
  }
  const need = sheet.need;
  const choices = dueChoices(today, currentOrLatestRound(live, projectId));
  const chosen = choices.find((c) => c.key === due) ?? choices[0]!;

  const send = async () => {
    if (to === null || busy) return;
    setBusy(true);
    try {
      const r = await submit('handoff.created', handoffPayload({ handoffId: newId('h'), projectId, need, toId: to, ask, due: chosen.date }));
      if (r.kind === 'accepted' || r.kind === 'queued' || r.kind === 'duplicate') onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text size="sm" mono color="textTertiary">
          {need.code}
        </Text>
        <Text size="sm" style={styles.grow}>
          {noDots(need.title)}
        </Text>
      </View>
      <Text size="md" weight="semibold" tight>
        {t('ho.title')}
      </Text>
      {groups.length === 0 ? (
        <Text size="sm" color="textSecondary">
          {t('ho.nobody')}
        </Text>
      ) : (
        groups.map((g, gi) => (
          <View key={g.roleName ?? `norole-${gi}`} style={styles.group}>
            <Text size="xs" color="textTertiary">
              {g.roleName ? noDots(g.roleName) : t('ho.noRole')}
            </Text>
            <View style={styles.people}>
              {g.memberIds.map((id) => {
                const on = to === id;
                return (
                  <Pressable
                    key={id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    testID="ho-person"
                    onPress={() => setTo(id)}
                    style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.person, on && styles.personOn, (pressed || hovered) && !on && styles.hover]}
                  >
                    <Avatar userId={id} size="sm" />
                    <Text size="sm" numberOfLines={1} style={styles.shrink}>
                      {noDots(displayName(live, id))}
                    </Text>
                    {on && <Text size="sm">{'✓'}</Text>}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))
      )}
      <TextField multiline value={ask} onChangeText={setAsk} placeholder={t('ho.askPh')} style={styles.ask} testID="ho-ask-text" />
      <View style={styles.row}>
        <Text size="sm" color="textSecondary">
          {t('ho.due')}
        </Text>
        {choices.map((c) => (
          <Pressable key={c.key} testID="ho-due" onPress={() => setDue(c.key)} style={[styles.chip, due === c.key && styles.chipOn]}>
            <Text size="xs" color={due === c.key ? 'text' : 'textSecondary'} weight={due === c.key ? 'medium' : 'regular'}>
              {`${t(`ho.d.${c.key}`)} ${fmtDay(c.date)}`}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text size="md" weight="semibold" tight>
        {t('ho.preview')}
      </Text>
      <LinkBox projectId={projectId} needId={needId} />
      <View style={styles.foot}>
        <Button label={t('common.cancel')} onPress={onCancel} />
        <Button variant="primary" label={t('ho.send')} busy={busy} disabled={to === null} onPress={() => void send()} testID="ho-send" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[2] },
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
  group: { gap: space[1] },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  person: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: space[2], minWidth: 140, maxWidth: 240 },
  personOn: { borderColor: colors.focus, backgroundColor: colors.selected },
  hover: { backgroundColor: colors.hover },
  ask: { minHeight: 64 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: space[3], paddingVertical: space[1] },
  chipOn: { borderColor: colors.focus, backgroundColor: colors.selected },
  foot: { flexDirection: 'row', justifyContent: 'flex-end', gap: space[2] },
});
