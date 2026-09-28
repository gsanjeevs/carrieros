// lib/domain/branding.ts
// Enterprise branding customization (decisions.md PR1 amendment) — the ONE
// place that turns "an org's resolved branding tokens" into a CSS override,
// matching Rule A's single-resolver principle (architecture-principles.md)
// applied here to brand colors rather than status colors. Every entry point
// that needs to reskin the app shell or the public tracking page calls this
// same function — never hand-builds its own style object per page.
//
// app/globals.css's `@theme` block declares --color-brand-orange/--color-teal
// as real CSS custom properties, which is what lets Tailwind's generated
// bg-brand-orange/text-brand-orange/bg-teal/text-teal utilities be overridden
// at runtime: setting the same custom property on a wrapping element cascades
// to every descendant utility class that references it via var(...), with no
// per-component change needed. HEX_PATTERN mirrors the CHECK constraint on
// carrier_details.brand_primary_color/brand_accent_color (migration 0026) —
// values are validated at write time (the API route) and re-validated here so
// a corrupted/legacy value can never end up as unescaped CSS.
//
// Kept framework-agnostic (no React/Next import) per lib/domain's own
// convention (Rule B/D) — callers cast the returned plain object to
// React.CSSProperties themselves. See lib/branding.ts for the authenticated
// resolver that fetches these tokens, and app/track/[token]/page.tsx's own
// header comment for why the public tracking page fetches them differently
// (no auth session) while still funneling through this same function.
const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/

function linearize(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** Return the higher-contrast black/white text color for a brand surface. */
export function brandForegroundColor(hex: string): '#000000' | '#ffffff' {
  if (!HEX_PATTERN.test(hex)) return '#000000'
  const red = linearize(Number.parseInt(hex.slice(1, 3), 16))
  const green = linearize(Number.parseInt(hex.slice(3, 5), 16))
  const blue = linearize(Number.parseInt(hex.slice(5, 7), 16))
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
  const whiteContrast = 1.05 / (luminance + 0.05)
  const blackContrast = (luminance + 0.05) / 0.05
  return whiteContrast > blackContrast ? '#ffffff' : '#000000'
}

export interface BrandingTokens {
  primaryColor: string | null
  accentColor: string | null
}

export function brandingCssVars(tokens: BrandingTokens): Record<string, string> {
  const vars: Record<string, string> = {}
  if (tokens.primaryColor && HEX_PATTERN.test(tokens.primaryColor)) {
    vars['--color-brand-orange'] = tokens.primaryColor
    // Override the Tailwind theme property directly on the tenant wrapper:
    // the `--color-*` utility value is already computed/inherited at :root.
    vars['--color-brand-on-primary'] = brandForegroundColor(tokens.primaryColor)
  }
  if (tokens.accentColor && HEX_PATTERN.test(tokens.accentColor)) {
    vars['--color-teal'] = tokens.accentColor
    vars['--color-brand-on-accent'] = brandForegroundColor(tokens.accentColor)
  }
  return vars
}

export function isValidBrandColor(value: string): boolean {
  return HEX_PATTERN.test(value)
}
