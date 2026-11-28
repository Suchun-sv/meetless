import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Button, Screen, Segmented, Text } from '@/components/ui';
import { localDay, useApp, useGo } from '@/state';
import { colors, radius, space } from '@/theme';
import { deadlineReminders } from '../model/schedule';
import { askPermission, permission, remindersOff, resyncReminders, setRemindersOff } from './sync';

/**
 * Deadline reminders: on or off (iOS asks for permission the first time), then every notice
 * still to come, soonest first. On the web the list is a preview; notices only come on iPhone.
 */
export function RemindersScreen() {
  const { live, me, t, fmtDay, fmtClock } = useApp();
  const go = useGo();
  const web = Platform.OS === 'web';
  const list = deadlineReminders(live, t, me, new Date());
  const [perm, setPerm] = useState<'granted' | 'denied' | 'undetermined' | null>(null);
  const [off, setOff] = useState(false);
  useEffect(() => {
    void permission().then(setPerm);
    void remindersOff().then(setOff);
  }, []);
  const enable = async () => {
    const ok = await askPermission();
    setPerm(ok ? 'granted' : 'denied');
    if (ok) await resyncReminders(list);
  };
  const toggle = async (v: 'on' | 'off') => {
    setOff(v === 'off');
    await setRemindersOff(v === 'off');
    await resyncReminders(list);
  };

  return (
    <Screen title={t('xp.reminders')}>
      <Text color="textSecondary">{t('rem.sub')}</Text>
      {web ? (
        <Text size="sm" color="textTertiary">
          {t('rem.webOnly')}
        </Text>
      ) : perm === 'granted' ? (
        <Segmented
          value={off ? 'off' : 'on'}
          onChange={(v) => void toggle(v)}
          options={[
            { value: 'on', label: t('rem.on') },
            { value: 'off', label: t('rem.off') },
          ]}
        />
      ) : perm === 'denied' ? (
        <Text size="sm" color="warning">
          {t('rem.denied')}
        </Text>
      ) : perm === 'undetermined' ? (
        <Button variant="primary" label={t('rem.enable')} testID="rem-enable" onPress={() => void enable()} style={{ alignSelf: 'flex-start' }} />
      ) : null}
      {list.length === 0 ? (
        <Text size="sm" color="textSecondary">
          {t('rem.none')}
        </Text>
      ) : (
        <View style={{ gap: space[2] }} testID="rem-list">
          {list.map((r) => (
            <View key={r.id} style={[styles.row, !web && off && { opacity: 0.5 }]}>
              <Text size="sm" color="textSecondary" tight style={styles.when}>
                {`${fmtDay(localDay(r.fireAt))} ${fmtClock(r.fireAt.toISOString())}`}
              </Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" weight="medium" tight numberOfLines={1}>
                  {r.title}
                </Text>
                <Text
                  size="sm"
                  color="textSecondary"
                  numberOfLines={2}
                  onPress={() => go(r.data.kind === 'round' ? { view: 'deliveries', projectId: r.data.projectId, round: r.data.round } : { view: 'board', projectId: r.data.projectId, needId: r.data.needId })}
                >
                  {r.body}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', padding: space[3], borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg },
  when: { width: 110, paddingTop: 2 },
});
