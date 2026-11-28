import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors, type ColorName } from '@/theme';

/** The few line icons the phone shell uses (1.6 stroke, square-ish ends, no filled dots except ⋯'s). */
export type IconName = 'calendar' | 'folder' | 'inbox' | 'back' | 'chevron' | 'more' | 'sparkle' | 'send' | 'close' | 'plus' | 'check' | 'down' | 'info';

export function Icon({ name, size = 22, color = 'text', strokeWidth = 1.6 }: { name: IconName; size?: number; color?: ColorName; strokeWidth?: number }) {
  const c = colors[color];
  const p = { stroke: c, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'calendar' && (
        <>
          <Rect x={3.5} y={5} width={17} height={15.5} rx={2} {...p} />
          <Path d="M3.5 9.5h17M8 3v4M16 3v4" {...p} />
          <Path d="M8 13h.01M12 13h.01M16 13h.01M8 16.5h.01M12 16.5h.01M16 16.5h.01" {...p} strokeWidth={2.2} />
        </>
      )}
      {name === 'folder' && <Path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" {...p} />}
      {name === 'inbox' && (
        <>
          <Path d="M3.5 13.5 6 6.5a2 2 0 0 1 1.9-1.5h8.2A2 2 0 0 1 18 6.5l2.5 7" {...p} />
          <Path d="M3.5 13.5V18a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4.5h-5l-1.5 2.5h-4L8.5 13.5z" {...p} />
        </>
      )}
      {name === 'back' && <Path d="M15 5l-7 7 7 7" {...p} />}
      {name === 'chevron' && <Path d="M9 5l7 7-7 7" {...p} />}
      {name === 'down' && <Path d="M6 9l6 6 6-6" {...p} />}
      {name === 'more' && (
        <>
          <Circle cx={12} cy={12} r={9.5} {...p} />
          <Circle cx={8} cy={12} r={1.1} fill={c} />
          <Circle cx={12} cy={12} r={1.1} fill={c} />
          <Circle cx={16} cy={12} r={1.1} fill={c} />
        </>
      )}
      {name === 'sparkle' && <Path d="M11 3.5l1.7 4.8 4.8 1.7-4.8 1.7L11 16.5l-1.7-4.8L4.5 10l4.8-1.7zM18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" {...p} />}
      {name === 'send' && <Path d="M12 19V5M6 11l6-6 6 6" {...p} />}
      {name === 'close' && <Path d="M6 6l12 12M18 6 6 18" {...p} />}
      {name === 'plus' && <Path d="M12 5v14M5 12h14" {...p} />}
      {name === 'check' && <Path d="M7 12.5l3.2 3.2L17 9" {...p} />}
      {name === 'info' && (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M12 11v5.5M12 7.8v.01" {...p} />
        </>
      )}
    </Svg>
  );
}
