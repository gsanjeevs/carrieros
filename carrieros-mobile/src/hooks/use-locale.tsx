// src/hooks/use-locale.tsx
// Locale context: resolves profiles.preferred_language (same column the
// web app's parallel i18n effort reads/writes — locale follows the *user*,
// not the org, per decisions.md L2) and makes it available to every screen,
// alongside the matching i18n-js translator, RTL flag, and locale-specific
// font family (Punjabi/Urdu need custom fonts; English/Spanish use the
// system font — see src/constants/theme.ts Fonts).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { I18nManager, Platform } from 'react-native';

import {
  NotoSansGurmukhi_400Regular,
  NotoSansGurmukhi_700Bold,
  useFonts as useGurmukhiFonts,
} from '@expo-google-fonts/noto-sans-gurmukhi';
import {
  NotoNastaliqUrdu_400Regular,
  NotoNastaliqUrdu_700Bold,
  useFonts as useNastaliqFonts,
} from '@expo-google-fonts/noto-nastaliq-urdu';

import { useSession } from '@/hooks/use-session';
import { i18n, isRTLLocale, isSupportedLocale, setI18nLocale, t as translate, type Locale } from '@/lib/i18n';
import { apiClient } from '@/lib/api-client';
import { savePreferences } from '@/lib/profile-api';

type LocaleFontFamily = { regular: string; bold: string } | null;

export type Uom = 'imperial' | 'metric';
export type DateFormat = 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
export type TimeFormat = '12h' | '24h';

// Personal profile prefs beyond locale — same profiles columns the web app's
// /settings page reads/writes (uom_system is nullable: null means "inherit
// the carrier's default" from carrier_details.uom_system).
type ProfilePrefs = {
  uomSystem: Uom | null;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  orgDefaultUom: Uom;
};

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => Promise<void>;
  t: typeof translate;
  isRTL: boolean;
  fontsReady: boolean;
  fontFamily: LocaleFontFamily;
  prefs: ProfilePrefs;
  setUomSystem: (uom: Uom | null) => Promise<void>;
  setDateFormat: (format: DateFormat) => Promise<void>;
  setTimeFormat: (format: TimeFormat) => Promise<void>;
};

const DEFAULT_PREFS: ProfilePrefs = {
  uomSystem: null,
  dateFormat: 'MM/DD/YYYY',
  timeFormat: '12h',
  orgDefaultUom: 'imperial',
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

// Applies RTL direction for the given locale.
//
// Native (iOS/Android): I18nManager.allowRTL/forceRTL persist the flag to
// native storage, but the layout only actually mirrors after a full app
// restart — this is a well-documented React Native limitation, not
// something fixable from JS. Calling it here means the *next* launch picks
// up the right direction; nothing visibly changes in the current session.
// We still call it, because skipping it would mean the restart never picks
// up the change either.
//
// Web preview: react-native-web's I18nManager.allowRTL/forceRTL are no-ops
// (see node_modules/react-native-web/dist/exports/I18nManager) — there's no
// native module to persist a restart flag against in a browser tab. To make
// RTL verifiable in the web preview we also flip the DOM `dir` attribute
// directly, which the browser mirrors immediately. This is web-only glue for
// local testing; it has no effect on, and does not replace, the native
// restart requirement above.
function applyRTL(rtl: boolean) {
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  }
}

// Mounted only while locale === 'pa'. expo-font's useFonts only loads the
// font map it was given on its *first* effect run (it does not reload when
// the map changes — see node_modules/expo-font/src/FontHooks.ts), so rather
// than fight that we mount/unmount a dedicated loader per script and let its
// own effect fire fresh each time it (re)mounts.
function GurmukhiFontLoader({ onLoaded }: { onLoaded: (f: LocaleFontFamily) => void }) {
  const [loaded] = useGurmukhiFonts({ NotoSansGurmukhi_400Regular, NotoSansGurmukhi_700Bold });
  useEffect(() => {
    if (loaded) onLoaded({ regular: 'NotoSansGurmukhi_400Regular', bold: 'NotoSansGurmukhi_700Bold' });
  }, [loaded, onLoaded]);
  return null;
}

