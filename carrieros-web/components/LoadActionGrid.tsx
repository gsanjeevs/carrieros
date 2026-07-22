'use client'
// components/LoadActionGrid.tsx
// 2x2 quick-action grid for the load detail page. "Cancel Load" deliberately
// does NOT reimplement the cancel flow (confirm + PATCH) that already lives
// in DispatchPanel.tsx — it just scrolls/focuses the Assignment sidebar so
// the user lands on the real button. "Edit Load" has no edit UI yet
// (app/(app)/loads only has `new` and `[load_number]` — no edit route), so
// it renders disabled with a tooltip rather than a stub form.

import { useState } from 'react'
import { useTranslations } from 'next-intl'

export default function LoadActionGrid({
  trackingToken,
  canCancel,
}: {
  trackingToken: string | null
  canCancel: boolean
}) {
  const t = useTranslations('loads')
  const [copied, setCopied] = useState(false)

  async function shareTracking() {
    if (!trackingToken) return
    const url = `${window.location.origin}/track/${trackingToken}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API can fail (permissions, non-secure context) — no crash.
    }
  }

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const btnCls = 'flex flex-col items-center justify-center gap-1.5 py-3.5 bg-white/5 hover:bg-white/10 border border-white/8 rounded-xl transition text-center focus:outline-none focus:ring-2 focus:ring-brand-orange/50 disabled:opacity-40 disabled:hover:bg-white/5 disabled:cursor-not-allowed'
  const iconCls = 'material-symbols-outlined text-[20px] text-slate-300'
  const labelCls = 'text-white text-xs font-medium'

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <button type="button" onClick={shareTracking} disabled={!trackingToken} className={btnCls}>
        <span className={`material-symbols-outlined text-[20px] ${copied ? 'text-[#1abc9c]' : 'text-slate-300'}`}>
          {copied ? 'check' : 'ios_share'}
        </span>
        <span className={labelCls}>{copied ? t('actionCopied') : t('actionShareTracking')}</span>
      </button>

      <button type="button" onClick={() => scrollTo('documents')} className={btnCls}>
        <span className={iconCls}>description</span>
        <span className={labelCls}>{t('actionRateConfirmation')}</span>
      </button>

      <button type="button" disabled title={t('actionEditLoadSoon')} className={btnCls}>
        <span className={iconCls}>edit</span>
        <span className={labelCls}>{t('actionEditLoad')}</span>
      </button>

      <button
        type="button"
        onClick={() => scrollTo('assignment')}
        disabled={!canCancel}
        className={btnCls}
        title={!canCancel ? t('actionCancelUnavailable') : undefined}
      >
        <span className="material-symbols-outlined text-[20px] text-red-400">cancel</span>
        <span className="text-red-400 text-xs font-medium">{t('actionCancelLoad')}</span>
      </button>
    </div>
  )
}
