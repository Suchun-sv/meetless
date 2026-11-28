import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Text } from '@/components/ui';
import { useApp } from '@/state';
import { colors, radius, space } from '@/theme';
import { acceptAllCommands } from '../model/accept';
import { importCommand, importResult, runCommands } from '../model/chat';
import type { ReplyAction, ReplyBlock } from '../model/reply';
import { useOpenTarget } from './nav';
import { Markdown } from '../md/Markdown';
import { NeedChip, NeedStatusText } from './NeedChip';

/** Runs a reply's tap: open somewhere, accept all, import the message, or ask to refresh. */
export function useReplyAction(): (a: ReplyAction) => Promise<void> {
  const { live, today, submit, api, notify, errorText } = useApp();
  const open = useOpenTarget();
  return async (a) => {
    switch (a.kind) {
      case 'open':
        open(a.target);
        return;
      case 'acceptAll':
        await runCommands(acceptAllCommands(live, a.inputId, today), submit);
        return;
      case 'remind':
        await submit('handoff.refresh_requested', { handoffId: a.handoffId });
        return;
      case 'import': {
        const req = importCommand({ projectId: a.projectId, messageId: a.messageId, text: a.text, priv: a.priv, today });
        const res = await api('inputs.import', req).catch(() => null);
        if (!res) return notify('error', errorText('NETWORK'));
        const out = importResult(res, a.projectId, req.inputId);
        if ('open' in out) open(out.open);
        else notify('error', errorText(out.code));
        return;
      }
    }
  };
}

function LinkRow({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return <Button variant="link" size="sm" label={label} onPress={onPress} testID={testID} style={styles.link} />;
}

/** The blocks of one reply, in order. */
/** `citeRows`: cited needs as 「N5  title」 rows (the phone Agent sheet), else as chips. */
export function ReplyView({ blocks, citeRows }: { blocks: readonly ReplyBlock[]; citeRows?: boolean }) {
  const { t, live } = useApp();
  const run = useReplyAction();
  const open = useOpenTarget();
  return (
    <View style={styles.wrap}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'text':
            // Model prose (DeepSeek) is Markdown; rule lines stay plain text.
            if (b.gen) return <Markdown key={i} text={b.text} size={15} />;
            return (
              <Text key={i} size={b.small ? 'sm' : 'base'} color={b.faint ? 'textTertiary' : 'text'} selectable>
                {b.text}
              </Text>
            );
          case 'needs':
            if (citeRows) {
              return (
                <View key={i} style={styles.rows}>
                  {b.needIds.map((id) => {
                    const n = live.needs[id];
                    if (!n) return null;
                    return (
                      <Pressable key={id} accessibilityRole="link" onPress={() => open({ kind: 'need', projectId: b.projectId, needId: id })} style={styles.citeRow}>
                        <Text size="sm" mono color="textTertiary" style={styles.citeCode}>
                          {n.code}
                        </Text>
                        <Text style={styles.shrink}>{n.title}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              );
            }
            return (
              <View key={i} style={styles.row}>
                {b.needIds.map((id) => (
                  <NeedChip key={id} projectId={b.projectId} needId={id} />
                ))}
              </View>
            );
          case 'hits':
            return (
              <View key={i} style={styles.group}>
                <NeedChip projectId={b.projectId} needId={b.needId} />
                {b.lines.map((l, j) => (
                  <Text key={j} size="sm" color="textSecondary">
                    {l}
                  </Text>
                ))}
              </View>
            );
          case 'material':
            return (
              <View key={i} style={styles.group}>
                <Pressable
                  accessibilityRole="link"
                  testID="material-chip"
                  onPress={() => open(b.target)}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.chip, (pressed || hovered) && styles.hover]}
                >
                  <Text size="xs" tight numberOfLines={1}>
                    {b.label}
                  </Text>
                </Pressable>
                <Text size="sm" color="textSecondary" numberOfLines={4}>
                  {b.text}
                </Text>
              </View>
            );
          case 'status':
            return (
              <View key={i} style={styles.row}>
                <NeedChip projectId={b.projectId} needId={b.needId} />
                <NeedStatusText status={b.status} />
              </View>
            );
          case 'action':
            return <LinkRow key={i} label={b.label} testID={b.testId} onPress={() => void run(b.action)} />;
          case 'actions':
            return (
              <View key={i} style={styles.row}>
                {b.items.map((x, j) => (
                  <LinkRow key={j} label={x.label} testID={x.testId} onPress={() => void run(x.action)} />
                ))}
              </View>
            );
          case 'stale':
            return (
              <View key={i} style={styles.row}>
                <Text size="sm" style={styles.shrink}>
                  {b.text}
                </Text>
                {b.reminded ? (
                  <Text size="sm" color="textTertiary">
                    {t('ho.reminded')}
                  </Text>
                ) : (
                  <LinkRow label={t('ho.remind')} onPress={() => void run({ kind: 'remind', handoffId: b.handoffId })} />
                )}
              </View>
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[2] },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] },
  group: { gap: space[1] },
  link: { alignSelf: 'flex-start' },
  shrink: { flexShrink: 1 },
  rows: { gap: space[1] },
  citeRow: { flexDirection: 'row', gap: space[2], paddingVertical: 4 },
  citeCode: { width: 30, paddingTop: 2 },
  chip: { alignSelf: 'flex-start', maxWidth: '100%', backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: space[2], paddingVertical: 2 },
  hover: { backgroundColor: colors.hover },
});
