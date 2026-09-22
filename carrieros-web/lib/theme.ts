// lib/theme.ts
// Shared Light/Dark/System theme-preference helpers (decisions.md V3/V6).
// Deliberately hand-rolled, not `next-themes` — no theme-toggling library
// was already a dependency of this app (checked before adding one, per this
// decision's own "prefer reusing what's there" instruction), and
// carrieros-mobile's own theme hook (src/hooks/use-theme.tsx) is already a
// hand-rolled equivalent, so this mirrors that rather than introducing a
// second, differently-shaped mechanism for the same concept.
//
// Resolution mirrors i18n/request.ts's `locale` cookie exactly (same
// reasoning: Server Components can't read profiles.theme_preference and set
// a cookie in the same pass, so proxy.ts — which already does this for
// `locale`, decisions.md L2 — syncs a `theme` cookie from
// profiles.theme_preference on every authenticated request; app/layout.tsx
// just reads it, no extra DB round trip per render). ThemeSwitcher.tsx also
// writes the cookie directly on selection (same as LanguageSwitcher does for
// `locale`) so the change is instant rather than waiting for the next
// middleware pass. 'system' can only be resolved on the client (the server
// doesn't know the visitor's OS preference) — THEME_BOOTSTRAP_SCRIPT below
// runs before paint to correct the class in that one case, so there's no
// flash-of-wrong-theme for the two explicit choices and only a same-frame
// correction for 'system'.
export type ThemePreference = 'light' | 'dark' | 'system'

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'light' || v === 'dark' || v === 'system'
}

/**
 * Server-safe resolution: 'light' -> no `dark` class, 'dark' -> `dark`
 * class, 'system' -> `dark` (the app's existing, pre-this-feature default
 * look — see THEME_BOOTSTRAP_SCRIPT for the client-side correction once the
 * real OS preference is known). This is what keeps every existing/new user
 * who has never touched the picker looking exactly like they do today.
 */
export function serverResolvedClass(pref: ThemePreference): 'dark' | '' {
  return pref === 'light' ? '' : 'dark'
}

/**
 * Client-only: resolves 'system' via matchMedia and applies the class to
 * <html> immediately (no reload). Used both by ThemeSwitcher.tsx (on
 * selection) and mirrored, as an inline string, by THEME_BOOTSTRAP_SCRIPT
 * (on first paint, before this module could ever be loaded/hydrated).
 */
export function applyTheme(pref: ThemePreference): void {
  if (typeof document === 'undefined') return
  const dark =
    pref === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : pref === 'dark'
  document.documentElement.classList.toggle('dark', dark)
}

/**
 * A self-contained (no module imports — it runs before hydration) inline
 * script, only emitted when the resolved preference is 'system'. Flips the
 * `dark` class the server conservatively set (see serverResolvedClass)
 * to match the real OS preference, synchronously and before first paint —
 * the same no-flash technique `next-themes` uses, reimplemented by hand
 * since that package isn't a dependency here.
 */
export const THEME_BOOTSTRAP_SCRIPT = `
(function(){
  try {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches !== true) {
      document.documentElement.classList.remove('dark');
    }
  } catch (e) {}
})();
`
