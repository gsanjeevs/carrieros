// src/lib/format-money.ts
// Mirrors carrieros-web/lib/format-money.ts's role (a shared formatter
// rather than each screen hand-rolling `$${n.toFixed(2)}`), scoped to USD
// for now -- no multi-currency call site exists in mobile yet, unlike web's
// version which already threads a `currency` param through from
// carrier_details.
//
// `locale` is required (not defaulted) so every call site is forced to
// thread through the value from useLocale() rather than silently falling
// back to the device's locale -- that silent fallback (via a bare
// `.toLocaleString()`/`undefined` locale) was the original bug this file
// existed to fix. Intl.NumberFormat's `style: 'currency'` also replaces the
// old hardcoded `$` string prefix, which broke for any locale using a
// different currency symbol placement or symbol.
import type { Locale } from '@/lib/i18n';

export function formatMoney(amount: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
