import { StyleSheet, View } from 'react-native';
import { colors } from '@/theme';
import { useApp } from '@/state/AppContext';
import { displayName, initials } from '@/state/model';
import { Text } from './Text';

const SIZES = { sm: 20, md: 28, lg: 36 } as const;

function colorFor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return colors.avatar[h % colors.avatar.length]!;
}

/** A user's circle: one glyph for a CJK name (张老师: 张), one or two letters otherwise. */
export function Avatar({ userId, name, size = 'md' }: { userId: string; name?: string; size?: keyof typeof SIZES }) {
  const { live } = useApp();
  const label = initials(name ?? displayName(live, userId));
  const d = SIZES[size];
  return (
    <View accessibilityLabel={name ?? displayName(live, userId)} style={[styles.c, { width: d, height: d, borderRadius: d / 2, backgroundColor: colorFor(userId) }]}>
      <Text size={size === 'sm' ? 'xs' : 'sm'} weight="medium" color="textInverse" tight style={size === 'sm' ? { fontSize: 10, lineHeight: 12 } : undefined}>
        {label}
      </Text>
    </View>
  );
}

/** Overlapping avatars for a member list. */
export function AvatarStack({ userIds, size = 'sm', max = 5 }: { userIds: string[]; size?: keyof typeof SIZES; max?: number }) {
  const shown = userIds.slice(0, max);
  return (
    <View style={styles.stack}>
      {shown.map((id, i) => (
        <View key={id} style={i > 0 ? { marginLeft: -4 } : undefined}>
          <Avatar userId={id} size={size} />
        </View>
      ))}
      {userIds.length > max ? (
        <Text size="xs" color="textSecondary" style={{ marginLeft: 4 }}>
          +{userIds.length - max}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  c: { alignItems: 'center', justifyContent: 'center' },
  stack: { flexDirection: 'row', alignItems: 'center' },
});
