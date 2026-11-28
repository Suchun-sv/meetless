/**
 * Meetless v4 design tokens, ported from apps/desktop/src/renderer/styles/tokens.css (values approved
 * 2026-11-24). Use these, never raw colours. Violet (`ai`, `aiBg`) is reserved for AI and rule output.
 */
export const colors = {
  // surfaces
  bg: '#FBFBFA',
  sidebar: '#F5F4F0',
  surface: '#F2F1ED',
  hover: '#EDECE8',
  selected: '#E7E6E1',
  scrim: 'rgba(28,27,25,0.22)',
  // text
  text: '#1C1B19',
  textSecondary: '#787774',
  textTertiary: '#9B9A96',
  textInverse: '#FFFFFF',
  // lines
  border: '#EAEAEA',
  borderStrong: '#D8D7D3',
  focus: '#1C1B19',
  /** mobile-v1: 0.5px separators that start at the text (m.css .hair). */
  hairline: 'rgba(28,27,25,0.12)',
  /** mobile-v1: the translucent tab bar background. */
  bar: 'rgba(251,251,250,0.92)',
  /** mobile-v1: sheets and cards on phones are white over the bg. */
  sheet: '#FFFFFF',
  // AI (violet, AI and rule output only)
  ai: '#6A4FA3',
  aiBg: '#F1EDF8',
  // status: dark text on a pastel tint
  info: '#1F6C9F',
  infoBg: '#E7F1F8',
  success: '#346538',
  successBg: '#EDF3EC',
  warning: '#956400',
  warningBg: '#FBF3DB',
  danger: '#9F2F2D',
  dangerBg: '#FDEBEC',
  /** Remaining-days levels (mine-v3, src/ui/urgency.ts): orange 3 to 7 days, yellow 8 to 14, and the marks of the grey levels. */
  urgentOrange: '#B4541A',
  urgentOrangeBg: '#FBEEE4',
  urgentYellow: '#8F6A00',
  markGrey: '#B9B8B4',
  markFar: '#CFCEC9',
  /** Calendar days outside the shown month (mobile-v2). */
  otherMonth: '#C9C8C4',
  // avatars
  avatar: ['#B07D57', '#5A7DA3', '#A5698A', '#5C8868', '#4D878C', '#8A7657', '#7B8A4B', '#8C8A85'] as const,
} as const;

export type ColorName = Exclude<keyof typeof colors, 'avatar'>;

/** Status tones: text colour on its tint. */
export const tones = {
  neutral: { fg: colors.textSecondary, bg: colors.surface },
  info: { fg: colors.info, bg: colors.infoBg },
  success: { fg: colors.success, bg: colors.successBg },
  warning: { fg: colors.warning, bg: colors.warningBg },
  danger: { fg: colors.danger, bg: colors.dangerBg },
  ai: { fg: colors.ai, bg: colors.aiBg },
} as const;
export type Tone = keyof typeof tones;

export const fontSize = { xs: 12, sm: 13, base: 14, md: 15, lg: 17, xl: 20, '2xl': 28 } as const;
export type FontSize = keyof typeof fontSize;
export const leading = { tight: 1.25, normal: 1.6 } as const;
export const weight = { regular: '400', medium: '500', semibold: '600' } as const;
export type Weight = keyof typeof weight;
/** -0.02em, as a multiplier of the font size (React Native wants letterSpacing in px). */
export const trackingTight = -0.02;

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 } as const;
export type Space = keyof typeof space;

export const radius = { sm: 4, md: 6, lg: 8, xl: 12, full: 9999 } as const;
export const borderWidth = 1;
export const border = { width: borderWidth, color: colors.border, strong: colors.borderStrong } as const;

export const shadow = {
  sm: { shadowColor: '#1C1B19', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  md: { shadowColor: '#1C1B19', shadowOpacity: 0.05, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  lg: { shadowColor: '#1C1B19', shadowOpacity: 0.08, shadowRadius: 40, shadowOffset: { width: 0, height: 16 }, elevation: 4 },
} as const;

export const layout = {
  sidebar: 260,
  drawer: 420,
  topbar: 56,
  content: 768,
  /** Phone nav drawer: min(300, 86% of the window). */
  nav: 300,
  touchMin: 44,
  /** Below this window width the app uses the phone layout (design 2026-11-25 §7). */
  phoneMax: 760,
} as const;

export const motion = { fast: 120, normal: 180 } as const;
export const z = { drawer: 20, modal: 50, toast: 60 } as const;
