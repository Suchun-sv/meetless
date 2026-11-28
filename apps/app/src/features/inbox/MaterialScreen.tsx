import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { daysBetween, noDots } from '@meetless/core';
import { urgencyTone } from '@/ui/urgency';
import { Text } from '@/components/ui';
import { MaterialCommitted, MaterialFailed, MaterialReview } from '@/features/inbox/review/MaterialReview';
import { useApp } from '@/state';
import { colors, radius, space, useLayout } from '@/theme';
import { Icon, type IconName } from '../chat/ui/icons';
import { commitMaterial, removeMaterial, retryMaterial, undoMaterial, type ApiFn, type InboxMaterial } from './model/api';
import { inboxChanged, useInboxWatchApi, useViewingMaterial, watchMaterial } from './model/watch';
import { showDoneToast } from './model/toast';
import { useMaterial } from './model/useInbox';
import { stageText } from './ui/MaterialCard';

const KIND_ICON: Record<InboxMaterial['kind'], IconName> = { text: 'pen', pdf: 'file', docx: 'file', image: 'image', mail: 'mail', chat: 'chat', proposal: 'sparkles' };
const TYPE_KEY = { need: 'inb.type.need', hyp: 'inb.type.hyp', rev: 'inb.type.rev' } as const;

/** A grey rounded bar standing in for content that has not arrived yet. */
function Skeleton({ width, height = 14 }: { width: number | `${number}%`; height?: number }) {
  return <View style={[styles.skel, { width, height }]} />;
}

