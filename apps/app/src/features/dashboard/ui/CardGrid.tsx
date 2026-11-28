import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { cardsFor, SEP, type CardId, type Id, type IsoTime } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { Pill, Text } from '@/components/ui';
import { useApp } from '@/state';
import { colors, radius, space, useLayout } from '@/theme';
import { gridRows, refreshCardPayload, removeCardPayload } from '../model/cards';

/**
 * One dashboard card: title, what it is built from, when it was refreshed, the rule mark, and
 * remove / refresh. `home` only changes the "built from" wording.
 */
export function DashCard({ id, scope, home, stamp, children }: { id: CardId; scope: Id; home?: boolean; stamp: IsoTime; children: ReactNode }) {
  const { live, me, t, fmtClock, submit } = useApp();
  const refresh = () => void submit('dashboard.set', refreshCardPayload(cardsFor(live, me, scope), scope, id, new Date().toISOString()));
  const remove = () => void submit('dashboard.set', removeCardPayload(cardsFor(live, me, scope), scope, id));
  const { phone } = useLayout();
  const meta = (
    <Text size="xs" color="textTertiary" tight numberOfLines={1} style={{ flexShrink: 1 }}>
      {`${t(home ? 'db.byHome' : 'db.by')}${SEP}${t('db.updated', { t: fmtClock(stamp) })}`}
    </Text>
  );
  return (
    <View style={styles.card} testID={`card-${id}`}>
      <View style={styles.head}>
        <Text size="sm" weight="semibold" tight numberOfLines={1} style={{ flexShrink: 0, maxWidth: '60%' }}>
          {t(`w.${id}` as MessageKey)}
        </Text>
        <View style={{ flex: 1 }} />
        {phone ? null : meta}
        <Pill tone="ai" label={t('app.rules')} />
        <Act label="×" a11y={t('db.remove')} onPress={remove} testID="card-remove" />
        <Act label={t('db.refresh')} onPress={refresh} testID="card-refresh" />
      </View>
      {phone ? <View style={{ marginTop: -space[2] }}>{meta}</View> : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

function Act({ label, a11y, onPress, testID }: { label: string; a11y?: string; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={a11y ?? label} hitSlop={8} onPress={onPress} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.act, hovered && { backgroundColor: colors.hover }]}>
      <Text size="xs" color="textSecondary" tight>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The cards of a scope in rows for the container's own width: two columns on a wide container
 * (wide cards span both), one below. `db.empty` when the set is empty.
 */
export function CardGrid({ cards, render }: { cards: CardId[]; render: (id: CardId) => ReactNode }) {
  const { t } = useApp();
  const [width, setWidth] = useState(0);
  if (cards.length === 0)
    return (
      <Text size="sm" color="textSecondary">
        {t('db.empty')}
      </Text>
    );
  return (
    <View style={styles.grid} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0
        ? gridRows(cards, width).map((row) => (
            <View key={row.key} style={styles.row}>
              {row.cards.map((id) => (
                <View key={id} style={styles.cell}>
                  {render(id)}
                </View>
              ))}
              {!row.wide && row.cards.length === 1 ? <View style={styles.cell} /> : null}
            </View>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingTop: space[3], paddingHorizontal: space[4], paddingBottom: space[4], gap: space[3], backgroundColor: colors.bg, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  act: { paddingHorizontal: space[1], borderRadius: radius.sm, minHeight: 20, justifyContent: 'center' },
  body: { gap: space[2], minWidth: 0 },
  grid: { gap: space[4] },
  row: { flexDirection: 'row', gap: space[4], alignItems: 'flex-start' },
  cell: { flex: 1, minWidth: 0 },
});
