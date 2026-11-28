import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { noDots } from '@meetless/core';
import type { Translator } from '@meetless/i18n';
import { Text } from '@/components/ui';
import { useApp } from '@/state';
import { colors, radius, space, tones } from '@/theme';
import { Icon, type IconName } from '../../chat/ui/icons';
import type { CardKind, InboxCard } from '../model/api';
import { sourceLabel } from '../model/source';

const ICON: Record<CardKind, IconName> = { text: 'pen', pdf: 'file', docx: 'file', image: 'image', mail: 'mail', chat: 'chat', proposal: 'sparkles' };

/** A project's colour bar on its chip: stable per project id, from the avatar palette. */
export function projectColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return colors.avatar[h % colors.avatar.length]!;
}

/** 「今天 10:20」「昨天 21:05」「2 分钟前」「刚刚」, else the day. */
export function when(t: Translator['t'], iso: string, fmtDay: (d: string) => string, fmtClock: (iso: string) => string): string {
  const ms = Date.now() - Date.parse(iso);
  if (ms < 60_000) return t('inb.justNow');
  if (ms < 60 * 60_000) return t('inb.minAgo', { n: Math.floor(ms / 60_000) });
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today.getTime() - 864e5);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (iso.length <= 10) return fmtDay(iso);
  if (same(d, today)) return t('inb.todayAt', { t: fmtClock(iso) });
  if (same(d, y)) return t('inb.yesterdayAt', { t: fmtClock(iso) });
  return fmtDay(iso.slice(0, 10));
}

/** What an analysis is doing now, as one line: 「正在读第 4 页，共 6 页」「正在找需求」…. */
export function stageText(t: Translator['t'], c: Pick<InboxCard, 'stage' | 'progress'>, projects: number): string {
  if (c.stage === 'reading' || !c.stage) return c.progress ? t('inb.st.page', { page: c.progress.page, pages: c.progress.pages }) : t('inb.st.reading');
  if (c.stage === 'routing') return t('inb.st.routing', { n: projects });
  return t(`inb.st.${c.stage}`);
}

/**
 * One material on B1: type icon (violet for an Agent proposal), title, source and time, then one
 * status line by state, the projects it goes to, and amber tags for duplicates and conflicts.
 * `highlight` is B5's green outline on the material just committed.
 */
export function MaterialCard({ c, onPress, onRetry, highlight }: { c: InboxCard; onPress?: () => void; onRetry?: () => void; highlight?: boolean }) {
  const { t, live, fmtDay, fmtClock } = useApp();
  const proposal = c.kind === 'proposal';
  const myProjects = Object.values(live.projects).length;
  const name = (id: string) => noDots(live.projects[id]?.name ?? id);
  const chips = c.status === 'committed' ? [] : c.projectIds;
  let status: React.ReactNode = null;
  switch (c.status) {
    case 'ready':
      status = (
        <Text size="sm" weight="medium" color="warning">
          {c.counts.projects > 1 ? t('inb.split', { n: c.counts.items, p: c.counts.projects }) : t('inb.items', { n: c.counts.items })}
        </Text>
      );
      break;
    case 'analyzing':
      status = (
        <View style={styles.row}>
          <ActivityIndicator size="small" color={colors.info} />
          <Text size="sm" weight="medium" color="info">
            {t('inb.analyzing', { what: stageText(t, c, myProjects) })}
          </Text>
        </View>
      );
      break;
    case 'committed':
      status = (
        <View style={styles.row}>
          <Icon name="check" size={16} color={colors.success} />
          <Text size="sm" weight="medium" color="success">
            {t('inb.put', { p: (c.committed?.projectIds ?? c.projectIds).map(name).join('、'), n: c.committed?.count ?? c.counts.items })}
          </Text>
        </View>
      );
      break;
    case 'empty':
      status = (
        <Text size="sm" color="textTertiary">
          {t('inb.none')}
        </Text>
      );
      break;
    case 'failed':
      status = (
        <View style={styles.row}>
          <Text size="sm" color="textTertiary">
            {t('inb.failed')}
          </Text>
          {onRetry && (
            <Pressable onPress={onRetry} hitSlop={8}>
              <Text size="sm" weight="medium" color="info">
                {t('inb.retry')}
              </Text>
            </Pressable>
          )}
        </View>
      );
      break;
  }
  const tags = [c.counts.duplicates ? t('inb.dup', { n: c.counts.duplicates }) : null, c.counts.conflicts ? t('inb.conflict', { n: c.counts.conflicts }) : null].filter(Boolean) as string[];
  return (
    <Pressable accessibilityRole="button" disabled={!onPress || c.status === 'empty'} onPress={onPress} style={({ pressed }: { pressed: boolean }) => [styles.card, highlight && styles.hl, pressed && styles.pressed]} testID="inbox-card">
      <View style={[styles.icon, proposal && styles.iconAi]}>
        <Icon name={ICON[c.kind]} size={20} color={proposal ? colors.ai : colors.textSecondary} />
      </View>
      <View style={styles.main}>
        <Text size="lg" weight="semibold" numberOfLines={1} tight>
          {noDots(c.title)}
        </Text>
        <Text size="sm" color="textTertiary" numberOfLines={1}>
          {`${sourceLabel(t, c.source)}　${when(t, c.addedAt, fmtDay, fmtClock)}`}
        </Text>
        <View style={styles.status}>{status}</View>
        {chips.length > 0 && (
          <View style={styles.chips}>
            {chips.map((id) => (
              <View key={id} style={styles.chip}>
                <View style={[styles.bar, { backgroundColor: projectColor(id) }]} />
                <Text size="sm" numberOfLines={1} style={styles.shrink}>
                  {name(id)}
                </Text>
              </View>
            ))}
          </View>
        )}
        {tags.length > 0 && (
          <View style={styles.chips}>
            {tags.map((x) => (
              <View key={x} style={styles.warn}>
                <Text size="sm" weight="medium" color="warning">
                  {x}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
      {c.status !== 'empty' && c.status !== 'failed' && (
        <View style={styles.chev}>
          <Icon name="right" size={18} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: 14, backgroundColor: colors.textInverse, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: space[3] + 2 },
  hl: { borderColor: colors.success, borderWidth: 1.5 },
  pressed: { backgroundColor: colors.hover },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  iconAi: { backgroundColor: colors.aiBg },
  main: { flex: 1, minWidth: 0, gap: 2 },
  status: { marginTop: space[1] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: space[2], paddingVertical: 3, maxWidth: '100%' },
  bar: { width: 3, height: 13, borderRadius: 2 },
  shrink: { flexShrink: 1 },
  warn: { backgroundColor: tones.warning.bg, borderRadius: radius.md, paddingHorizontal: space[2], paddingVertical: 3 },
  chev: { justifyContent: 'center' },
});
