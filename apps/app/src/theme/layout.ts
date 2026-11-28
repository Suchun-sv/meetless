import { useWindowDimensions } from 'react-native';
import { layout } from './tokens';

export interface LayoutInfo {
  width: number;
  height: number;
  /** Phone layout: drawer nav, sheets, one column. */
  phone: boolean;
  /** Wide enough for a side pane next to the content. */
  wide: boolean;
}

/** Window-based breakpoints. Screens that need their own width use onLayout (container width). */
export function useLayout(): LayoutInfo {
  const { width, height } = useWindowDimensions();
  return { width, height, phone: width < layout.phoneMax, wide: width >= 1100 };
}
