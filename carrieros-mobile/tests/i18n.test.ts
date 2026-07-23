// tests/i18n.test.ts
// Pure-predicate tests for src/lib/i18n.ts.
import { isRTLLocale, isSupportedLocale, SUPPORTED_LOCALES, type Locale } from '@/lib/i18n';

describe('isSupportedLocale', () => {
  it.each(SUPPORTED_LOCALES)('accepts "%s"', (locale) => {
    expect(isSupportedLocale(locale)).toBe(true);
  });

  it('rejects an unsupported locale string', () => {
    expect(isSupportedLocale('fr')).toBe(false);
  });

  it('rejects null and undefined', () => {
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isSupportedLocale('')).toBe(false);
  });
});

describe('isRTLLocale', () => {
  it('ur is RTL', () => {
    expect(isRTLLocale('ur' as Locale)).toBe(true);
  });

  it('en, es, pa are not RTL', () => {
    expect(isRTLLocale('en' as Locale)).toBe(false);
    expect(isRTLLocale('es' as Locale)).toBe(false);
    expect(isRTLLocale('pa' as Locale)).toBe(false);
  });
});
