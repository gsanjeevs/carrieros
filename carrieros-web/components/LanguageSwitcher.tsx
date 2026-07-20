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
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ' },
  { code: 'ur', label: 'اردو' },
]

export default function LanguageSwitcher({ userId, current }: { userId?: string; current: string }) {
  const [saving, setSaving] = useState(false)

  async function selectLanguage(code: string) {
    if (code === current || saving) return
    setSaving(true)

    document.cookie = `locale=${code};path=/;max-age=${60 * 60 * 24 * 365}`

    if (userId) {
      const supabase = createClient()
      await supabase.from('profiles').update({ preferred_language: code }).eq('id', userId)
    }

    window.location.reload()
  }

  return (
    <select
      value={current}
      onChange={(e) => selectLanguage(e.target.value)}
      disabled={saving}
      aria-label="Language"
      className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-[#f97316]"
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code} className="bg-[#0f1923]">
          {l.label}
        </option>
      ))}
    </select>
  )
}
