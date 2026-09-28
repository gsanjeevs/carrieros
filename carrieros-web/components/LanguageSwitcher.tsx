'use client'
// components/LanguageSwitcher.tsx
// Shared language picker — PRD requires it available in Account Settings
// for all roles, plus as the first step of driver profile setup. For now
// this is also surfaced on /login (a logged-out user should be able to
// pick their language before they can even authenticate).
//
// preferred_language lives on profiles (decisions.md L2 — follows the
// user, not the company), so when `userId` is passed this writes there
// directly; the `locale` cookie is set immediately too so the reload
// doesn't have to wait on proxy.ts's next request to resync it.
//
// Language options come from the `languages` master-data table rather
// than a hardcoded list. We render `native_name`/`flag_emoji`, NOT the
// `label` column — `label` is English-only dev-reference data (same rule
// as vehicle_types.label), while native_name is always shown in its own
// script regardless of the current UI locale. LanguagePicker itself does
// render `label` too (as a secondary line) since it's a generic, reusable
// combobox; that's fine here as an aid for hunting a language by its
// English name in a 24-entry searchable list.
//
// Rendering delegates to components/LanguagePicker.tsx (2026-09-27, wired
// in here after i18n/locales.ts's SUPPORTED_LOCALES was widened 4 -> 24) —
// previously this rendered its own bespoke button grid / icon row, which
// only worked for a handful of languages. This component keeps its own
// trigger-free API (`userId`, `current`, `compact`) so Sidebar.tsx and
// app/login/page.tsx don't need to change at all; only the render function
// body changed.
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client' // reads the language list only; the write goes through the API
import { apiClient } from '@/lib/api-client'
import { SUPPORTED_LOCALES, type Locale } from '@/i18n/locales'
import LanguagePicker, { type LanguageOption } from './LanguagePicker'

const SUPPORTED_LOCALE_SET = new Set<string>(SUPPORTED_LOCALES)

export default function LanguageSwitcher({
  userId,
  current,
  compact = false,
}: {
  userId?: string
  current: string
  compact?: boolean
}) {
  const t = useTranslations('language')
  const [languages, setLanguages] = useState<LanguageOption[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    supabase
      .from('languages')
      .select('code, label, native_name, flag_emoji')
      .order('display_order')
      .then(({ data }) => {
        if (!cancelled && data) setLanguages(data.filter((language) => SUPPORTED_LOCALE_SET.has(language.code)))
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function selectLanguage(code: string) {
    if (code === current || saving) return
    setSaving(true)

    document.cookie = `locale=${code};path=/;max-age=${60 * 60 * 24 * 365}`

    if (userId) {
      // Same endpoint the mobile app uses (ADR 0003): writes only the caller's own profile, from the
      // session. The cookie above already switched the UI; a failed sync is retried on the next change.
      try {
        await apiClient.http.PATCH('/api/v1/me/preferences', { body: { preferred_language: code as Locale } })
      } catch {
        /* offline: the cookie still applies */
      }
    }

    window.location.reload()
  }

  if (languages.length === 0) {
    return <div className={compact ? 'h-9' : 'h-16'} aria-hidden />
  }

  return (
    <div role="group" aria-label={t('groupLabel')}>
      <LanguagePicker
        languages={languages}
        value={current}
        onSelect={selectLanguage}
        disabled={saving}
        className={compact ? 'w-full' : 'w-full max-w-xs'}
      />
      {!compact && <p className="mt-2.5 text-xs text-text-mut">{t('appliesEverywhere')}</p>}
    </div>
  )
}
