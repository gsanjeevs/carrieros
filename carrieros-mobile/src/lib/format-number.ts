// src/lib/format-number.ts
// Shared plain-number formatter (grouping separators etc.) -- the third
// leg alongside format-money.ts and format-date.ts. Non-currency,
// non-date numbers (odometer miles, fuel gallons, weight) were also being
// formatted with a bare `.toLocaleString()` (no locale argument) at several
// call sites, which has the same device-locale-instead-of-user-locale bug
// as the currency/date cases the original audit flagged -- e.g. grouping
// digits as "1,234" vs "1.234" depends on locale, not just translation.
import type { Locale } from '@/lib/i18n';

export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}
