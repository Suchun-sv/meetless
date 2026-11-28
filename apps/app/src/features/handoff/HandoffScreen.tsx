import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { noDots, type Handoff } from '@meetless/core';
import { Screen, Text } from '@/components/ui';
import { routePath, useApp, useProject, useProjectId } from '@/state';
import { space } from '@/theme';
import { HandoffBlock } from './HandoffBlock';
import { HandoffForm } from './HandoffForm';
import { LinkBox } from './LinkBox';
import { CcHandoffBody } from '../chat/cc/CcHandoff';

/** Handoffs in this project that involve me, waiting on me first, then newest. */
function myHandoffs(hs: readonly Handoff[], me: string): Handoff[] {
  const mine = hs.filter((h) => h.fromId === me || h.toId === me);
  const waiting = (h: Handoff) => Number(h.toId === me && (h.state === 'sent' || h.state === 'asked')) + Number(h.fromId === me && h.state === 'returned');
  return mine.sort((a, b) => waiting(b) - waiting(a) || b.createdSeq - a.createdSeq);
}

/**
 * The handoff page. `?need=` opens the handoff form for that need (`&to=` preselects who), and
 * `&mode=link` the link-for-agent box (链接弹窗). With no need it lists my handoffs in the project
 * as handoff blocks, open ones first.
 */
export function HandoffScreen() {
  const { t, me, live } = useApp();
  const projectId = useProjectId();
  const project = useProject();
  const router = useRouter();
  const q = useLocalSearchParams<{ need?: string; to?: string; mode?: string; cc?: string }>();
  const needId = q.need ? String(q.need) : null;
  const need = needId ? live.needs[needId] : undefined;
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace(routePath(needId ? { view: 'board', projectId, needId } : { view: 'dash', projectId }) as Href);
  };

  if (!project) return <Screen title={t('cp.handoff')}>{<Text color="textSecondary">{t('xp.notFound')}</Text>}</Screen>;

  // ⋯ › 在别处继续: resume the project's Claude Code session in a terminal or through Remote Control.
  if (q.cc === '1') {
    return (
      <Screen title={t('cc.handoff.title')}>
        <CcHandoffBody projectId={projectId} />
      </Screen>
    );
  }

  if (needId && q.mode === 'link') {
    return (
      <Screen title={t('lk.btn')}>
        {need && need.projectId === projectId ? (
          <>
            <Text size="sm" color="textSecondary">{`${need.code} ${noDots(need.title)}`}</Text>
            <LinkBox projectId={projectId} needId={needId} />
          </>
        ) : (
          <Text color="textSecondary">{t('dr.missing')}</Text>
        )}
      </Screen>
    );
  }

  if (needId) {
    return (
      <Screen title={t('ho.btn')}>
        <HandoffForm projectId={projectId} needId={needId} toId={q.to ? String(q.to) : null} onDone={back} onCancel={back} />
      </Screen>
    );
  }

  const list = myHandoffs(Object.values(live.handoffs).filter((h) => h.projectId === projectId), me);
  return (
    <Screen title={t('cp.handoff')}>
      {list.length === 0 ? (
        <Text color="textSecondary">{t('hx.none')}</Text>
      ) : (
        <View style={styles.list}>
          {list.map((h) => {
            const n = live.needs[h.needId];
            if (!n) return null;
            return (
              <View key={h.id} style={styles.item}>
                <Text size="xs" color="textTertiary">{`${n.code} ${noDots(n.title)}`}</Text>
                <HandoffBlock need={n} h={h} />
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space[4] },
  item: { gap: space[1] },
});
