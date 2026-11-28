import { useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';
import { colors } from '@/theme';

/** Diagonal stripes filling the parent: how a time span is drawn. `vertical` for the list's colour bar. */
export function Stripes({ style, vertical, light }: { style?: StyleProp<ViewStyle>; vertical?: boolean; light?: boolean }) {
  const id = `st${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const w = light ? 8 : 6;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={id} patternUnits="userSpaceOnUse" width={w} height={w} patternTransform={vertical ? undefined : 'rotate(45)'}>
            <Rect width={w} height={w} fill={light ? colors.sidebar : colors.selected} />
            <Line x1={0} y1={vertical ? w / 4 : 0} x2={vertical ? w : 0} y2={vertical ? w / 4 : w} stroke={light ? colors.selected : colors.borderStrong} strokeWidth={w / 2} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** A project's colour (muted avatar tones). */
export const projectColor = (i: number) => colors.avatar[i]!;
