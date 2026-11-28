import { useState } from 'react';
import { View } from 'react-native';
import { Button, Screen, Text } from '@/components/ui';
import { useApp, useGo } from '@/state';
import { space, useLayout } from '@/theme';
import { cardStamp } from '../../dashboard/model/cards';
import { CardGrid, DashCard } from '../../dashboard/ui/CardGrid';
import { homeView } from '../model/home';
import { HomeCard } from './HomeCards';
import { HomeMobile } from './HomeMobile';

/**
 * 「我的」: how much is waiting across how many projects, then the card grid. With no projects,
 * an empty state that points at creating one.
 */
export function HomeScreen() {
  // Narrow screens get the mobile-v1 我的 (deadlines and their needs, no cards, no gantt).
  return useLayout().phone ? <HomeMobile /> : <HomeWide />;
}

function HomeWide() {
  const { live, me, t, today } = useApp();
  const go = useGo();
  const [openedAt] = useState(() => new Date().toISOString());
  const v = homeView(live, me, today);
  if (v.empty) {
    return (
      <Screen>
        <View style={{ gap: space[3], alignItems: 'flex-start' }} testID="page-home">
          <Text color="textSecondary">{t('pj.empty')}</Text>
          <Button variant="primary" label={t('nav.newProject')} testID="home-new-project" onPress={() => go({ view: 'newProject' })} />
        </View>
      </Screen>
    );
  }
  return (
    <Screen full style={{ maxWidth: 1280, width: '100%', alignSelf: 'center' }}>
      <View style={{ gap: space[1] }} testID="page-home">
        <Text size="2xl" weight="semibold">
          {t('home.hi', { n: v.waiting })}
        </Text>
        <Text color="textSecondary">{t('home.sub', { p: v.projects })}</Text>
      </View>
      <CardGrid
        cards={v.cards}
        render={(id) => (
          <DashCard id={id} scope="home" home stamp={cardStamp(v.refreshed, id, openedAt)}>
            <HomeCard id={id} />
          </DashCard>
        )}
      />
    </Screen>
  );
}
