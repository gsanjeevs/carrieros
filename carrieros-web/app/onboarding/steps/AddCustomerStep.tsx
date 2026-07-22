'use client'
// app/onboarding/steps/AddCustomerStep.tsx
// Thin wrapper around POST /api/customers -> create_customer_org() RPC —
// zero backend changes. Optional/skippable, same reasoning as the vehicle
// step: a carrier's first customer relationship may not exist yet.

import { useState } from 'react'
import { useTranslations } from 'next-intl'

const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-[#f97316] focus:ring-2 focus:ring-brand-orange/40 transition'
const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5'

export default function AddCustomerStep({ onNext }: { onNext: (added: boolean) => void }) {
  const t = useTranslations('onboarding')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')

  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', contact_name: '', phone: '', email: '' })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          contact_name: form.contact_name.trim() || undefined,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))
      onNext(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-white font-semibold text-lg mb-1">{t('stepCustomerTitle')}</h2>
      <p className="text-slate-400 text-sm mb-4">{t('stepCustomerSubtitle')}</p>

      <div>
        <label className={labelCls}>{t('customerName')}</label>
        <input className={inputCls} placeholder="Pacific Produce Distributors"
          value={form.name} onChange={e => set('name', e.target.value)} />
      </div>

      <div>
        <label className={labelCls}>{t('customerContactName')}</label>
        <input className={inputCls} placeholder="Jane Doe"
          value={form.contact_name} onChange={e => set('contact_name', e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>{t('customerPhone')}</label>
          <input className={inputCls} placeholder="(555) 123-4567"
            value={form.phone} onChange={e => set('phone', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>{t('customerEmail')}</label>
          <input className={inputCls} placeholder="dispatch@example.com" type="email"
            value={form.email} onChange={e => set('email', e.target.value)} />
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3 mt-2">
        <button
          onClick={() => onNext(false)}
          disabled={loading}
          className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white font-medium rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
        >
          {t('skipForNow')}
        </button>
        <button
          onClick={submit}
          disabled={loading || !form.name.trim()}
          className="flex-2 flex-grow py-2.5 bg-[#f97316] hover:bg-[#ea6c0a] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
        >
          {loading ? tCommon('loading') : t('continue')}
        </button>
      </div>
    </div>
  )
}