/** The reading bar: a share of the pages, or a sliding segment when there are no pages (text, chat). */
function Progress({ share }: { share: number | null }) {
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (share !== null) return;
    const loop = Animated.loop(Animated.timing(x, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [share, x]);
  return (
    <View style={styles.track}>
      {share !== null ? (
        <View style={[styles.fill, { width: `${Math.round(share * 100)}%` }]} />
      ) : (
        <Animated.View style={[styles.fill, styles.slide, { left: x.interpolate({ inputRange: [0, 1], outputRange: ['-35%', '100%'] }) }]} />
      )}
    </View>
  );
}

const size = (b?: number) => (!b ? null : b > 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1000))} KB`);

/**
 * B2 分析中: the material card with its reading progress, then the parts as they arrive: 摘要 (with a
 * typing cursor), 截止 (date, days left, the source sentence), the items found so far followed by a
 * skeleton row, and 可能属于 (comparing with your projects). Leaving is fine; analysis goes on.
 */
function Analyzing({ m }: { m: InboxMaterial }) {
  const { t, live, me, today, fmtDay } = useApp();
  const projects = Object.values(live.projects).filter((p) => p.memberIds.includes(me)).length;
  const share = m.progress ? m.progress.page / Math.max(1, m.progress.pages) : null;
  const meta = [t(`inb.kind.${m.kind}`), m.pages ? t('inb.pages', { n: m.pages }) : null, size(m.sizeBytes)].filter(Boolean).join('　');
  const left = m.due ? daysBetween(today, m.due.date) : null;
  const leftColor = left === null ? colors.textSecondary : urgencyTone(left).fg;
  const slow = Date.now() - Date.parse(m.addedAt) > 60_000;
  const typing = m.stage === 'reading' || m.stage === 'extracting';
  return (
    <View style={styles.col}>
      <View style={styles.card}>
        <View style={styles.icon}>
          <Icon name={KIND_ICON[m.kind]} size={24} color={colors.textSecondary} />
        </View>
        <View style={styles.cardMain}>
          <Text size="lg" weight="semibold" numberOfLines={2} tight>
            {noDots(m.title)}
          </Text>
          {!!meta && (
            <Text size="sm" color="textTertiary">
              {meta}
            </Text>
          )}
          <Progress share={share} />
          <Text size="sm" color="info">
            {stageText(t, m, projects)}
          </Text>
        </View>
      </View>

      <View style={styles.block}>
        <Text size="sm" weight="medium" color="textTertiary">
          {t('inb.summary')}
        </Text>
        {m.summary ? (
          <Text size="lg" style={styles.summary}>
            {noDots(m.summary)}
            {typing ? <Text size="lg" color="text">{' |'}</Text> : null}
          </Text>
        ) : (
          <View style={styles.skelCol}>
            <Skeleton width="92%" />
            <Skeleton width="70%" />
          </View>
        )}
      </View>

      <View style={styles.block}>
        <Text size="sm" weight="medium" color="textTertiary">
          {t('inb.due')}
        </Text>
        {m.due ? (
          <>
            <View style={styles.dueRow}>
              <Text size="lg" weight="semibold">
                {fmtDay(m.due.date)}
              </Text>
              {left !== null && (
                <Text size="md" weight="medium" style={{ color: leftColor }}>
                  {left >= 0 ? t('round.left', { n: left }) : t('round.over', { n: -left })}
                </Text>
              )}
            </View>
            {m.due.quote && (
              <Text size="sm" color="textSecondary">
                {noDots(m.due.quote)}
              </Text>
            )}
          </>
        ) : (
          <Skeleton width="45%" height={18} />
        )}
      </View>

      <View style={styles.block}>
        <Text size="sm" weight="medium" color="textTertiary">
          {m.items.length ? t('inb.found', { n: m.items.length }) : t('inb.foundNone')}
        </Text>
        {m.items.map((it) => (
          <View key={it.id} style={styles.item} testID="b2-item">
            <View style={styles.type}>
              <Text size="xs" weight="medium" color="textSecondary">
                {t(TYPE_KEY[it.type] ?? 'inb.type.need')}
              </Text>
            </View>
            <Text size="md" style={styles.grow}>
              {noDots(it.text)}
            </Text>
          </View>
        ))}
        <View style={styles.item}>
          <Skeleton width={44} height={22} />
          <Skeleton width="60%" height={16} />
        </View>
      </View>

      <View style={styles.block}>
        <Text size="sm" weight="medium" color="textTertiary">
          {t('inb.maybe')}
        </Text>
        <View style={styles.dueRow}>
          <ActivityIndicator size="small" color={colors.info} />
          <Text size="md" color="textSecondary">
            {t('inb.st.routing', { n: projects })}
          </Text>
        </View>
      </View>

      <Text size="sm" color="textTertiary" style={styles.leave}>
        {slow ? t('inb.slow') : t('inb.leave')}
      </Text>
    </View>
  );
}

/**
 * /inbox/:materialId: B2 while the material is analysed, then in place (no extra tap) A2's review
 * (B3, B4, B6, B7), its failed view, or the read-only committed view. A commit returns to B1 with
 * B5's toast.
 */
export function MaterialScreen() {
  const { t, live, api } = useApp();
  const router = useRouter();
  const { phone } = useLayout();
  const { materialId } = useLocalSearchParams<{ materialId: string }>();
  const id = decodeURIComponent(String(materialId ?? ''));
  const { m, error, reload } = useMaterial(id);
  useInboxWatchApi();
  useViewingMaterial(id);
  const call = api as unknown as ApiFn;
  const [, tick] = useState(0);
  // Leaving while it is analysed is fine: it is followed in the background and announced when done.
  useEffect(() => {
    if (m?.status === 'analyzing') watchMaterial(id, m.title);
  }, [m?.status, m?.title, id]);
  useEffect(() => {
    if (m?.status !== 'analyzing') return;
    const t1 = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t1);
  }, [m?.status]);

  const committed = (r: { projectIds: string[]; created: number; merged: number; changedDue: number; revised?: number }) => {
    const name = (pid: string) => noDots(live.projects[pid]?.name ?? '');
    const n = r.created + r.merged + (r.revised ?? 0);
    const where = r.projectIds.length > 1 ? t('inb.toastProjects', { n, p: r.projectIds.length }) : t('inb.toastOne', { n, p: name(r.projectIds[0] ?? '') });
    const text = r.changedDue > 0 ? t('inb.toastDue', { what: where, d: r.changedDue }) : where;
    showDoneToast({ materialId: id, text, projectIds: r.projectIds });
    inboxChanged();
    if (router.canGoBack()) router.back();
    else router.replace('/inbox' as Href);
  };

  let body: React.ReactNode;
  if (!m) {
    body = error ? (
      <Text color="textSecondary">{t('inb.unavailable')}</Text>
    ) : (
      <View style={styles.center}>
        <ActivityIndicator color={colors.textTertiary} />
      </View>
    );
  } else if (m.status === 'analyzing') {
    body = <Analyzing m={m} />;
  } else if (m.status === 'ready') {
    body = (
      <MaterialReview
        material={m}
        commit={(mid, b) => commitMaterial(call, mid, b as unknown as Record<string, unknown>)}
        onCommitted={committed}
        onReanalyze={() => {
          void retryMaterial(call, id).then(() => {
            inboxChanged();
            reload();
          });
        }}
        onRemove={() => {
          void removeMaterial(call, id).then(() => {
            inboxChanged();
            if (router.canGoBack()) router.back();
            else router.replace('/inbox' as Href);
          });
        }}
      />
    );
  } else if (m.status === 'failed') {
    body = (
      <MaterialFailed
        material={m}
        retry={async (mid: string) => {
          const r = await retryMaterial(call, mid);
          reload();
          return r;
        }}
      />
    );
  } else if (m.status === 'committed') {
    body = (
      <MaterialCommitted
        material={m}
        undo={async (mid: string) => {
          const r = await undoMaterial(call, mid);
          reload();
          return r;
        }}
      />
    );
  } else {
    body = (
      <Text color="textSecondary" style={styles.none}>
        {t('inb.none')}
      </Text>
    );
  }
  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingHorizontal: phone ? space[4] : space[8] }]} testID="material">
      <View style={styles.column}>{body}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingTop: space[3], paddingBottom: 120 },
  column: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  col: { gap: space[5] },
  center: { paddingVertical: space[8], alignItems: 'center' },
  none: { paddingVertical: space[6] },
  card: { flexDirection: 'row', gap: space[4], backgroundColor: colors.textInverse, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: space[4] },
  icon: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  cardMain: { flex: 1, minWidth: 0, gap: space[1] },
  track: { height: 4, borderRadius: radius.full, backgroundColor: colors.surface, overflow: 'hidden', marginTop: space[2] },
  fill: { height: 4, borderRadius: radius.full, backgroundColor: colors.info },
  slide: { position: 'absolute', top: 0, width: '35%' },
  block: { gap: space[2] },
  summary: { lineHeight: 28 },
  skelCol: { gap: space[2] },
  skel: { backgroundColor: colors.surface, borderRadius: radius.full },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  item: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2], borderBottomWidth: 1, borderBottomColor: colors.border },
  type: { backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: space[2], paddingVertical: 2 },
  grow: { flex: 1 },
  leave: { textAlign: 'center', marginTop: space[4] },
});
