export const SUPPORTED_LOCALES = ['en', 'es', 'pa', 'ur'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const RTL_LOCALES: Locale[] = ['ur']
