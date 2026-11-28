import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useIsFocused, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import type { Id } from '@meetless/core';
import { Text } from '@/components/ui';
import { routePath, useApp, useProject, useProjectId } from '@/state';
import { colors, radius, space, useLayout } from '@/theme';
import { useOpenTarget } from '../chat/ui/nav';
import { Icon } from '../chat/ui/icons';
import { LineageScreen } from './LineageScreen';
import { trailScenes, type TrailScene } from './model/trail';
import { NeedTrailSheet } from './NeedTrail';

/** One scene on the line: icon gutter with the 1px rail, kind and date, title with › or ⌃, summary, outputs, and the folded-open quote. */
function Scene({ s, last }: { s: TrailScene; last: boolean }) {
  const { t, fmtDay } = useApp();
  const open = useOpenTarget();
  const [expanded, setExpanded] = useState(false);
  const canOpen = !!s.quote;
  return (
    <View style={styles.node} testID="trail-scene">
      {!last && <View style={styles.rail} />}
      <View style={styles.gut}>
        <Icon name={s.icon} size={16} color={s.kind === 'proposal' ? colors.ai : colors.textTertiary} />
      </View>
      <View style={styles.main}>
        <View style={styles.meta}>
          <Text size="xs" color={s.kind === 'proposal' ? 'ai' : 'textTertiary'} style={styles.grow}>
            {s.label}
          </Text>
          <Text size="xs" color="textTertiary">
            {s.date ? fmtDay(s.date) : t('lin.pending')}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded }} disabled={!canOpen} onPress={() => setExpanded((v) => !v)} style={styles.ttl} testID={canOpen ? 'trail-toggle' : undefined}>
          <Text size="md" weight="medium" style={styles.grow}>
            {s.title}
          </Text>
          {canOpen && <Icon name={expanded ? 'chevUp' : 'right'} size={16} />}
        </Pressable>
        {s.summary && (
          <Text size="sm" color="textSecondary" numberOfLines={expanded ? undefined : 2} style={styles.smy}>
            {s.summary}
          </Text>
        )}
        {expanded && s.quote && (
          <Pressable accessibilityRole="link" disabled={!s.source} onPress={() => s.source && open(s.source)} style={styles.quote} testID="trail-quote">
            <Text size="sm" selectable>{`“${s.quote}”`}</Text>
            <Text size="xs" color="textTertiary" style={styles.ref}>
              {[s.ref, s.date ? fmtDay(s.date) : null].filter(Boolean).join('  ')}
            </Text>
          </Pressable>
        )}
        {(s.outs.length > 0 || s.more > 0) && (
          <View style={styles.outs}>
            {s.outs.map((o) => (
              <Pressable key={o.key} disabled={!o.target} onPress={() => o.target && open(o.target)} style={styles.out}>
                {o.code && (
                  <Text size="xs" mono>
                    {o.code}
                  </Text>
                )}
                <Text size="sm" color="textSecondary">
                  {o.verb}
                </Text>
              </Pressable>
            ))}
            {s.more > 0 && (
              <Text size="sm" color="textTertiary">
                {t('lnv.more', { n: s.more })}
              </Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

/** 06 项目›脉络 on phones: the project's scenes, newest first. Inputs live here now; their raw text opens from a scene. */
export function TrailList({ projectId }: { projectId: Id }) {
  const { t, live } = useApp();
  const scenes = trailScenes(t, live, projectId);
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} testID="trail">
      {scenes.length === 0 ? (
        <Text size="sm" color="textSecondary">
          {t('lnv.trailNone')}
        </Text>
      ) : (
        scenes.map((s, i) => <Scene key={s.key} s={s} last={i === scenes.length - 1} />)
      )}
    </ScrollView>
  );
}

/** /p/:pid/lineage: the phone trail (06), or the vertical lineage on wide screens. */
export function TrailScreen() {
  const { t } = useApp();
  const projectId = useProjectId();
  const project = useProject();
  const { phone } = useLayout();
  if (!phone) return <LineageScreen />;
  if (!project) return <Text color="textSecondary">{t('xp.notFound')}</Text>;
  return <TrailList projectId={projectId} />;
}

/**
 * /p/:pid/lineage/:needId: on phones the need's 来龙去脉 (07) as a sheet over the project trail;
 * 「‹ 详情」 goes to the need, ✕ back to where it came from. Wide screens keep the lineage view.
 */
export function NeedTrailScreen() {
  const { t } = useApp();
  const projectId = useProjectId();
  const project = useProject();
  const { phone } = useLayout();
  const router = useRouter();
  const { needId } = useLocalSearchParams<{ needId?: string }>();
  const [open, setOpen] = useState(true);
  // The Stack keeps this screen mounted under the next one; its Modal sheet must not stay on top.
  const focused = useIsFocused();
  if (!phone) return <LineageScreen />;
  if (!project) return <Text color="textSecondary">{t('xp.notFound')}</Text>;
  const id = String(needId ?? '');
  const close = () => {
    setOpen(false);
    if (router.canGoBack()) router.back();
    else router.replace(routePath({ view: 'lineage', projectId }) as Href);
  };
  return (
    <View style={styles.root}>
      <TrailList projectId={projectId} />
      <NeedTrailSheet projectId={projectId} needId={id} open={open && focused} onClose={close} onBack={() => router.push(routePath({ view: 'board', projectId, needId: id }) as Href)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space[5], paddingTop: space[5], paddingBottom: space[8] },
  node: { flexDirection: 'row', gap: 14, paddingBottom: space[5], position: 'relative' },
  rail: { position: 'absolute', left: 10.5, top: 24, bottom: 2, width: 1, backgroundColor: colors.border },
  gut: { width: 22, alignItems: 'center', paddingTop: 3 },
  main: { flex: 1, minWidth: 0 },
  meta: { flexDirection: 'row', alignItems: 'baseline', gap: space[2] },
  grow: { flex: 1 },
  ttl: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: 1 },
  smy: { marginTop: 2 },
  quote: { marginTop: space[2], backgroundColor: colors.surface, borderRadius: radius.xl, paddingHorizontal: 14, paddingVertical: space[3] },
  ref: { marginTop: space[2] },
  outs: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space[4], rowGap: 2, marginTop: 6 },
  out: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
});
