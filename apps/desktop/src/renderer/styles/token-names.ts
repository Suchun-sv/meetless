/**
 * The authoritative list of design tokens (contract §8). `tokens.css` defines exactly these on
 * `:root`; every stylesheet uses only these through `var(--…)`. Values come from the design doc's
 * visual tokens (docs/superpowers/specs/2026-11-24-meetless-v3-visual-tokens.md).
 */
export const TOKEN_NAMES = [
  // colour: surfaces
  '--color-bg',
  '--color-sidebar',
  '--color-surface',
  '--color-hover',
  '--color-selected',
  '--color-scrim',
  // colour: text
  '--color-text',
  '--color-text-secondary',
  '--color-text-tertiary',
  '--color-text-inverse',
  // colour: lines
  '--color-border',
  '--color-border-strong',
  '--color-focus',
  // colour: AI (violet, reserved for AI and rule output)
  '--color-ai',
  '--color-ai-bg',
  // colour: status (text colour, and the pastel tint it sits on)
  '--color-info',
  '--color-info-bg',
  '--color-success',
  '--color-success-bg',
  '--color-warning',
  '--color-warning-bg',
  '--color-danger',
  '--color-danger-bg',
  // colour: avatars
  '--color-avatar-1',
  '--color-avatar-2',
  '--color-avatar-3',
  '--color-avatar-4',
  '--color-avatar-5',
  '--color-avatar-6',
  '--color-avatar-7',
  '--color-avatar-8',
  // type
  '--font-sans',
  '--font-mono',
  '--text-xs',
  '--text-sm',
  '--text-base',
  '--text-md',
  '--text-lg',
  '--text-xl',
  '--text-2xl',
  '--leading-tight',
  '--leading-normal',
  '--weight-regular',
  '--weight-medium',
  '--weight-semibold',
  '--tracking-tight',
  // spacing
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--space-5',
  '--space-6',
  '--space-8',
  '--space-10',
  '--space-12',
  // radius
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-xl',
  '--radius-full',
  // border
  '--border-width',
  '--border',
  '--border-strong',
  // shadow
  '--shadow-sm',
  '--shadow-md',
  '--shadow-lg',
  // layout
  '--layout-sidebar',
  '--layout-drawer',
  '--layout-topbar',
  '--layout-content',
  // motion
  '--duration-fast',
  '--duration-normal',
  '--ease-standard',
  // stacking
  '--z-drawer',
  '--z-modal',
  '--z-toast',
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
