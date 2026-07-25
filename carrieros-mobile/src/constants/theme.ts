/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

// Brand palette — MIRROR of carrieros-web/app/globals.css's `@theme` block,
// which is the source of truth. `carrieros-web/scripts/check-tokens.mjs`
// fails the build if these drift from it. (This comment used to name
// `docs/design/design-tokens.md` as canonical and point at a
// `carrieros-web/tailwind.config.ts` — neither file exists; web is on
// Tailwind v4 CSS-first config.)
//
// Values updated 2026-07-25 to the mockup set's bespoke palette. Web's dark
// page/card treatment still applies ONLY to carrieros-web — mobile screens
// use light/white cards, so Colors.light below stays on that direction, and
// Colors.dark (OS dark-mode) is a branded-navy variant of the light-mobile
// card idea, not a port of web's dark theme.
//
// The 16-file `const ORANGE = '#f97316'` cluster (and a handful of inline
// hex sites) that shadowed this export instead of importing it was swept
// 2026-07-25 — every screen now does `const ORANGE = BrandColors.orange`,
// so this file is finally load-bearing rather than descriptive-only.
export const BrandColors = {
  navy: '#0f1e35',
  navyMid: '#182c46',
  navyLight: '#1f3a58',
  navyCard: '#162033',
  navyMuted: '#4b5a6e',
  orange: '#f47920',
  orangeHover: '#e06f1d',
  // Mockup `--orange-lt`. NOTE: distinct from StatusColors.orangeLight
  // below, which is a pale pastel *badge background* (#fff0e6), not a
  // lighter brand orange. They are not interchangeable.
  orangeLight: '#f9a55a',
  grayLight: '#d6e0ea',
} as const;

// Mockup radius scale (`--radius` / `--radius-sm`) — RN needs numbers, not
// CSS lengths. Mirrors web's --radius-card (14px) and rounded-lg (8px).
export const Radius = {
  card: 14,
  sm: 8,
} as const;

// Semantic + status colors, mirroring carrieros-web's STATUS_COLOR mapping
// (app/(app)/loads/page.tsx) and design-tokens.md's "Badges / Status Chips"
// pastel-bg/dark-text pairs. Used for load status pills across the app.
export const StatusColors = {
  success: '#2ecc71',
  successLight: '#e8f9f1',
  successDark: '#1a9e5c',
  warning: '#d97706',
  // warningLight/warningDark were #fff7e0/#b37d00 here vs #fff7ed/#9a3412 on
  // web — a pre-existing drift from before either file was checked against
  // the other. Resolved toward web (the source of truth), 2026-07-25.
  warningLight: '#fff7ed',
  warningDark: '#9a3412',
  danger: '#dc2626',
  dangerLight: '#fdecea',
  dangerDark: '#c0392b',
  teal: '#1abc9c',
  tealLight: '#e6faf5',
  tealDark: '#128f76',
  info: '#1a5eb8',
  infoLight: '#e8f0fe',
  orange: '#f47920',
  orangeLight: '#fff0e6',
  orangeDark: '#c05a00',
  purple: '#6c3abf',
  purpleLight: '#f3eeff',
  gray: '#6b7a8f',
  grayLight: '#f4f6f9',
} as const;

// Load status -> pill {bg, text}, matching carrieros-web's per-status hues
// (carrieros-web/lib/domain/load-status.ts) via design-tokens.md's badge
// pairs. Rule A of docs/architecture-principles.md, mirrored here per that
// doc's "mirror the module in both apps for now" note (no shared TS package
// between web and mobile today) — built from an exhaustive switch so a new
// loads.status CHECK value with no matching case here is a compile error,
// not a silent fallback.
//
// Fixed a real bug while doing this (2026-07-22): this map had no
// `cancelled` entry (added to loads.status by Phase 3A), so a cancelled
// load's pill silently fell back to `.draft`'s gray — displaying as if the
// load were still a draft, not cancelled. An exhaustive switch makes this
// exact class of bug a compile error going forward.
type LoadStatus =
  | 'draft' | 'scheduled' | 'dispatched' | 'picked_up' | 'in_transit'
  | 'delivered' | 'invoiced' | 'paid' | 'cancelled' | 'declined';

