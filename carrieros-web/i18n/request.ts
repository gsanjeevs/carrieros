// i18n/request.ts
// Locale is NOT URL-based (no /en/, /es/ path prefixes) — per decisions.md
// L2, language follows the user's profiles.preferred_language, not the URL
// or the company. proxy.ts syncs a `locale` cookie from that column on every
// authenticated request; this just reads the cookie, defaulting to 'en' for
// logged-out visitors (login page, public tracking page, etc).
import { cookies } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'

export const SUPPORTED_LOCALES = ['en', 'es', 'pa', 'ur'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const RTL_LOCALES: Locale[] = ['ur']

export default getRequestConfig(async () => {
  const store = await cookies()
  const raw = store.get('locale')?.value
  const locale: Locale = (SUPPORTED_LOCALES as readonly string[]).includes(raw ?? '')
    ? (raw as Locale)
    : 'en'

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})
