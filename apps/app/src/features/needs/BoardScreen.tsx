/**
 * 需求 board: kind and DDL filters, then one column per DDL (or per status when the project has
 * no DDLs). Phones show one column at a time behind tabs; wide containers lay the columns side
 * by side, with the selected need's detail in a side pane.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Button, Segmented, Text } from '@/components/ui';
import { useApp, useGo } from '@/state';
import { colors, layout, space, useLayout } from '@/theme';
import { NeedsMobile } from './mobile/NeedsMobile';
import type { Id } from '@meetless/core';
import { boardLayout, boardViewFor, boardVM, KIND_FILTERS, leftKey, type BoardView, type ColumnVM } from './model/board';
import { NeedCard } from './NeedCard';
import { NeedDetail } from './NeedDetail';
import { NewNeedSheet } from './NewNeedSheet';
import { ProjectTimeline } from '../timeline/ui/ProjectTimeline';
import { LineageScreen } from '../lineage/LineageScreen';
import { Chip, Row } from './ui/kit';

const KIND_KEY = { all: 'filter.all', ext: 'filter.ext', hyp: 'filter.hyp' } as const;

/** Board view state per project, kept while the app runs (the route remounts on every need opened). */
const viewMemo = new Map<Id, BoardView>();

function useBoardView(projectId: Id): [BoardView, (p: Partial<BoardView>) => void] {
  const [v, setV] = useState<BoardView>(() => viewMemo.get(projectId) ?? boardViewFor({ projectId: null, mode: 'rounds', kind: null, round: null }, projectId));
  const view = boardViewFor(v, projectId);
  const set = (p: Partial<BoardView>) => {
    const next = { ...view, ...p };
    viewMemo.set(projectId, next);
    setV(next);
  };
  return [view, set];
}

function ColumnHead({ col }: { col: ColumnVM }) {
  const { t, fmtDay } = useApp();
  const h = col.head;
  if (h.kind === 'status') return <Text weight="semibold" tight>{t(`col.${h.status}`)}</Text>;
  if (h.kind === 'unscheduled') return <Text weight="semibold" tight>{t('col.unscheduled')}</Text>;
  const left = h.daysLeft === null ? null : leftKey(h.daysLeft);
  return (
    <View style={{ gap: 2 }}>
      <Text weight="semibold" tight numberOfLines={2}>
        {h.title ?? t('round', { n: h.n })}
      </Text>
      <Row wrap>
        <Text size="xs" color="textSecondary" tight>
          {fmtDay(h.due) + (h.delivered ? ` ${t('round.delivered')}` : '')}
        </Text>
        {left && 'n' in left ? (
          <Text size="xs" tight color={left.key === 'round.over' ? 'danger' : h.current ? 'info' : 'textSecondary'}>
            {t(left.key, { n: left.n })}
          </Text>
        ) : null}
      </Row>
    </View>
  );
}

function ColumnBody({ col, selected, open }: { col: ColumnVM; selected: Id | null; open: (id: Id) => void }) {
  const { t } = useApp();
  const [showRefuted, setShowRefuted] = useState(false);
  return (
    <View style={{ gap: space[2] }}>
      {col.cards.length === 0 && col.refuted.length === 0 ? (
        <Text size="sm" color="textTertiary">
          {t('col.empty')}
        </Text>
      ) : null}
      {col.cards.map((c) => (
        <NeedCard key={c.id} c={c} selected={c.id === selected} onPress={() => open(c.id)} />
      ))}
      {col.refuted.length > 0 ? (
        <>
          <Pressable accessibilityRole="button" onPress={() => setShowRefuted((x) => !x)} hitSlop={6}>
            <Text size="xs" color="textSecondary" weight="medium">
              {t('col.refuted', { n: col.refuted.length })}
            </Text>
          </Pressable>
          {showRefuted ? col.refuted.map((c) => <NeedCard key={c.id} c={c} selected={c.id === selected} onPress={() => open(c.id)} />) : null}
        </>
      ) : null}
    </View>
  );
}

export function BoardScreen({ projectId, selectedNeedId = null }: { projectId: Id; selectedNeedId?: Id | null }) {
  const { phone } = useLayout();
  if (phone) return <NeedsMobile projectId={projectId} />;
  return <BoardWide projectId={projectId} selectedNeedId={selectedNeedId} />;
}

