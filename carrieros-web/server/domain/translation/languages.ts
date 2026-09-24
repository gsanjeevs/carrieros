// server/domain/translation/languages.ts
// Locale code -> display name, for the translation prompt: an LLM translates
// "into Urdu" far more reliably than "into ur". Must stay in sync with
// i18n/request.ts's SUPPORTED_LOCALES and server/contract/schemas.ts's
// TranslateMessageBodySchema enum by hand (this file is domain-pure, no I/O,
// so it cannot import either).
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  pa: 'Punjabi',
  ur: 'Urdu',
}

export function languageNameFor(code: string): string {
  return LANGUAGE_NAMES[code] ?? code
}