function loadStatusPill(status: LoadStatus): { bg: string; text: string } {
  switch (status) {
    case 'draft': return { bg: StatusColors.grayLight, text: StatusColors.gray };
    case 'scheduled': return { bg: StatusColors.infoLight, text: StatusColors.info };
    case 'dispatched': return { bg: StatusColors.orangeLight, text: StatusColors.orangeDark };
    case 'picked_up': return { bg: StatusColors.warningLight, text: StatusColors.warningDark };
    case 'in_transit': return { bg: StatusColors.tealLight, text: StatusColors.tealDark };
    case 'delivered': return { bg: StatusColors.successLight, text: StatusColors.successDark };
    case 'invoiced': return { bg: StatusColors.purpleLight, text: StatusColors.purple };
    case 'paid': return { bg: StatusColors.successLight, text: StatusColors.successDark };
    case 'cancelled': return { bg: StatusColors.dangerLight, text: StatusColors.dangerDark };
    case 'declined': return { bg: StatusColors.dangerLight, text: StatusColors.dangerDark };
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

const LOAD_STATUSES: readonly LoadStatus[] = [
  'draft', 'scheduled', 'dispatched', 'picked_up', 'in_transit',
  'delivered', 'invoiced', 'paid', 'cancelled', 'declined',
];

// Record-based lookup preserved for existing call sites
// (`LOAD_STATUS_PILL[status] ?? LOAD_STATUS_PILL.draft`) — indexed by an
// arbitrary/possibly-invalid string off a DB row typed as `string`, same
// fallback-to-draft treatment as before this fix, just now impossible to
// silently miss a real status value.
export const LOAD_STATUS_PILL: Record<string, { bg: string; text: string }> = Object.fromEntries(
  LOAD_STATUSES.map((s) => [s, loadStatusPill(s)])
);

// Vehicle status -> pill {bg, text}, same pastel-bg/dark-text convention as
// LOAD_STATUS_PILL above. Used by the Fleet tab and Home's fleet-status
// summary (Owner/Solo/Dispatcher). Mirrors
// carrieros-web/lib/domain/vehicle-status.ts.
type VehicleStatus = 'active' | 'idle' | 'in_shop';

function vehicleStatusPill(status: VehicleStatus): { bg: string; text: string } {
  switch (status) {
    case 'active': return { bg: StatusColors.successLight, text: StatusColors.successDark };
    case 'idle': return { bg: StatusColors.grayLight, text: StatusColors.gray };
    case 'in_shop': return { bg: StatusColors.warningLight, text: StatusColors.warningDark };
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

const VEHICLE_STATUSES: readonly VehicleStatus[] = ['active', 'idle', 'in_shop'];

export const VEHICLE_STATUS_PILL: Record<string, { bg: string; text: string }> = Object.fromEntries(
  VEHICLE_STATUSES.map((s) => [s, vehicleStatusPill(s)])
);

// Invoice status -> pill {bg, text}, same convention. Used by the Invoices
// tab and Finance's Home content. Mirrors
// carrieros-web/lib/domain/invoice-status.ts.
type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue';

function invoiceStatusPill(status: InvoiceStatus): { bg: string; text: string } {
  switch (status) {
    case 'draft': return { bg: StatusColors.grayLight, text: StatusColors.gray };
    case 'sent': return { bg: StatusColors.infoLight, text: StatusColors.info };
    case 'paid': return { bg: StatusColors.successLight, text: StatusColors.successDark };
    case 'overdue': return { bg: StatusColors.dangerLight, text: StatusColors.dangerDark };
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

const INVOICE_STATUSES: readonly InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue'];

export const INVOICE_STATUS_PILL: Record<string, { bg: string; text: string }> = Object.fromEntries(
  INVOICE_STATUSES.map((s) => [s, invoiceStatusPill(s)])
);

// get_exceptions() tier -> pill {bg, text}, same pastel-bg/dark-text
// convention as the pills above, and the same today=danger/this_week=warning/
// upcoming=info semantic mapping carrieros-web's dashboard uses for the same
// three tiers (app/(app)/exceptions/page.tsx's TIER_COLOR). Used by the
// Alerts tab's tier badges and the inline exception chips on Fleet/Customers.
export const EXCEPTION_TIER_PILL: Record<string, { bg: string; text: string }> = {
  today: { bg: StatusColors.dangerLight, text: StatusColors.dangerDark },
  this_week: { bg: StatusColors.warningLight, text: StatusColors.warningDark },
  upcoming: { bg: StatusColors.infoLight, text: StatusColors.info },
};

export const Colors = {
  light: {
    // Navy-as-body-text on light mobile cards — tracks BrandColors.navy.
    text: BrandColors.navy,
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
