// lib/design-tokens.ts
// Raw hex values for the small number of call sites that need a literal hex
// string at runtime (not a Tailwind class) — mainly the dashboard KPI
// cards' `${color}20` hex-alpha suffix trick for a translucent background,
// which can't be expressed as a Tailwind utility class or a `var(--color-*)`
// reference (you can't append a hex-alpha suffix to a CSS custom property).
//
// MUST be kept in sync with app/globals.css's `@theme` block by hand — this
// is a deliberate, narrow exception to "always use the Tailwind token
// class," not a second source of truth to grow. Prefer the real Tailwind
// class (`bg-brand-orange`, `text-teal`, etc.) everywhere a literal hex
// string isn't structurally required. Added 2026-07-24 (raw-hex audit) to
// stop these values being hand-copied per file.
export const NAVY = '#0f1923'
export const BRAND_ORANGE = '#f97316'
export const BRAND_ORANGE_HOVER = '#ea6c0a'
export const SUCCESS = '#16a34a'
export const WARNING = '#d97706'
export const DANGER = '#dc2626'
export const TEAL = '#1abc9c'
export const TEAL_HOVER = '#16a085'
export const INFO = '#1a5eb8'
export const PURPLE = '#6c3abf'
export const BRAND_BLUE = '#2563eb'
export const BRAND_BLUE_DARK = '#1a3a8a'
export const SLATE = '#64748b'
export const SLATE_LIGHT = '#94a3b8'
export const SLATE_DARK = '#374151'
export const SCORE_WARNING = '#f59e0b'
export const SCORE_CRITICAL = '#f43f5e'
