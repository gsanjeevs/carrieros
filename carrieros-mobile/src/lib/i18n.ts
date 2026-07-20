// src/lib/i18n.ts
// i18n-js setup for the 4 supported locales (decisions.md L1/L2). This is the
// mobile-side counterpart to carrieros-web/i18n — same source column
// (profiles.preferred_language), separate runtime, separate library
// (i18n-js here vs. whatever the web app uses), because these are two
// different app shells that just happen to share a Supabase project.
import { I18n } from 'i18n-js';

import en from '@/messages/en.json';
import es from '@/messages/es.json';
import pa from '@/messages/pa.json';
import ur from '@/messages/ur.json';

export const SUPPORTED_LOCALES = ['en', 'es', 'pa', 'ur'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const RTL_LOCALES: readonly Locale[] = ['ur'];

export function isRTLLocale(locale: Locale): boolean {
  return RTL_LOCALES.includes(locale);
}

export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

const i18n = new I18n({ en, es, pa, ur });
i18n.defaultLocale = 'en';
i18n.locale = 'en';
i18n.enableFallback = true;

export function setI18nLocale(locale: Locale) {
  i18n.locale = locale;
}

export { i18n };

// Bound translate — always reads i18n.locale at call time, so this stays
// correct after setI18nLocale() runs. Screens should get this via
// useLocale() (src/hooks/use-locale.tsx) rather than importing i18n
// directly, so they re-render when the locale changes.
export function t(scope: string, options?: Record<string, unknown>): string {
  return i18n.t(scope, options);
}
