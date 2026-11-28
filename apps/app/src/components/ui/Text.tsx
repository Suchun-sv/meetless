import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { checkNoDots, colors, fontFor, fontSize, hasCjk, leading, textOf, trackingTight, type ColorName, type FontSize, type Weight } from '@/theme';

export interface TextProps extends RNTextProps {
  size?: FontSize;
  weight?: Weight;
  color?: ColorName;
  mono?: boolean;
  /** Tight line height (titles, single lines); default is the normal 1.6. */
  tight?: boolean;
  align?: TextStyle['textAlign'];
}

/**
 * The only text component. Picks the font for the content (CJK on native uses Noto Sans SC), and in
 * development warns when the text contains a dot symbol (the no-dots rule).
 */
export function Text({ size = 'base', weight = 'regular', color = 'text', mono, tight, align, style, children, ...rest }: TextProps) {
  const s = textOf(children);
  if (__DEV__) checkNoDots(s);
  const px = fontSize[size];
  const big = px >= fontSize.xl;
  return (
    <RNText
      {...rest}
      style={[
        fontFor(weight, { mono, cjk: hasCjk(s) }),
        {
          fontSize: px,
          lineHeight: Math.round(px * (tight || big ? leading.tight : leading.normal)),
          color: colors[color],
          ...(big ? { letterSpacing: px * trackingTight } : null),
          ...(align ? { textAlign: align } : null),
        },
        style,
      ]}
    >
      {children}
    </RNText>
  );
}
