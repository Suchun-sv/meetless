import { useState } from 'react';
import { View } from 'react-native';
import { Button, Screen, Text } from '@/components/ui';
import { useApp, useGo, useProjectId } from '@/state';
import { space } from '@/theme';
import { cardStamp, projectDash } from '../model/cards';
import { CardGrid, DashCard } from './CardGrid';
import { ProjectCard } from './ProjectCards';

/**
 * A project's 看板: a setup strip while the project has only its creator or no rounds, then the
 * card grid. Cards are rule-based, computed live from the project record.
 */
export function DashboardScreen() {
  const { live, me, t } = useApp();
  const go = useGo();
  const projectId = useProjectId();
  const [openedAt] = useState(() => new Date().toISOString());
  if (!live.projects[projectId]) {
    return (
      <Screen>
        <Text color="textSecondary">{t('home.empty')}</Text>
      </Screen>
    );
  }
  const v = projectDash(live, me, projectId);
  return (
    <Screen full style={{ maxWidth: 1280, width: '100%', alignSelf: 'center' }}>
      {v.setupMembers || v.setupRounds ? (
        <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }} testID="dash-setup">
          {v.setupMembers ? <Button size="sm" label={t('db.setupMembers')} testID="setup-members" onPress={() => go({ view: 'members', projectId })} /> : null}
          {v.setupRounds ? <Button size="sm" label={t('db.setupRounds')} testID="setup-rounds" onPress={() => go({ view: 'rounds', projectId })} /> : null}
        </View>
      ) : null}
      <View testID="page-dash">
        <CardGrid
          cards={v.cards}
          render={(id) => (
            <DashCard id={id} scope={projectId} stamp={cardStamp(v.refreshed, id, openedAt)}>
              <ProjectCard id={id} projectId={projectId} />
            </DashCard>
          )}
        />
      </View>
    </Screen>
  );
}
