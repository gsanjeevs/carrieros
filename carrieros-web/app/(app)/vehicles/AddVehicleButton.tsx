'use client'
// app/(app)/vehicles/AddVehicleButton.tsx
// Opens a modal form that calls POST /api/vehicles, then refreshes the vehicles
// list with a success banner (?created=<vehicle_number>).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
]

const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-[#f97316] focus:ring-2 focus:ring-[#f97316]/40 transition'
const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5'

export default function AddVehicleButton({ variant }: { variant?: 'empty' }) {
  const router = useRouter()
  const t = useTranslations('vehicles')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')

  // `errors` messages are keyed by error_code — never render a raw API string.
  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    nickname: '',
    year: '',
    make: '',
    model: '',
    vin: '',
    license_plate: '',
    license_state: '',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  function close() {
    if (loading) return
    setOpen(false)
    setError('')
    setForm({ nickname: '', year: '', make: '', model: '', vin: '', license_plate: '', license_state: '' })
  }

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
          vin: form.vin.trim() || undefined,
          license_plate: form.license_plate.trim() || undefined,
          license_state: form.license_state || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))

      setOpen(false)
      setForm({ nickname: '', year: '', make: '', model: '', vin: '', license_plate: '', license_state: '' })
      router.push(`/vehicles?created=${json.vehicle_number}`)
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {variant === 'empty' ? (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-sm font-medium rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          {t('addFirstTruck')}
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-sm font-semibold rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          {t('addTruck')}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-md bg-[#0f1923] border border-white/10 rounded-2xl p-6 shadow-modal-dark">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-semibold text-lg">{t('addTruck')}</h2>
              <button onClick={close} className="text-slate-500 hover:text-white transition rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className={labelCls}>{t('nickname')} *</label>
                <input
                  className={inputCls}
                  placeholder="Big Red"
                  value={form.nickname}
                  onChange={e => set('nickname', e.target.value)}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>{t('year')}</label>
                  <input className={inputCls} placeholder="2022" inputMode="numeric"
                    value={form.year} onChange={e => set('year', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t('make')}</label>
                  <input className={inputCls} placeholder="Freightliner"
                    value={form.make} onChange={e => set('make', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t('model')}</label>
                  <input className={inputCls} placeholder="Cascadia"
                    value={form.model} onChange={e => set('model', e.target.value)} />
                </div>
              </div>

              <div>
                <label className={labelCls}>VIN</label>
                <input className={inputCls} placeholder="1FUJGHDV8CLBP1234"
                  value={form.vin} onChange={e => set('vin', e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('licensePlate')}</label>
                  <input className={inputCls} placeholder="ABC-1234"
                    value={form.license_plate} onChange={e => set('license_plate', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t('licenseState')}</label>
                  <select className={inputCls} value={form.license_state} onChange={e => set('license_state', e.target.value)}>
                    <option value="">{tCommon('selectPlaceholder')}</option>
                    {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-3 mt-2">
                <button
                  onClick={close}
                  disabled={loading}
                  className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white font-medium rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                >
                  {tCommon('cancel')}
                </button>
                <button
                  onClick={submit}
                  disabled={loading || !form.nickname}
                  className="flex-2 flex-grow py-2.5 bg-[#f97316] hover:bg-[#ea6c0a] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                >
                  {loading ? t('adding') : t('addTruck')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
