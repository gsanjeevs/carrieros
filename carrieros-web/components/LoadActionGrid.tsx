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
  loadNumber,
  canCancel,
}: {
  trackingToken: string | null
  loadNumber: string
  canCancel: boolean
}) {
  const t = useTranslations('loads')
  const [copied, setCopied] = useState(false)
  // Multi-channel share (audit gap: the button only ever copied to
  // clipboard). navigator.share() gives the OS native share sheet (Messages/
  // Mail/WhatsApp/etc.) wherever the browser supports it (Safari, Chrome on
  // Android, most mobile webviews); this menu is the fallback for browsers
  // that don't (desktop Chrome/Firefox as of this writing) so the channels
  // are still reachable via plain mailto:/sms: links, not just copy.
  const [menuOpen, setMenuOpen] = useState(false)

  function trackingUrl() {
    return `${window.location.origin}/track/${trackingToken}`
  }

  async function shareTracking() {
    if (!trackingToken) return
    const url = trackingUrl()

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: t('actionShareTracking'), text: t('shareMessage', { loadNumber }), url })
        return
      } catch {
        // User cancelled the native share sheet, or it's unsupported for
        // this content — fall through to the copy/menu fallback below.
      }
    }

    setMenuOpen((v) => !v)
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(trackingUrl())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API can fail (permissions, non-secure context) — no crash.
    }
    setMenuOpen(false)
  }

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const btnCls = 'flex flex-col items-center justify-center gap-1.5 py-3.5 bg-surface-subtle hover:bg-white/10 border border-border-ui rounded-xl transition text-center focus:outline-none focus:ring-2 focus:ring-brand-orange/50 disabled:opacity-40 disabled:hover:bg-surface-subtle disabled:cursor-not-allowed'
  const iconCls = 'material-symbols-outlined text-[20px] text-slate-300'
  const labelCls = 'text-white text-xs font-medium'

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 relative">
      <div className="relative">
        <button type="button" onClick={shareTracking} disabled={!trackingToken} className={`${btnCls} w-full`}>
          <span className={`material-symbols-outlined text-[20px] ${copied ? 'text-teal' : 'text-slate-300'}`}>
            {copied ? 'check' : 'ios_share'}
          </span>
          <span className={labelCls}>{copied ? t('actionCopied') : t('actionShareTracking')}</span>
        </button>

        {menuOpen && trackingToken && (
          <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-navy border border-border-ui rounded-xl overflow-hidden shadow-lg">
            <button type="button" onClick={copyLink} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-white hover:bg-white/10 transition">
              <span className="material-symbols-outlined text-[16px] text-slate-300">content_copy</span>
              {t('shareCopyLink')}
            </button>
            <a
              href={`sms:?body=${encodeURIComponent(t('shareMessage', { loadNumber }) + ' ' + trackingUrl())}`}
              onClick={() => setMenuOpen(false)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-white hover:bg-white/10 transition"
            >
              <span className="material-symbols-outlined text-[16px] text-slate-300">sms</span>
              {t('shareViaSms')}
            </a>
            <a
              href={`mailto:?subject=${encodeURIComponent(t('shareEmailSubject', { loadNumber }))}&body=${encodeURIComponent(t('shareMessage', { loadNumber }) + ' ' + trackingUrl())}`}
              onClick={() => setMenuOpen(false)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-white hover:bg-white/10 transition"
            >
              <span className="material-symbols-outlined text-[16px] text-slate-300">mail</span>
              {t('shareViaEmail')}
            </a>
          </div>
        )}
      </div>

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
