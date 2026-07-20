/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

// Brand palette — see docs/design/design-tokens.md ("Color Palette" section).
// This is the canonical source; keep these in sync with
// carrieros-web/tailwind.config.ts if either changes.
//
// NOTE: design-tokens.md's "Dark Theme (Shipped)" section (added 2026-07-20)
// applies ONLY to carrieros-web — it documents web's decision to keep a
// dark navy page/card treatment instead of the lighter surface.* tokens.
// Mobile screens (load detail, DVIR) already use light/white cards per the
// doc's original surface.* spec, so Colors.light below stays on that
// direction. Colors.dark (OS dark-mode) is a branded-navy variant of the
// same light-mobile-card idea, not a port of web's dark theme.
export const BrandColors = {
  navy: '#0f1923',
  navyLight: '#1e3a5f',
  navyMuted: '#4b5a6e',
  orange: '#f97316',
} as const;

// Semantic + status colors, mirroring carrieros-web's STATUS_COLOR mapping
// (app/(app)/loads/page.tsx) and design-tokens.md's "Badges / Status Chips"
// pastel-bg/dark-text pairs. Used for load status pills across the app.
export const StatusColors = {
  success: '#16a34a',
  successLight: '#e8f9f1',
  successDark: '#1a9e5c',
  warning: '#d97706',
  warningLight: '#fff7e0',
  warningDark: '#b37d00',
  danger: '#dc2626',
  dangerLight: '#fdecea',
  dangerDark: '#c0392b',
  teal: '#1abc9c',
  tealLight: '#e6faf5',
  tealDark: '#128f76',
  info: '#1a5eb8',
  infoLight: '#e8f0fe',
  orange: '#f97316',
  orangeLight: '#fff0e6',
  orangeDark: '#c05a00',
  purple: '#6c3abf',
  purpleLight: '#f3eeff',
  gray: '#6b7a8f',
  grayLight: '#f4f6f9',
} as const;

// Load status -> pill {bg, text}, matching carrieros-web's per-status hues
// (app/(app)/loads/page.tsx STATUS_COLOR) via design-tokens.md's badge pairs.
export const LOAD_STATUS_PILL: Record<string, { bg: string; text: string }> = {
  draft: { bg: StatusColors.grayLight, text: StatusColors.gray },
  scheduled: { bg: StatusColors.infoLight, text: StatusColors.info },
  dispatched: { bg: StatusColors.orangeLight, text: StatusColors.orangeDark },
  picked_up: { bg: StatusColors.warningLight, text: StatusColors.warningDark },
  in_transit: { bg: StatusColors.tealLight, text: StatusColors.tealDark },
  delivered: { bg: StatusColors.successLight, text: StatusColors.successDark },
  invoiced: { bg: StatusColors.purpleLight, text: StatusColors.purple },
  paid: { bg: StatusColors.successLight, text: StatusColors.successDark },
};

export const Colors = {
  light: {
    text: '#0f1923',
    background: '#ffffff',
    // Nearly identical lightness to the old stock values (F0F0F3 / E0E1E6)
    // — swapped for the closest named design-tokens.md surface tokens
    // (surface.divider / surface.border) so load-detail and DVIR screens,
    // which rely on these for card/pill fills, don't visibly shift.
    backgroundElement: '#f1f3f8',
    backgroundSelected: '#e5e8ef',
    textSecondary: '#8898aa',
  },
  dark: {
    text: '#ffffff',
    background: BrandColors.navy,
    backgroundElement: BrandColors.navyLight,
    backgroundSelected: '#28496e',
    textSecondary: '#9fb3c8',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
