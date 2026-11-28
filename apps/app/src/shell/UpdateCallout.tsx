import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import type { MeetlessBridge, UpdateState } from '@meetless/client/bridge';
import { hasCapability } from '@/bridge';
import { calloutModel, calloutPrimaryKey, updateStatus, versionText } from '@/features/settings/model';
import { colors, radius, space } from '@/theme';
import { Button, Sheet, Text } from '@/components/ui';
import { useApp } from '@/state';

/*
 * App updates in the sidebar, as in Paseo and the legacy renderer (shell/UpdateEntry): checking and
 * downloading run in the desktop main process; a callout card above the user row offers what is
 * ready and the user decides when. Desktop only (`appUpdates`); nothing renders elsewhere.
 */

const DISMISSED = 'meetless.update.dismissed';

function useUpdateState(bridge: MeetlessBridge): [UpdateState | null, () => void] {
  const [state, setState] = useState<UpdateState | null>(null);
  const check = useCallback(() => {
    void bridge
      .updatesCheck()
      .then((r) => {
        if (r.ok) setState(r.update);
      })
      .catch(() => undefined);
  }, [bridge]);
  useEffect(() => {
    if (!hasCapability('appUpdates')) return;
    const off = bridge.subscribe((e) => {
      if (e.type === 'update') setState(e.update);
    });
    check();
    return off;
  }, [bridge, check]);
  return [state, check];
}

function readDismissed(): string | null {
  try {
    return globalThis.localStorage?.getItem(DISMISSED) ?? null;
  } catch {
    return null;
  }
}

/** The callout card and the status line with 「检查更新」 (desktop app only). */
export function UpdateArea() {
  const { bridge, t, fmtClock } = useApp();
  const [state, check] = useUpdateState(bridge);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [notes, setNotes] = useState(false);
  if (!hasCapability('appUpdates') || !state) return null;
  const m = calloutModel(state);
  const status = updateStatus(state, fmtClock);
  const dismiss = (key: string) => {
    try {
      globalThis.localStorage?.setItem(DISMISSED, key);
    } catch {
      // Storage unavailable: dismissed for this run only.
    }
    setDismissed(key);
  };
  const act = () => {
    if (!m) return;
    if (m.primary === 'retry') return check();
    if (m.primary === 'download') return void Linking.openURL(state.releasesUrl);
    void bridge.updatesInstall().catch(() => undefined);
  };
  return (
    <View style={styles.wrap}>
      {m && m.key !== dismissed ? (
        <View style={styles.card} testID="update-callout">
          <View style={styles.head}>
            <Text size="sm" weight="semibold" color={m.error ? 'danger' : 'text'} tight>
              {m.error ? t('upd.cFailed') : t('upd.cAvail')}
            </Text>
            <Text size="xs" color="textSecondary" tight style={{ flex: 1 }} numberOfLines={1}>
              {m.version}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('upd.dismiss')} hitSlop={8} onPress={() => dismiss(m.key)} testID="update-dismiss">
              <Text size="sm" color="textTertiary" tight>
                {t('close')}
              </Text>
            </Pressable>
          </View>
          {m.body === 'downloading' ? (
            <Text size="xs" color="textSecondary">
              {t('upd.cDownloading', { n: m.percent ?? 0 })}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button size="sm" label={t('upd.whatsNew')} onPress={() => setNotes(true)} testID="update-notes" />
            <Button size="sm" variant="primary" label={t(calloutPrimaryKey(m))} disabled={m.disabled} onPress={act} testID="update-go" />
          </View>
          <Sheet open={notes} onClose={() => setNotes(false)} title={t('upd.notesTitle', { v: m.version })}>
            {(m.notes.length ? m.notes : [`Meetless ${m.version}`]).map((n, i) => (
              <Text key={i}>{n}</Text>
            ))}
          </Sheet>
        </View>
      ) : null}
      <View style={styles.status} testID="update">
        <Text size="xs" color="textTertiary" tight testID="update-version">
          {versionText(state)}
        </Text>
        <Text size="xs" color={status.error ? 'danger' : 'textSecondary'} tight style={{ flex: 1 }} numberOfLines={1} testID="update-status">
          {t(status.key, status.params)}
        </Text>
        <Pressable accessibilityRole="button" onPress={check} hitSlop={6} testID="update-check">
          <Text size="xs" color="textSecondary" tight>
            {t('upd.check')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[2], paddingHorizontal: space[3], paddingBottom: space[2] },
  card: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: space[3], gap: space[2] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  status: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[1] },
});
