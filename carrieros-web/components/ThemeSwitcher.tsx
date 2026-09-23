// components/ThemeSwitcher.tsx
'use client'
// Light/Dark/System appearance picker — decisions.md V3 ("a real, real,
// user-selectable Light/Dark/System theme preference... Sidebar/chrome
// stays fixed dark navy in both modes... badges and brand-orange stay
// identical across both themes") and V6 (which found V3 was decided but
// never actually built for either app — the schema column, the
// /api/v1/me/preferences read/write support, and carrieros-mobile's own
// Settings → Appearance picker all already existed before this file did;
// this is the missing web half).
//
// Mirrors LanguageSwitcher.tsx's pattern: applies optimistically (no
// waiting on the network to see the result), persists via the same
// /api/v1/me/preferences endpoint mobile already uses (server/domain/
// profile/preferences.ts's THEMES enum), and writes a cookie so the next
// server render (this page or any other) already knows the answer without
// waiting on a DB round trip. Unlike language, switching theme does NOT
// reload the page — appearance is applied live via applyTheme() below, the
// same class-toggle app/layout.tsx's inline bootstrap script performs on
// first paint.
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { SegmentedControl } from '@/components/ui'
import { apiClient } from '@/lib/api-client'
import { applyTheme, type ThemePreference } from '@/lib/theme'

export default function ThemeSwitcher({
  current,
}: {
  current: ThemePreference
}) {
  const t = useTranslations('settings')
  // Local state, not just the `current` prop directly — this component
  // deliberately never reloads the page on selection (unlike
  // LanguageSwitcher), so without this the SegmentedControl's active pill
  // would stay stuck on whatever was server-rendered at page load even
  // after a real, successfully-applied selection (caught live: clicking
  // Light/Dark visibly changed the page's colors but the control kept
  // showing "System" highlighted until a manual reload).
  const [selected, setSelected] = useState<ThemePreference>(current)

  async function select(next: string) {
    const pref = next as ThemePreference
    if (pref === selected) return

    // Apply immediately — a theme picker should never feel like it's
    // waiting on a network round trip (same reasoning as the mobile
    // hook's "apply optimistically" comment in use-theme.tsx).
    setSelected(pref)
    applyTheme(pref)
    document.cookie = `theme=${pref};path=/;max-age=${60 * 60 * 24 * 365}`

    try {
      await apiClient.http.PATCH('/api/v1/me/preferences', { body: { theme_preference: pref } })
    } catch {
      /* offline: the cookie + live DOM change still apply */
    }
  }

  const items = [
    { value: 'light', label: t('appearanceLight') },
    { value: 'dark', label: t('appearanceDark') },
    { value: 'system', label: t('appearanceSystem') },
  ]

  return (
    <div>
      <label className="block text-xs font-medium text-text-sec mb-1.5">{t('appearanceSection')}</label>
      <p className="text-xs text-text-mut mb-2.5">{t('appearanceSubtitle')}</p>
      <SegmentedControl items={items} value={selected} onChange={select} />
    </div>
  )
}
