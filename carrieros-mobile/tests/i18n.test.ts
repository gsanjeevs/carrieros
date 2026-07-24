// tests/i18n.test.ts
// Pure-predicate tests for src/lib/i18n.ts.
import { isRTLLocale, isSupportedLocale, setI18nLocale, SUPPORTED_LOCALES, t, type Locale } from '@/lib/i18n';

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

describe('pluralized translations', () => {
  afterEach(() => {
    setI18nLocale('en');
  });

  it.each(SUPPORTED_LOCALES)('offline.offlineWithQueue selects one/other and interpolates count (%s)', (locale) => {
    setI18nLocale(locale);

    const one = t('offline.offlineWithQueue', { count: 1 });
    const other = t('offline.offlineWithQueue', { count: 3 });

    expect(one).toContain('1');
    expect(other).toContain('3');
    expect(one).not.toMatch(/plural|\{count/);
    expect(other).not.toMatch(/plural|\{count/);
  });

  it.each(SUPPORTED_LOCALES)('offline.syncing selects one/other and interpolates count (%s)', (locale) => {
    setI18nLocale(locale);

    const one = t('offline.syncing', { count: 1 });
    const other = t('offline.syncing', { count: 3 });

    expect(one).toContain('1');
    expect(other).toContain('3');
    expect(one).not.toMatch(/plural|\{count/);
    expect(other).not.toMatch(/plural|\{count/);
  });

  it.each(SUPPORTED_LOCALES)(
    'dvir.photoUploadFailedWarning interpolates count but keeps identical wording for 1 vs 2 (%s)',
    (locale) => {
      setI18nLocale(locale);

      const one = t('dvir.photoUploadFailedWarning', { count: 1 });
      const two = t('dvir.photoUploadFailedWarning', { count: 2 });

      // Not ICU-broken (no literal "plural"/"{count" leaks through) — %{count}
      // substitution works fine, it just never varies the noun's wording.
      expect(one).toContain('1');
      expect(two).toContain('2');
      expect(one.replace('1', '2')).toBe(two);
    }
  );

});
