// components/LanguageSwitcher.tsx
'use client'
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
// script regardless of the current UI locale.
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

interface Language {
  code: string
  native_name: string
  flag_emoji: string
}

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
  const [languages, setLanguages] = useState<Language[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    supabase
      .from('languages')
      .select('code, native_name, flag_emoji')
      .order('display_order')
      .then(({ data }) => {
        if (!cancelled && data) setLanguages(data)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function selectLanguage(code: string) {
    if (code === current || saving) return
    setSaving(true)

    // False positive: this assignment only ever runs inside selectLanguage,
    // itself only ever invoked from an onClick handler (see the two call
    // sites below), never during render. The React Compiler's static
    // analysis can't see that and flags any property assignment on
    // `document` as if it mutated a render-scope variable, which
    // document.cookie's setter semantics never do. Unrelated to (and
    // predates) the 2026-07-25 re-skin.
    // eslint-disable-next-line react-hooks/immutability
    document.cookie = `locale=${code};path=/;max-age=${60 * 60 * 24 * 365}`

    if (userId) {
      const supabase = createClient()
      await supabase.from('profiles').update({ preferred_language: code }).eq('id', userId)
    }

    window.location.reload()
  }

  if (languages.length === 0) {
    return <div className={compact ? 'h-9' : 'h-16'} aria-hidden />
  }

  if (compact) {
    return (
      <div className="flex items-center gap-1.5" role="group" aria-label={t('groupLabel')}>
        {languages.map((l) => {
          const selected = l.code === current
          return (
            <button
              key={l.code}
              type="button"
              title={l.native_name}
              aria-label={l.native_name}
              aria-pressed={selected}
              disabled={saving}
              onClick={() => selectLanguage(l.code)}
              className={`relative w-8 h-8 rounded-lg flex items-center justify-center text-base transition disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand-orange/50 ${
                selected
                  ? 'bg-brand-orange/10 border-2 border-brand-orange'
                  : 'border border-border-ui bg-surface-subtle hover:bg-white/10'
              }`}
            >
              <span aria-hidden>{l.flag_emoji}</span>
              {selected && (
                <span className="material-symbols-outlined absolute -top-1.5 -right-1.5 text-[13px] leading-none text-brand-orange bg-navy rounded-full">
                  check_circle
                </span>
              )}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5" role="group" aria-label={t('groupLabel')}>
        {languages.map((l) => {
          const selected = l.code === current
          return (
            <button
              key={l.code}
              type="button"
              disabled={saving}
              aria-pressed={selected}
              onClick={() => selectLanguage(l.code)}
              className={`relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand-orange/50 ${
                selected
                  ? 'border-2 border-brand-orange bg-brand-orange/10'
                  : 'border border-border-ui bg-surface-subtle hover:bg-white/10'
              }`}
            >
              <span className="text-lg leading-none" aria-hidden>{l.flag_emoji}</span>
              <span className="text-white text-sm font-medium truncate">{l.native_name}</span>
              {selected && (
                <span className="material-symbols-outlined absolute top-1.5 right-1.5 text-[16px] leading-none text-brand-orange">
                  check_circle
                </span>
              )}
            </button>
          )
        })}
      </div>
      <p className="mt-2.5 text-xs text-slate-500">{t('appliesEverywhere')}</p>
    </div>
  )
}