// Mounted only while locale === 'ur'.
function NastaliqFontLoader({ onLoaded }: { onLoaded: (f: LocaleFontFamily) => void }) {
  const [loaded] = useNastaliqFonts({ NotoNastaliqUrdu_400Regular, NotoNastaliqUrdu_700Bold });
  useEffect(() => {
    if (loaded) onLoaded({ regular: 'NotoNastaliqUrdu_400Regular', bold: 'NotoNastaliqUrdu_700Bold' });
  }, [loaded, onLoaded]);
  return null;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [locale, setLocaleState] = useState<Locale>('en');
  const [fontFamily, setFontFamily] = useState<LocaleFontFamily>(null);
  const [prefs, setPrefs] = useState<ProfilePrefs>(DEFAULT_PREFS);

  const applyLocale = useCallback((next: Locale) => {
    setI18nLocale(next);
    applyRTL(isRTLLocale(next));
    setFontFamily(null); // reset — the matching loader (if any) repopulates this
    setLocaleState(next);
  }, []);

  // Resolve profiles.preferred_language + uom_system/date_format/time_format,
  // and the carrier's uom_system default (for when uom_system is null), once
  // we have a session. Defaults to 'en'/imperial/MM-DD-YYYY/12h for brand-new
  // profiles (columns are nullable) or if the fetch fails.
  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      if (!session?.user.id) return;
      const { data: profile } = await apiClient.http.GET('/api/v1/me/preferences');
      if (cancelled) return;
      applyLocale(isSupportedLocale(profile?.preferred_language) ? profile.preferred_language : 'en');

      setPrefs({
        uomSystem: (profile?.uom_system as Uom | null) ?? null,
        dateFormat: (profile?.date_format as DateFormat) ?? 'MM/DD/YYYY',
        timeFormat: (profile?.time_format as TimeFormat) ?? '12h',
        orgDefaultUom: (profile?.org_default_uom_system as Uom | undefined) ?? 'imperial',
      });
    }
    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [session?.user.id, applyLocale]);

  const setLocale = useCallback(
    async (next: Locale) => {
      applyLocale(next);
      if (session?.user.id) {
        await savePreferences({ preferred_language: next });
      }
    },
    [session?.user.id, applyLocale]
  );

  const setUomSystem = useCallback(
    async (uom: Uom | null) => {
      setPrefs((p) => ({ ...p, uomSystem: uom }));
      if (session?.user.id) {
        await savePreferences({ uom_system: uom });
      }
    },
    [session?.user.id]
  );

  const setDateFormat = useCallback(
    async (format: DateFormat) => {
      setPrefs((p) => ({ ...p, dateFormat: format }));
      if (session?.user.id) {
        await savePreferences({ date_format: format });
      }
    },
    [session?.user.id]
  );

  const setTimeFormat = useCallback(
    async (format: TimeFormat) => {
      setPrefs((p) => ({ ...p, timeFormat: format }));
      if (session?.user.id) {
        await savePreferences({ time_format: format });
      }
    },
    [session?.user.id]
  );

  const isRTL = isRTLLocale(locale);
  const fontsReady = locale === 'en' || locale === 'es' ? true : fontFamily !== null;

  // `translate` (imported as `t`/`translate` from `@/lib/i18n`) is a stable
  // module-level function reference — it always reads the *current*
  // i18n.locale internally, so it stays correct if you call it directly.
  // But screens don't call it directly: they destructure `t` from
  // useLocale() and let the React Compiler auto-memoize JSX built from it.
  // The compiler's generated cache checks `$[i] !== t` to decide whether to
  // recompute a memoized JSX node — and since `translate`'s identity never
  // changes, that check is permanently false after the first render, so
  // t()-derived JSX gets frozen at whatever locale was active on first
  // mount, even though `t()` itself would return the right string if called
  // again. (This is exactly why a screen with an unrelated post-mount state
  // update — e.g. /load/[id] fetching its data — "looks" locale-reactive:
  // the other changed dependency forces that JSX node to recompute, which
  // incidentally re-invokes t() too. A screen with no such post-mount
  // update, like /dvir/[loadId], never gets that nudge and stays stuck on
  // its first-paint locale.)
  //
  // Fix: wrap it in a callback keyed on `locale` so `t`'s *identity* changes
  // exactly when the locale does. That gives the compiler's existing
  // `$[i] !== t` dependency check a real signal to invalidate on.
  const t = useCallback<typeof translate>((scope, options) => translate(scope, options), [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t,
      isRTL,
      fontsReady,
      fontFamily,
      prefs,
      setUomSystem,
      setDateFormat,
      setTimeFormat,
    }),
    [locale, setLocale, t, isRTL, fontsReady, fontFamily, prefs, setUomSystem, setDateFormat, setTimeFormat]
  );

  return (
    <LocaleContext.Provider value={value}>
      {locale === 'pa' && <GurmukhiFontLoader key="pa-font" onLoaded={setFontFamily} />}
      {locale === 'ur' && <NastaliqFontLoader key="ur-font" onLoaded={setFontFamily} />}
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within a LocaleProvider');
  return ctx;
}

// Escape hatch for the rare non-component call site (none currently) that
// needs a translation without hooks — prefer useLocale().t in screens so
// they re-render on locale change.
export { i18n };
