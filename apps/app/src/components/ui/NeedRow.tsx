import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { Id, NeedStatus } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { colors, space, type ColorName } from '@/theme';
import { useApp } from '@/state/AppContext';
import { Text } from './Text';

/** Status as coloured text only (mobile-v1): in progress and testing blue, not started grey, done green. */
export function statusColor(s: NeedStatus): ColorName {
  if (s === 'doing' || s === 'partial' || s === 'testing') return 'info';
  if (s === 'met' || s === 'held') return 'success';
  if (s === 'moved') return 'warning';
  return 'textTertiary';
}

const DONE: ReadonlySet<NeedStatus> = new Set<NeedStatus>(['met', 'held']);

/**
 * The check circle before a need row (mobile-v1 decision 4): a 22pt hollow circle; tapping sets the
 * need to met (a hypothesis to held), filled green with a white check, with a 撤销 toast; tapping a
 * done one puts the previous status back.
 */
export function CheckCircle({ needId, size = 22 }: { needId: Id; size?: number }) {
  const { live, submit, notify, t } = useApp();
  const n = live.needs[needId];
  if (!n) return <View style={{ width: size, height: size }} />;
  const done = DONE.has(n.status);
  const target: NeedStatus = n.kind === 'hyp' ? 'held' : 'met';
  const undoTo: NeedStatus = n.kind === 'hyp' ? 'testing' : 'doing';
  const press = async () => {
    const before = n.status;
    if (done) {
      await submit('need.status_set', { needId, status: undoTo });
      return;
    }
    const r = await submit('need.status_set', { needId, status: target });
    if (r.kind === 'rejected') return;
    notify('info', t(n.kind === 'hyp' ? 'xp.markedHeld' : 'xp.markedMet', { code: n.code }), {
      label: t('xp.undo'),
      onPress: () => void submit('need.status_set', { needId, status: before }),
    });
  };
  return (
    <Pressable
      testID={`check-${n.code}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={done ? t('xp.uncheck') : t('xp.check')}
      hitSlop={10}
      onPress={() => void press()}
    >
      <Svg width={size} height={size} viewBox="0 0 22 22">
        {done ? (
          <>
            <Circle cx={11} cy={11} r={11} fill={colors.success} />
            <Path d="M6.5 11.3l3 3 6-6.3" stroke={colors.textInverse} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : (
          <Circle cx={11} cy={11} r={10.25} stroke={colors.borderStrong} strokeWidth={1.5} fill="none" />
        )}
      </Svg>
    </Pressable>
  );
}

export interface NeedRowProps {
  needId: Id;
  /** Hypotheses hang under their parent: 32 per level. */
  depth?: number;
  onPress?: () => void;
  /** The check circle (default on). */
  check?: boolean;
  /** Hairline above the row, starting at the text (not full width). */
  divider?: boolean;
  testID?: string;
}

/**
 * One need row (mobile-v1, 01/02/09): check circle, code (mono, grey), title (one line), status in
 * colour. Shared by 我的, the project 需求 list and 交付.
 */
export function NeedRow({ needId, depth = 0, onPress, check = true, divider, testID }: NeedRowProps) {
  const { live, t } = useApp();
  const n = live.needs[needId];
  if (!n) return null;
  const done = DONE.has(n.status);
  return (
    <View style={[styles.wrap, { paddingLeft: depth * 32 }]} testID={testID ?? `need-row-${n.code}`}>
      {check ? <CheckCircle needId={needId} /> : null}
      <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, divider && styles.divider, pressed && { opacity: 0.6 }]}>
        <Text mono size="sm" color="textTertiary" style={styles.code} tight>
          {n.code}
        </Text>
        <Text size="md" color={done ? 'textTertiary' : 'text'} numberOfLines={1} style={{ flex: 1 }} tight>
          {n.title}
        </Text>
        <Text size="sm" color={statusColor(n.status)} tight>
          {t(`st.${n.status}` as MessageKey)}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 44, paddingVertical: 10 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  code: { minWidth: 26 },
});
