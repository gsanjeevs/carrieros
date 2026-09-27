// lib/format-money.ts
// Single money-rendering convention for the app. ALWAYS 2 decimal places —
// `Number(x).toLocaleString()` (used elsewhere for load rates) renders
// 1850.50 as "$1,850.5", which is wrong for anything invoice-shaped.

// Rule I — every locale-varying value resolves through one inheritance
// chain, never a literal fallback typed inline at each call site (the same
// discipline preferred_language/uom_system already follow). Currency has no
// per-user override column (unlike uom_system) — it is purely an
// organization-level setting — so the chain here is just "the org's
// currency, or USD if the org row/column isn't available yet" (e.g. during
// onboarding before the org exists, or a query that only partially
// selected the org). Every `org?.currency ?? 'USD'` call site should call
// this instead of repeating the literal.
//
// This is deliberately NOT the same function as
// server/domain/onboarding/draft.ts's deriveDefaultCurrency: that one picks
// the country-appropriate default for a BRAND NEW org that doesn't have a
// `currency` column value yet (CA -> CAD, MX -> MXN, else USD) — a one-time
// "what do we default new orgs to" decision. This one resolves an
// EXISTING org's already-stored currency for ongoing rendering, and its
// ultimate fallback is always USD regardless of country.
export function resolveCurrency(orgCurrency: string | null | undefined): string {
  return orgCurrency ?? 'USD'
}

export function formatMoney(
  value: number | string | null | undefined,
  currency = 'USD',
  locale = 'en-US'
): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return '—'
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}
