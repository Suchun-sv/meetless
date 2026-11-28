import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable } from 'react-native';
import { Icon } from './icons';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { Id } from '@meetless/core';
import { Button, Pill, Text } from '@/components/ui';
import { useApp } from '@/state';
import { colors, radius, space } from '@/theme';
import { threadItems } from '../model/reply';
import { ReplyView } from './ReplyView';

/**
 * The private thread for `scope`: one user's own history with the agent, nobody else sees it.
 * Scrolls to the newest message when one arrives. 「清空」 clears it (`chat.cleared`); 「收起」
 * (dock only) folds it back to one line.
 */
export function Thread({ scope, pending, onDash, style, extra, onCollapse, bare, after }: { scope: 'home' | Id; pending: string | null; onDash: boolean; style?: StyleProp<ViewStyle>; extra?: ReactNode; onCollapse?: () => void; bare?: boolean; after?: ReactNode }) {
  const { t, live, me, today, fmtDay, fmtClock, submit } = useApp();
  const [note, setNote] = useState<string | null>(null);
  const items = threadItems({ t, live, me, today, fmtDay, scope, onDash });
  const ref = useRef<ScrollView | null>(null);
  useEffect(() => {
    const id = setTimeout(() => ref.current?.scrollToEnd({ animated: false }), 0);
    return () => clearTimeout(id);
  }, [items.length, scope, pending]);
  return (
    <View style={[bare ? styles.bare : styles.thread, style]} testID="thread">
      {!bare && (
      <View style={styles.head}>
        <Text size="sm" weight="semibold" tight style={styles.grow}>
          {scope === 'home' ? t('ch.homeAgent') : t('ch.agent')}
        </Text>
        {extra}
        <Button variant="ghost" size="sm" label={t('dock.clear')} testID="thread-clear" onPress={() => void submit('chat.cleared', { scope })} />
        {onCollapse && <Button variant="ghost" size="sm" label={t('ch.close')} testID="thread-close" onPress={onCollapse} />}
      </View>
      )}
      <ScrollView ref={ref} style={styles.body} contentContainerStyle={[styles.bodyIn, bare && styles.bodyBare]} keyboardShouldPersistTaps="handled">
        {items.map((m) => (
          <View key={m.id} style={styles.msg}>
            <View style={styles.user}>
              <Text size="sm" selectable>
                {m.question}
              </Text>
            </View>
            <View style={styles.answer} testID="msg-a">
              <ReplyView blocks={m.blocks} citeRows={bare} />
              {bare ? (
                <Pressable accessibilityRole="button" onPress={() => setNote((v) => (v === m.id ? null : m.id))} style={styles.basis} testID="answer-basis">
                  <Icon name="info" size={13} />
                  <Text size="xs" color="textTertiary" style={styles.grow}>
                    {note === m.id ? `${m.label}  ${m.note}` : t('dock.basis', { t: fmtClock(m.at) })}
                  </Text>
                </Pressable>
              ) : (
              <View style={styles.label}>
                <Pill tone="ai" label={m.label} />
                <Text size="xs" color="textTertiary" style={styles.grow}>
                  {m.note}
                </Text>
              </View>
              )}
            </View>
          </View>
        ))}
        {pending !== null && (
          <View style={styles.msg} testID="ai-pending">
            <View style={styles.user}>
              <Text size="sm">{pending}</Text>
            </View>
            <Text size="sm" color="ai">
              {t('ch.pending')}
            </Text>
          </View>
        )}
        {after}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bare: { flex: 1 },
  bodyBare: { paddingHorizontal: 0, gap: 18 },
  basis: { flexDirection: 'row', alignItems: 'center', gap: space[1] + 2, marginTop: space[1] },
  thread: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.bg, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingLeft: space[3], paddingRight: space[1], paddingVertical: space[1], borderBottomWidth: 1, borderBottomColor: colors.border },
  grow: { flex: 1 },
  body: { flexGrow: 1 },
  bodyIn: { padding: space[3], gap: space[4] },
  msg: { gap: space[2] },
  user: { alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: space[3], paddingVertical: space[2] },
  answer: { gap: space[2] },
  label: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
});
