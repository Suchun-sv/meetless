import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { Id, RoundStatus } from '@meetless/core';
import { Button, Pill, Segmented, Text } from '@/components/ui';
import { useApp, useProject, useProjectId } from '@/state';
import { colors, radius, space, tones, useLayout } from '@/theme';
import { useOpenTarget } from '../chat/ui/nav';
import { NeedChip, NeedStatusText } from '../chat/ui/NeedChip';
import { FLOW_FILTERS, isOpen, itemRows, needLineageView, scrollForToday, setOpen, type FlowFilter, type FlowNode, type SceneCard } from './model/lineage';

const DDL_COLOR: Record<RoundStatus, string> = { current: colors.danger, planned: colors.danger, delivered: colors.textTertiary };

/** What a source produced, as rows: needs with their derived needs nested, revisions, decisions, actions, and items still to confirm. */
function Items({ projectId, node }: { projectId: Id; node: FlowNode }) {
  const { t, live } = useApp();
  const open = useOpenTarget();
  return (
    <View style={styles.items}>
      {itemRows(t, live, projectId, node.items).map((r) => {
        switch (r.kind) {
          case 'need':
            return (
              <View key={r.key} style={[styles.itemRow, { paddingLeft: r.depth * space[4] }]}>
                {r.derived && (
                  <Text size="xs" color="textTertiary">
                    {t('lin.derived')}
                  </Text>
                )}
                <NeedChip projectId={projectId} needId={r.needId} />
                <NeedStatusText status={r.status} />
              </View>
            );
          case 'rev':
          case 'decision':
            return (
              <View key={r.key} style={styles.itemRow}>
                <Text size="xs" color="textTertiary">
                  {r.label}
                </Text>
                <NeedChip projectId={projectId} needId={r.needId} />
                <Text size="sm" style={styles.shrink}>
                  {r.text}
                </Text>
              </View>
            );
          case 'action':
            return (
              <View key={r.key} style={styles.itemRow}>
                <Text size="xs" color="textTertiary">
                  {r.label}
                </Text>
                <Text size="sm" style={styles.shrink}>
                  {r.text}
                </Text>
              </View>
            );
          case 'pending':
            return (
              <Pressable key={r.key} accessibilityRole="button" onPress={() => open(r.target)} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.itemRow, hovered && styles.hover]}>
                <Text size="xs" color="textTertiary">
                  {r.label}
                </Text>
                <Text size="sm" style={styles.shrink}>
                  {r.text}
                </Text>
                <Text size="xs" color="warning">
                  {r.status}
                </Text>
              </Pressable>
            );
        }
      })}
    </View>
  );
}

