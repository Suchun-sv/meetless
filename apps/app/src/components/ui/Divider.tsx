import { View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, space, type Space } from '@/theme';

/** A hairline rule, horizontal by default. */
export function Divider({ vertical, inset = 0, style }: { vertical?: boolean; inset?: 0 | Space; style?: StyleProp<ViewStyle> }) {
  const m = inset === 0 ? 0 : space[inset];
  return <View style={[vertical ? { width: 1, alignSelf: 'stretch', marginVertical: m } : { height: 1, alignSelf: 'stretch', marginHorizontal: m }, { backgroundColor: colors.border }, style]} />;
}
