'use client'
// app/onboarding/steps/AddVehicleStep.tsx
// Thin wrapper around POST /api/vehicles — zero backend changes. Optional:
// a brand-new solo operator may not have added a vehicle before their first
// load, so this step can be skipped and revisited from /vehicles later.

import { useState } from 'react'
import { useTranslations } from 'next-intl'

const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/40 transition'
const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5'

export default function AddVehicleStep({ onNext }: { onNext: (added: boolean) => void }) {
  const t = useTranslations('onboarding')
  const tVehicles = useTranslations('vehicles')
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
  const [form, setForm] = useState({ nickname: '', year: '', make: '', model: '' })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: form.nickname.trim(),
          year: form.year ? Number(form.year) : undefined,
          make: form.make.trim() || undefined,
          model: form.model.trim() || undefined,
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
      <h2 className="text-white font-semibold text-lg mb-1">{t('stepVehicleTitle')}</h2>
      <p className="text-slate-400 text-sm mb-4">{t('stepVehicleSubtitle')}</p>

      <div>
        <label className={labelCls}>{tVehicles('nickname')}</label>
        <input className={inputCls} placeholder="Big Red"
          value={form.nickname} onChange={e => set('nickname', e.target.value)} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>{tVehicles('year')}</label>
          <input className={inputCls} placeholder="2022" inputMode="numeric"
            value={form.year} onChange={e => set('year', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>{tVehicles('make')}</label>
          <input className={inputCls} placeholder="Freightliner"
            value={form.make} onChange={e => set('make', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>{tVehicles('model')}</label>
          <input className={inputCls} placeholder="Cascadia"
            value={form.model} onChange={e => set('model', e.target.value)} />
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
          disabled={loading || !form.nickname.trim()}
          className="flex-2 flex-grow py-2.5 bg-brand-orange hover:bg-brand-orange-hover disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
        >
          {loading ? tCommon('loading') : t('continue')}
        </button>
      </div>
    </div>
  )
}