function BoardWide({ projectId, selectedNeedId = null }: { projectId: Id; selectedNeedId?: Id | null }) {
  const { live, me, today, t } = useApp();
  const go = useGo();
  const [view, setView] = useBoardView(projectId);
  const [width, setWidth] = useState(0);
  const [tab, setTab] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const vm = useMemo(() => boardVM(live, me, projectId, { kind: view.kind, round: view.round }, today), [live, me, projectId, view.kind, view.round, today]);

  const pane = selectedNeedId !== null && width >= 1000;
  const boardWidth = pane ? width - layout.drawer : width;
  const lay = boardLayout(boardWidth);
  const open = (needId: Id) => go({ view: 'board', projectId, needId }, { replace: selectedNeedId !== null });
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  const tabKey = tab && vm.columns.some((c) => c.key === tab) ? tab : (vm.columns[vm.initialIndex]?.key ?? null);
  const kindValue = view.kind ?? 'all';

  const bar = (
    <View style={styles.bar}>
      <Row wrap>
        <Segmented
          size="sm"
          value={view.mode}
          accessibilityLabel="board-mode"
          options={(['rounds', 'lineage'] as const).map((m) => ({ value: m, label: t(`view.${m}`) }))}
          onChange={(m) => setView({ mode: m })}
        />
        {view.mode === 'rounds' ? <Segmented
          size="sm"
          value={kindValue}
          options={KIND_FILTERS.map((k) => ({ value: k ?? 'all', label: t(KIND_KEY[k ?? 'all']) }))}
          onChange={(v) => setView({ kind: v === 'all' ? null : (v as 'ext' | 'hyp') })}
        /> : null}
        <View style={{ flex: 1 }} />
        <Button testID="board-new" size="sm" label={t('board.new')} onPress={() => setNewOpen(true)} />
      </Row>
      {view.mode === 'rounds' && vm.rounds.length > 0 ? <ProjectTimeline projectId={projectId} selected={view.round} onSelect={(n) => setView({ round: n })} /> : null}
      {view.mode === 'rounds' && view.round !== null ? (
        <Row>
          <Chip testID="board-round-clear" on label={`${t('round', { n: view.round })} ×`} onPress={() => setView({ round: null })} />
        </Row>
      ) : null}
      {view.mode === 'rounds' && vm.noRounds ? (
        <Text size="sm" color="textTertiary">
          {t('board.noRounds')}
        </Text>
      ) : null}
    </View>
  );

  let body = null;
  if (view.mode === 'lineage') {
    body = <LineageScreen />;
  } else if (width > 0 && lay.mode === 'pager') {
    const col = vm.columns.find((c) => c.key === tabKey) ?? vm.columns[0];
    body = (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.pagerBody}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {vm.columns.map((c) => (
            <Chip
              key={c.key}
              testID="board-tab"
              label={c.head.kind === 'round' ? t('round', { n: c.head.n }) : c.head.kind === 'status' ? t(`col.${c.head.status}`) : t('col.unscheduled')}
              on={c.key === col?.key}
              onPress={() => setTab(c.key)}
            />
          ))}
        </ScrollView>
        {col ? (
          <>
            <ColumnHead col={col} />
            <ColumnBody col={col} selected={selectedNeedId} open={open} />
          </>
        ) : null}
      </ScrollView>
    );
  } else if (width > 0) {
    body = (
      <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={styles.cols}>
        {vm.columns.map((c) => (
          <View key={c.key} testID="board-col" style={[styles.col, { width: lay.colWidth }, c.head.kind === 'round' && c.head.current && styles.colCurrent]}>
            <ColumnHead col={c} />
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: space[6] }}>
              <ColumnBody col={c} selected={selectedNeedId} open={open} />
            </ScrollView>
          </View>
        ))}
      </ScrollView>
    );
  }

  return (
    <View style={styles.root} onLayout={onLayout} testID="page-board">
      <View style={{ flex: 1, minWidth: 0 }}>
        {bar}
        {body}
      </View>
      {pane && selectedNeedId ? (
        <View style={styles.pane}>
          <NeedDetail projectId={projectId} needId={selectedNeedId} onClose={() => go({ view: 'board', projectId }, { replace: true })} />
        </View>
      ) : null}
      <NewNeedSheet open={newOpen} projectId={projectId} onClose={() => setNewOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  bar: { paddingHorizontal: space[4], paddingTop: space[4], paddingBottom: space[2], gap: space[2] },
  chips: { gap: space[2], alignItems: 'center' },
  pagerBody: { paddingHorizontal: space[4], paddingBottom: space[8], gap: space[3] },
  cols: { paddingHorizontal: space[4], paddingBottom: space[2], gap: space[3], alignItems: 'stretch' },
  col: { gap: space[3], backgroundColor: colors.sidebar, borderRadius: 8, padding: space[3] },
  colCurrent: { borderWidth: 1, borderColor: colors.borderStrong },
  pane: { width: layout.drawer, borderLeftWidth: 1, borderLeftColor: colors.border },
});
