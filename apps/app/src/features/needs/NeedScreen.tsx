/**
 * The need route: on a wide container the board with the need in its side pane; on a phone the
 * detail as its own page with a back button.
 */
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui';
import { useApp, useGo } from '@/state';
import { colors, layout, space, useLayout } from '@/theme';
import { NeedsMobile } from './mobile/NeedsMobile';
import { NeedSheet } from './mobile/NeedSheet';
import type { Id } from '@meetless/core';
import { BoardScreen } from './BoardScreen';
import { NeedDetail } from './NeedDetail';

export function NeedScreen({ projectId, needId }: { projectId: Id; needId: Id }) {
  const { t } = useApp();
  const { width } = useLayout();
  const router = useRouter();
  const go = useGo();
  // The sidebar takes its share on wide windows; the board's own width decides the pane.
  if (width >= 1260) return <BoardScreen projectId={projectId} selectedNeedId={needId} />;
  if (width < layout.phoneMax)
    return (
      <>
        <NeedsMobile projectId={projectId} />
        <NeedSheet projectId={projectId} needId={needId} onClose={() => go({ view: 'board', projectId }, { replace: true })} />
      </>
    );
  const back = () => (router.canGoBack() ? router.back() : go({ view: 'board', projectId }, { replace: true }));
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: space[2], paddingTop: space[2], flexDirection: 'row' }}>
        <Button testID="drawer-back" size="sm" variant="ghost" label={t('web.back')} onPress={back} />
      </View>
      <View style={{ flex: 1 }}>
        <NeedDetail projectId={projectId} needId={needId} />
      </View>
    </View>
  );
}
