import Svg, { Circle, Line, Path } from 'react-native-svg';
import type { ArtifactKind } from '@meetless/core';
import { colors } from '@/theme';

/** Lucide line icons used by A4's phone screens (24 grid, stroke 2), drawn with react-native-svg. */
export type IconName = 'notebook-pen' | 'git-branch' | 'file-text' | 'presentation' | 'chevron-right' | 'plus';

const PATHS: Record<IconName, string[]> = {
  'notebook-pen': [
    'M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4',
    'M2 6h4',
    'M2 10h4',
    'M2 14h4',
    'M2 18h4',
    'M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z',
  ],
  'git-branch': ['M18 9a9 9 0 0 1-9 9'],
  'file-text': ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4', 'M10 9H8', 'M16 13H8', 'M16 17H8'],
  presentation: ['M2 3h20', 'M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3', 'm7 21 5-5 5 5'],
  'chevron-right': ['m9 18 6-6-6-6'],
  plus: ['M5 12h14', 'M12 5v14'],
};

export function Icon({ name, size = 18, color = colors.textTertiary }: { name: IconName; size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {name === 'git-branch' ? (
        <>
          <Line x1={6} x2={6} y1={3} y2={15} />
          <Circle cx={18} cy={6} r={3} />
          <Circle cx={6} cy={18} r={3} />
        </>
      ) : null}
      {PATHS[name].map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
}

export const ARTIFACT_ICON: Record<ArtifactKind, IconName> = {
  notion: 'notebook-pen',
  code: 'git-branch',
  overleaf: 'file-text',
  pdf: 'file-text',
  docx: 'file-text',
  pptx: 'presentation',
};
