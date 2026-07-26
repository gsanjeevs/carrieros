// src/hooks/use-theme.tsx
// Appearance context: resolves the user's light/dark preference and hands
// every screen the matching palette from src/constants/theme.ts.
//
// Both themes are first-class and USER-selectable (Settings → Appearance),
// not OS-dictated. This file used to be a three-line `Colors[useColorScheme()]`
// with no preference at all, which meant the app rendered white on any
// light-mode device — the single biggest reason it never resembled the
// mockups, all of which are navy. 'system' is still offered, and is the
// default, but it is now one choice among three rather than the only
// behaviour.
//
// Two-tier persistence, deliberately:
//   - AsyncStorage is the FAST path. It's readable before any network call,
//     so the pre-login screens (welcome/login/signup) and cold starts theme
//     themselves correctly instead of flashing white and then correcting.
//   - profiles.theme_preference is the DURABLE path, so the choice follows
//     the user across devices — the same "personal prefs follow the user"
//     rule as preferred_language/uom_system (decisions.md L2).
// Writes go to both; reads prefer the profile once it arrives, since it's
// the cross-device truth.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { Colors } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'carrieros.themePreference';

function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'light' || v === 'dark' || v === 'system';
}

type ThemeContextValue = {
  /** The user's stored choice, including 'system'. */
  preference: ThemePreference;
  /** What 'system' actually resolved to — always concrete. */
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  // Fast path: local choice, available before any network round-trip.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && isThemePreference(stored)) setPreferenceState(stored);
      })
      // A themed app that can't read its preference should fall back to
      // 'system', not crash on a storage error.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Durable path. Depends on the stable `session?.user.id` primitive rather
  // than `session` — Supabase hands useSession() a new session object on
  // every auth event (token refresh, duplicate SIGNED_IN), and depending on
  // the object churns this effect endlessly. See the long comment in
  // use-onboarding-status.tsx: that exact mistake caused a reproduced
  // infinite render loop once already.
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('theme_preference')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const stored = data?.theme_preference;
        if (isThemePreference(stored)) {
          setPreferenceState(stored);
          // Re-seed the fast path so the NEXT cold start already knows.
          AsyncStorage.setItem(STORAGE_KEY, stored).catch(() => {});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const setPreference = useCallback(
    async (next: ThemePreference) => {
      // Apply optimistically: appearance should switch on tap, not after a
      // network round-trip.
      setPreferenceState(next);
      await AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      if (userId) {
        await supabase.from('profiles').update({ theme_preference: next }).eq('id', userId);
      }
    },
    [userId]
  );

  // 'unspecified' is RN's "device didn't say" — treat as light, matching the
  // previous behaviour of this hook.
  const resolved: ResolvedTheme =
    preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * The resolved palette. Unchanged signature from the original hook, so every
 * existing `const theme = useTheme()` call site keeps working — they now just
 * follow the user's choice instead of the OS.
 */
export function useTheme() {
  const ctx = useContext(ThemeContext);
  // Falls back to the light palette rather than throwing when no provider is
  // mounted. useTheme() is called from ~40 screens including ones rendered in
  // tests and in error paths above the provider; a hard throw there would
  // turn a missing provider into a blank screen instead of a themed one.
  if (!ctx) return Colors.light;
  return Colors[ctx.resolved];
}

/** The preference itself — for the Settings appearance picker. */
export function useThemePreference() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemePreference must be used within ThemeProvider');
  return ctx;
}
