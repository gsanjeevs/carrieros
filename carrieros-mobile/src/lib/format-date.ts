// src/lib/format-date.ts
// Shared date/time formatters -- the locale-aware counterpart to
// format-money.ts. Screens were previously calling
// `new Date(x).toLocaleDateString()`/`.toLocaleString()` directly with no
// locale argument, which silently used the device's locale instead of the
// user's chosen `profiles.preferred_language` (src/hooks/use-locale.tsx).
// `src/app/dvir-history/index.tsx`'s `new Date(item.submitted_at).toLocaleDateString(locale)`
// was the one call site that already did this correctly -- these helpers
// generalize that pattern so every other screen has one obvious function to
// call instead of reinventing it (and so the lint guard in eslint.config.js
// has a small set of files it needs to allow-list).
import type { Locale } from '@/lib/i18n';

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

// Date only, e.g. "9/19/2026" (en) -- for submitted_at/created_at stamps
// shown without a time component.
export function formatDate(
  value: string | number | Date,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions
): string {
  return toDate(value).toLocaleDateString(locale, options);
}

// Date + time, e.g. "9/19/2026, 3:45 PM" (en) -- for timestamps like
// invoice sent_at/opened_at/paid_at or load event created_at.
export function formatDateTime(
  value: string | number | Date,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions
): string {
  return toDate(value).toLocaleString(locale, options);
}