/** A source card: always shown; what it produced folds open, its original text behind 「原文」. */
function Card({ projectId, node, card }: { projectId: Id; node: FlowNode; card: SceneCard }) {
  const { t } = useApp();
  const [open, setOpenState] = useState(() => isOpen(projectId, card.key));
  const [orig, setOrig] = useState(false);
  const toggle = () => {
    setOpen(projectId, card.key, !open);
    setOpenState(!open);
  };
  return (
    <View style={[styles.card, open && styles.cardOpen]} testID="lin-node">
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={toggle} style={styles.cardHead}>
        <View style={styles.cardTop}>
          <Pill tone={card.typeTone} label={card.typeLabel} />
          {card.aiPill && <Pill tone="ai" label={t('ai.deepseek')} />}
          {card.title ? (
            <Text size="sm" weight="semibold" tight style={styles.shrink} numberOfLines={2}>
              {card.title}
            </Text>
          ) : null}
        </View>
        {card.gist && (
          <Text size="sm" color="textSecondary" numberOfLines={open ? undefined : 2}>
            {card.gist}
          </Text>
        )}
        <Text size="xs" color="textTertiary" numberOfLines={1}>
          {card.meta}
          {!open && card.count > 0 && card.preview ? `  ${card.preview}` : ''}
        </Text>
      </Pressable>
      {open && (
        <View style={styles.cardBody}>
          {card.count > 0 && <Items projectId={projectId} node={node} />}
          <Button variant="link" size="sm" label={t('lin.original')} onPress={() => setOrig((v) => !v)} testID="lin-orig" style={styles.start} />
          {orig && (
            <View style={styles.orig} testID="lin-original">
              {card.original.length ? (
                card.original.map((p, i) => (
                  <Text key={i} size="sm" selectable>
                    {p}
                  </Text>
                ))
              ) : (
                <Text size="sm" color="textTertiary">
                  {t('common.none')}
                </Text>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * 脉络: where needs came from, as one vertical line, oldest at the top, opened at today. Each source
 * is a card on the line with its date on the left; DDLs are diamonds on the line; today is a
 * labelled rule across it. A type filter on top; on a need's route, 「只看」 narrows to its family.
 */
export function LineageScreen() {
  const { t, live, today, fmtDay } = useApp();
  const projectId = useProjectId();
  const project = useProject();
  const { phone, height } = useLayout();
  const { needId: rawNeed } = useLocalSearchParams<{ needId?: string }>();
  const need = rawNeed ? live.needs[String(rawNeed)] : undefined;
  const [filter, setFilter] = useState<FlowFilter>('all');
  const openEvent = useOpenTarget();
  const [only, setOnly] = useState(true);
  const scroll = useRef<ScrollView | null>(null);
  const todayY = useRef<number | null>(null);
  const listY = useRef(0);
  const placed = useRef(false);
  const [view, setView] = useState({ y: 0, h: 0 });

  if (!project) return <Text color="textSecondary">{t('xp.notFound')}</Text>;

  const pad = phone ? space[4] : space[8];
  const focus = need && need.projectId === projectId && only ? need.id : null;
  const lv = needLineageView(t, live, projectId, filter, today, fmtDay, focus);
  const todayAt = () => (todayY.current === null ? null : pad + listY.current + todayY.current);
  const toToday = (animated: boolean) => {
    const y = todayAt();
    if (y !== null) scroll.current?.scrollTo({ y: scrollForToday(y, view.h || height), animated });
  };
  // The today row's y is within the list; the list's within the column, which sits after the padding.
  const onToday = (e: LayoutChangeEvent) => {
    todayY.current = e.nativeEvent.layout.y;
    if (!placed.current) {
      placed.current = true;
      setTimeout(() => toToday(false), 50);
    }
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setView({ y: e.nativeEvent.contentOffset.y, h: e.nativeEvent.layoutMeasurement.height });
  const ty = todayAt();
  const away = ty !== null && view.h > 0 && (ty < view.y || ty > view.y + view.h);
  const dateW = phone ? 64 : 96;

  return (
    <View style={styles.root}>
      <ScrollView ref={scroll} onScroll={onScroll} scrollEventThrottle={64} onLayout={(e) => setView((v) => ({ ...v, h: e.nativeEvent.layout.height }))} contentContainerStyle={[styles.content, { padding: pad }]}>
        <View style={styles.column}>
          <View style={styles.top}>
            <Text size="xl" weight="semibold" tight>
              {t('lin.title')}
            </Text>
            {need && need.projectId === projectId && (
              <Segmented
                size="sm"
                value={only ? 'need' : 'all'}
                onChange={(v) => setOnly(v === 'need')}
                options={[
                  { value: 'need', label: t('lnv.need', { code: need.code }) },
                  { value: 'all', label: t('lnv.all') },
                ]}
              />
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Segmented size="sm" value={filter} onChange={setFilter} options={FLOW_FILTERS.map((f) => ({ value: f, label: t(`lin.f.${f}`) }))} />
            </ScrollView>
          </View>
          {lv.empty && (
            <Text size="sm" color="textSecondary">
              {t('lin.none')}
            </Text>
          )}
          <View testID="lineage" onLayout={(e) => (listY.current = e.nativeEvent.layout.y)}>
            {lv.rows.map((r) => {
              if (r.kind === 'today') {
                return (
                  <View key={r.key} style={styles.line} onLayout={onToday} testID="lin-today">
                    <Text size="xs" weight="semibold" style={[styles.date, { width: dateW, color: tones.info.fg }]}>
                      {r.label}
                    </Text>
                    <View style={styles.todayRule} />
                  </View>
                );
              }
              if (r.kind === 'event') {
                // The need's own history on its 脉络: a handoff and its answers, reported work, a revision.
                return (
                  <View key={r.key} style={styles.line} testID="lin-event">
                    <Text size="xs" color="textTertiary" style={[styles.date, { width: dateW }]}>
                      {r.date}
                    </Text>
                    <View style={styles.rail}>
                      <View style={styles.tick} />
                    </View>
                    <Pressable style={styles.eventText} onPress={() => openEvent(r.target)}>
                      <Text size="sm" color="textSecondary">
                        {r.text}
                      </Text>
                    </Pressable>
                  </View>
                );
              }
              if (r.kind === 'ddl') {
                return (
                  <View key={r.key} style={styles.line} testID="lin-ddl">
                    <Text size="xs" color="textTertiary" style={[styles.date, { width: dateW }]}>
                      {r.date}
                    </Text>
                    <View style={styles.rail}>
                      <View style={styles.tick} />
                      <View style={[styles.diamond, { backgroundColor: DDL_COLOR[r.status], opacity: r.status === 'planned' ? 0.45 : 1 }]} />
                    </View>
                    <Text size="sm" weight="semibold" style={styles.ddlText}>
                      {r.text}
                    </Text>
                  </View>
                );
              }
              return (
                <View key={r.key} style={styles.line}>
                  <Text size="xs" color="textTertiary" style={[styles.date, { width: dateW }]}>
                    {r.date}
                  </Text>
                  <View style={styles.rail}>
                    <View style={styles.tick} />
                  </View>
                  <View style={styles.cardCol}>
                    <Card projectId={projectId} node={r.node} card={r.card} />
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
      {away && (
        <View style={styles.backWrap} pointerEvents="box-none">
          <Button size="sm" label={t('lin.backToday')} onPress={() => toToday(true)} testID="lin-back" />
        </View>
      )}
    </View>
  );
}

const RAIL = 20;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1 },
  column: { width: '100%', maxWidth: 920, alignSelf: 'center', gap: space[4] },
  top: { gap: space[3] },
  line: { flexDirection: 'row', alignItems: 'stretch', minHeight: 32 },
  date: { paddingTop: space[3], paddingRight: space[2], textAlign: 'right' },
  rail: { width: RAIL, alignItems: 'center', borderLeftWidth: 0, position: 'relative' },
  tick: { position: 'absolute', top: 0, bottom: 0, left: RAIL / 2 - 1, width: 2, backgroundColor: colors.border },
  diamond: { marginTop: space[3] + 2, width: 9, height: 9, transform: [{ rotate: '45deg' }] },
  eventText: { flex: 1, paddingTop: space[2], paddingBottom: space[2] },
  ddlText: { flex: 1, paddingTop: space[2], paddingBottom: space[2] },
  todayRule: { flex: 1, height: 2, marginTop: space[3] + 6, backgroundColor: tones.info.fg, opacity: 0.6 },
  cardCol: { flex: 1, paddingVertical: space[2] },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.bg },
  cardOpen: { borderColor: colors.borderStrong },
  cardHead: { padding: space[3], gap: space[1] },
  cardTop: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[2] },
  cardBody: { paddingHorizontal: space[3], paddingBottom: space[3], gap: space[2] },
  items: { gap: space[2] },
  itemRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[2], borderRadius: radius.sm },
  hover: { backgroundColor: colors.hover },
  shrink: { flexShrink: 1 },
  start: { alignSelf: 'flex-start' },
  orig: { gap: space[2], backgroundColor: colors.surface, borderRadius: radius.md, padding: space[3] },
  backWrap: { position: 'absolute', bottom: space[4], left: 0, right: 0, alignItems: 'center' },
});
