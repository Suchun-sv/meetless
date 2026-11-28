import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '@/theme';

/** The few line icons the phone screens use (Lucide shapes, 24-unit grid, 2px stroke). */
export type IconName =
  | 'bot'
  | 'file'
  | 'chat'
  | 'mail'
  | 'pen'
  | 'users'
  | 'swap'
  | 'flag'
  | 'sparkles'
  | 'plus'
  | 'up'
  | 'x'
  | 'info'
  | 'left'
  | 'right'
  | 'chevUp'
  | 'package'
  | 'clip'
  | 'camera'
  | 'image'
  | 'check'
  | 'checkCircle';

export function Icon({ name, size = 18, color = colors.textTertiary, stroke = 2 }: { name: IconName; size?: number; color?: string; stroke?: number }) {
  const p = { stroke: color, strokeWidth: stroke, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {(() => {
        switch (name) {
          case 'bot':
            return (
              <>
                <Path d="M12 8V4H8" {...p} />
                <Rect x={4} y={8} width={16} height={12} rx={2} {...p} />
                <Path d="M2 14h2M20 14h2M15 13v2M9 13v2" {...p} />
              </>
            );
          case 'file':
            return (
              <>
                <Path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" {...p} />
                <Path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8" {...p} />
              </>
            );
          case 'chat':
            return <Path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" {...p} />;
          case 'mail':
            return (
              <>
                <Rect x={2} y={4} width={20} height={16} rx={2} {...p} />
                <Path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" {...p} />
              </>
            );
          case 'pen':
            return <Path d="M12 20h9M16.38 3.62a1 1 0 0 1 3 3L7.37 18.64a2 2 0 0 1-.85.5l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.85z" {...p} />;
          case 'users':
            return (
              <>
                <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" {...p} />
                <Circle cx={9} cy={7} r={4} {...p} />
                <Path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" {...p} />
              </>
            );
          case 'swap':
            return <Path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4" {...p} />;
          case 'flag':
            return <Path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" {...p} />;
          case 'sparkles':
            return (
              <>
                <Path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z" {...p} />
                <Path d="M20 3v4M22 5h-4M4 17v2M5 18H3" {...p} />
              </>
            );
          case 'plus':
            return <Path d="M5 12h14M12 5v14" {...p} />;
          case 'up':
            return <Path d="m5 12 7-7 7 7M12 19V5" {...p} />;
          case 'x':
            return <Path d="M18 6 6 18M6 6l12 12" {...p} />;
          case 'info':
            return (
              <>
                <Circle cx={12} cy={12} r={10} {...p} />
                <Path d="M12 16v-4M12 8h.01" {...p} />
              </>
            );
          case 'left':
            return <Path d="m15 18-6-6 6-6" {...p} />;
          case 'right':
            return <Path d="m9 18 6-6-6-6" {...p} />;
          case 'chevUp':
            return <Path d="m18 15-6-6-6 6" {...p} />;
          case 'clip':
            return <Path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" {...p} />;
          case 'camera':
            return (
              <>
                <Path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" {...p} />
                <Circle cx={12} cy={13} r={3} {...p} />
              </>
            );
          case 'image':
            return (
              <>
                <Rect x={3} y={3} width={18} height={18} rx={2} {...p} />
                <Circle cx={9} cy={9} r={2} {...p} />
                <Path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" {...p} />
              </>
            );
          case 'check':
            return <Path d="M20 6 9 17l-5-5" {...p} />;
          case 'checkCircle':
            return (
              <>
                <Circle cx={12} cy={12} r={10} {...p} />
                <Path d="m9 12 2 2 4-4" {...p} />
              </>
            );
          case 'package':
            return (
              <>
                <Path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" {...p} />
                <Path d="M12 22V12M3.3 7 12 12l8.7-5" {...p} />
              </>
            );
        }
      })()}
    </Svg>
  );
}
