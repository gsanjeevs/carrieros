// server/domain/profile/preferences.ts
// The closed value sets for personal display preferences. They mirror the CHECK
// constraints on profiles (language/uom/date/time/theme); the contract derives
// its enums from here, so an out-of-range value is rejected at the edge with a
// 400 instead of surfacing as a database constraint error.
// Widened from 4 to 24 codes (2026-09-27, migration 0054, US trucking
// workforce language expansion) -- keep in sync with the two CHECK
// constraints (carrier_details.default_language, profiles.preferred_language)
// and the `languages` reference table.
export const LANGUAGES = [
  'en', 'es', 'pa', 'ur',
  'ru', 'uk', 'mn', 'ar', 'so', 'ht', 'pt', 'vi', 'zh', 'ko',
  'tl', 'fr', 'pl', 'ro', 'de', 'hi', 'gu', 'am', 'fa', 'ne',
] as const
export const UOM_SYSTEMS = ['imperial', 'metric'] as const
export const DATE_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'] as const
export const TIME_FORMATS = ['12h', '24h'] as const
export const THEMES = ['light', 'dark', 'system'] as const

export interface PreferencesPatch {
  readonly preferred_language?: (typeof LANGUAGES)[number]
  /** null = inherit the organization's setting. */
  readonly uom_system?: (typeof UOM_SYSTEMS)[number] | null
  readonly date_format?: (typeof DATE_FORMATS)[number]
  readonly time_format?: (typeof TIME_FORMATS)[number]
  readonly theme_preference?: (typeof THEMES)[number]
  /** IANA zone name (e.g. 'America/Los_Angeles'), validated against
   *  Intl.supportedValuesOf('timeZone') at the edge. null = inherit the
   *  organization's carrier_details.timezone default. */
  readonly timezone?: string | null
}
