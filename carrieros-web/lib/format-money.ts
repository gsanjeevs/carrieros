// lib/format-money.ts
// Single money-rendering convention for the app. ALWAYS 2 decimal places —
// `Number(x).toLocaleString()` (used elsewhere for load rates) renders
// 1850.50 as "$1,850.5", which is wrong for anything invoice-shaped.

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
