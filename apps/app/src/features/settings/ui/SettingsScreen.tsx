import { useEffect, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import Constants from 'expo-constants';
import type { UpdateState } from '@meetless/client/bridge';
import { hasCapability, IS_DESKTOP } from '@/bridge';
import { Avatar, Button, Card, Screen, Segmented, Text } from '@/components/ui';
import { LANG_LABEL, SUPPORTED_LOCALES } from '@/i18n';
import { displayName, myProjects, useApp, useGo } from '@/state';
import { space } from '@/theme';
import { Row, SectionLabel } from '../../inputs/ui/common';
import { calloutPrimaryKey, signOutKey, updateBlock, type CalloutModel, type Platform as P } from '../model';

/** 设置: who is signed in, language, version and update status, sign out. */
export function SettingsScreen() {
  const { live, me, t, locale, setLocale, bridge, signOut, fmtClock } = useApp();
  const go = useGo();
  const platform: P = IS_DESKTOP ? 'desktop' : Platform.OS === 'web' ? 'web' : 'ios';
  const updates = hasCapability('appUpdates');
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [newBuild, setNewBuild] = useState(false);

  useEffect(() => {
    const off = bridge.subscribe((e) => {
      if (e.type === 'newBuild') setNewBuild(true);
      if (e.type === 'update') setUpdate(e.update);
    });
    if (updates)
      void bridge
        .updatesCheck()
        .then((r) => r.ok && setUpdate(r.update))
        .catch(() => undefined);
    return off;
  }, [bridge, updates]);

  const check = () => void bridge.updatesCheck().then((r) => r.ok && setUpdate(r.update));
  const act = (m: CalloutModel) => {
    if (m.primary === 'retry') return check();
    if (m.primary === 'download' && update) return void Linking.openURL(update.releasesUrl);
    void bridge.updatesInstall().catch(() => undefined);
  };
  const sample = myProjects(live, me).some((p) => p.sample);
  const block = updateBlock(updates && update ? 'desktop' : platform === 'desktop' ? 'web' : platform, { appVersion: Constants.expoConfig?.version ?? null, update, newBuild }, fmtClock);

  return (
    <Screen title={t('xp.settings')}>
      <View style={{ gap: space[4] }} testID="page-settings">
        <SectionLabel>{t('set.account')}</SectionLabel>
        <Card>
          <Row>
            <Avatar userId={me} size="lg" />
            <View style={{ flex: 1 }}>
              <Text weight="medium">{displayName(live, me)}</Text>
              {sample ? (
                <Text size="xs" color="textSecondary">
                  {t('app.sample')}
                </Text>
              ) : null}
            </View>
            <Button testID="sign-out" label={t(signOutKey(platform))} onPress={() => void signOut()} />
          </Row>
        </Card>

        <SectionLabel>{t('user.language')}</SectionLabel>
        <Segmented value={locale} onChange={setLocale} accessibilityLabel={t('user.language')} options={SUPPORTED_LOCALES.map((l) => ({ value: l, label: LANG_LABEL[l] }))} />

        <SectionLabel>{t('set.version')}</SectionLabel>
        <Card testID="update">
          {block.kind === 'desktop' ? (
            <>
              <Text size="sm" mono testID="update-version">
                {block.version}
              </Text>
              <Text size="sm" color={block.status.error ? 'danger' : 'textSecondary'} testID="update-status">
                {t(block.status.key, block.status.params)}
              </Text>
              <Row wrap>
                <Button label={t('upd.check')} size="sm" onPress={check} />
                {block.callout ? <Button label={t(calloutPrimaryKey(block.callout))} size="sm" variant="primary" disabled={block.callout.disabled} onPress={() => act(block.callout!)} /> : null}
              </Row>
            </>
          ) : (
            <>
              <Row>
                <Text size="sm" mono testID="update-version">
                  {block.version ?? ''}
                </Text>
                <Text size="sm" color="textSecondary">
                  {t(block.kind === 'web' ? 'set.web' : 'set.ios')}
                </Text>
              </Row>
              {block.kind === 'web' && block.newBuild ? (
                <Button testID="update-reload" label={t('web.newBuild')} variant="primary" size="sm" onPress={() => window.location.reload()} style={{ alignSelf: 'flex-start' }} />
              ) : (
                <Text size="sm" color="textSecondary" testID="update-status">
                  {t('upd.sUpToDateNoTime')}
                </Text>
              )}
            </>
          )}
        </Card>

        {hasCapability('openLogs') ? (
          <Button testID="open-logs" label={t('user.openLogs')} size="sm" onPress={() => void bridge.openLogs()} style={{ alignSelf: 'flex-start' }} />
        ) : null}

        <SectionLabel>{t('nav.agents')}</SectionLabel>
        <Button label={t('nav.agents')} onPress={() => go({ view: 'agents' })} style={{ alignSelf: 'flex-start' }} />
      </View>
    </Screen>
  );
}
