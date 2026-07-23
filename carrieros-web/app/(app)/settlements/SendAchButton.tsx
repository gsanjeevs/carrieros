'use client'
// app/(app)/settlements/SendAchButton.tsx
// POST /api/settlements/:id/send-ach — Pro+ only (settlement_ach feature).
// `entitled` is passed in from the server component's own hasFeature() call
// (data-driven per docs/architecture-principles.md — never a hardcoded
// tier check here); when false, the button renders as an upgrade hint
// instead of being wired to the API, since the route would 403 anyway.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

export default function SendAchButton({ settlementId, entitled }: { settlementId: number; entitled: boolean }) {
  const t = useTranslations('settlements')
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  if (!entitled) {
    return <span className="text-slate-500 text-xs">{t('sendAchRequiresPro')}</span>
  }

  async function send() {
    setLoading(true)
    try {
      const res = await fetch(`/api/settlements/${settlementId}/send-ach`, { method: 'POST' })
      if (res.ok) router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={send}
      disabled={loading}
      className="px-3 py-1.5 bg-[#f97316]/10 hover:bg-[#f97316]/20 disabled:opacity-40 text-[#f97316] text-xs font-semibold rounded-lg transition"
    >
      {loading ? t('sending') : t('sendAch')}
    </button>
  )
}
