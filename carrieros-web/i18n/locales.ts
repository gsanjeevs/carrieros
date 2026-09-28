// Widened from 4 to 24 codes (2026-09-27, migration 0054, US trucking
// workforce language expansion) — keep in sync with
// server/domain/profile/preferences.ts's LANGUAGES (the CHECK-constraint
// mirror for profiles.preferred_language / carrier_details.default_language),
// the `languages` reference table, and messages/*.json (one file per code
// here). This was left at the old 4-code list when the translations and the
// `languages` table rows landed — LanguageSwitcher/LanguagePicker filter
// against this constant, so leaving it stale silently capped the UI at 4
// languages regardless of how many the DB and message catalogs supported.
export const SUPPORTED_LOCALES = [
  'en', 'es', 'pa', 'ur',
  'ru', 'uk', 'mn', 'ar', 'so', 'ht', 'pt', 'vi', 'zh', 'ko',
  'tl', 'fr', 'pl', 'ro', 'de', 'hi', 'gu', 'am', 'fa', 'ne',
] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
// Arabic and Persian/Farsi joined the supported set in the same expansion as
// Urdu's existing RTL entry — all three are RTL scripts. app/layout.tsx
// reads this to set <html dir="...">.
export const RTL_LOCALES: Locale[] = ['ur', 'ar', 'fa']
