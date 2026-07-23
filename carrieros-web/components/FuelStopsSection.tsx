'use client'
// components/FuelStopsSection.tsx
// Fuel stop logging (audit gap #13 cluster) — ungated on all tiers per
// schema.sql's own comment: "fuel_stops logging itself... stay ungated
// (all-tier, safety/operational per the BRD's own stated principle); only
// the analytics/reporting LAYER on top is gated" (fuel_analytics, Pro+,
// not built here). Owner/solo/dispatcher get full CRUD via RLS's
// owner_solo_dispatcher_fuel_stops_all; finance is read-only
// (carrier_fuel_stops_select, no write policy) — this component hides the
// add button for them via the canLog prop rather than relying solely on
// RLS to fail the insert.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { formatMoney } from '@/lib/format-money'

export interface FuelStopRow {
  id: number
  state: string
  station: string | null
  stopDate: string
  gallons: number
  pricePerGallon: number | null
  totalCost: number
  odometer: number | null
  driverName: string | null
}

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
]

export default function FuelStopsSection({
  fuelStops,
  vehicleId,
  orgId,
  userId,
  canLog,
  currency,
  locale,
}: {
  fuelStops: FuelStopRow[]
  vehicleId: number
  orgId: number
  userId: string
  canLog: boolean
  currency: string
  locale: string
}) {
  const t = useTranslations('vehicles')
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const today = new Date().toISOString().slice(0, 10)
  const empty = { state: '', station: '', stop_date: today, gallons: '', price_per_gallon: '', odometer: '' }
  const [form, setForm] = useState(empty)
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const gallonsNum = Number(form.gallons)
  const priceNum = Number(form.price_per_gallon)
  const computedTotal = form.gallons && form.price_per_gallon && Number.isFinite(gallonsNum) && Number.isFinite(priceNum)
    ? gallonsNum * priceNum
    : null

  function close() {
    if (saving) return
    setOpen(false)
    setForm(empty)
    setError('')
  }

  async function submit() {
    if (!form.state || !form.gallons || Number.isNaN(gallonsNum) || gallonsNum <= 0) {
      setError(t('fuelValidationError'))
      return
    }
    setSaving(true)
    setError('')
    const supabase = createClient()

    const { data: driver } = await supabase
      .from('drivers')
      .select('id')
      .eq('carrier_org_id', orgId)
      .eq('profile_id', userId)
      .maybeSingle()

    const totalCost = computedTotal ?? gallonsNum * (Number.isFinite(priceNum) ? priceNum : 0)

    const { error: insErr } = await supabase.from('fuel_stops').insert({
      carrier_org_id: orgId,
      vehicle_id: vehicleId,
      driver_id: driver?.id ?? null,
      state: form.state,
      station: form.station.trim() || null,
      stop_date: form.stop_date,
      gallons: gallonsNum,
      price_per_gallon: form.price_per_gallon ? priceNum : null,
      total_cost: totalCost,
      odometer: form.odometer ? Number(form.odometer) : null,
      logged_by: userId,
    })

    setSaving(false)
    if (insErr) {
      setError(t('fuelSaveFailed'))
      return
    }
    close()
    router.refresh()
  }

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#f97316] focus:ring-2 focus:ring-[#f97316]/40 transition'
  const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5'

  return (
    <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-card-dark">
      <div className="px-5 py-3.5 border-b border-white/5 flex items-center justify-between">
        <h2 className="text-white font-medium text-sm">{t('fuelHistory')}</h2>
        {canLog && (
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-xs font-semibold rounded-lg transition"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            {t('logFuelStop')}
          </button>
        )}
      </div>

      {fuelStops.length === 0 ? (
        <div className="px-5 py-4 text-slate-500 text-sm">{t('noFuelStopsYet')}</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5">
              <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('date')}</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('fuelState')}</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('fuelStation')}</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('fuelDriver')}</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('fuelGallons')}</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('fuelCost')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {fuelStops.map((f) => (
              <tr key={f.id} className="hover:bg-white/[0.07] transition-colors duration-150">
                <td className="px-5 py-3 text-slate-300">{new Date(f.stopDate).toLocaleDateString(locale)}</td>
                <td className="px-4 py-3 text-white font-medium">{f.state}</td>
                <td className="px-4 py-3 text-slate-400">{f.station ?? '—'}</td>
                <td className="px-4 py-3 text-slate-400">{f.driverName ?? '—'}</td>
                <td className="px-4 py-3 text-right text-slate-300">{f.gallons.toLocaleString()}</td>
                <td className="px-5 py-3 text-right text-white font-medium">{formatMoney(f.totalCost, currency, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-md bg-[#0f1923] border border-white/10 rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-semibold text-lg">{t('logFuelStop')}</h2>
              <button onClick={close} className="text-slate-500 hover:text-white transition rounded">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('fuelState')} *</label>
                  <select className={inputCls} value={form.state} onChange={(e) => set('state', e.target.value)}>
                    <option value="">—</option>
                    {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{t('date')} *</label>
                  <input type="date" className={inputCls} value={form.stop_date} onChange={(e) => set('stop_date', e.target.value)} />
                </div>
              </div>

              <div>
                <label className={labelCls}>{t('fuelStation')}</label>
                <input className={inputCls} placeholder="Pilot #4213" value={form.station} onChange={(e) => set('station', e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('fuelGallons')} *</label>
                  <input type="number" step="0.001" min="0" className={inputCls} value={form.gallons} onChange={(e) => set('gallons', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t('fuelPricePerGallon')}</label>
                  <input type="number" step="0.001" min="0" className={inputCls} value={form.price_per_gallon} onChange={(e) => set('price_per_gallon', e.target.value)} />
                </div>
              </div>

              <div>
                <label className={labelCls}>{t('fuelOdometer')}</label>
                <input type="number" min="0" className={inputCls} value={form.odometer} onChange={(e) => set('odometer', e.target.value)} />
              </div>

              {computedTotal != null && (
                <p className="text-slate-400 text-xs">{t('fuelComputedTotal', { amount: formatMoney(computedTotal, currency, locale) })}</p>
              )}

              {error && <p className="text-red-400 text-xs">{error}</p>}

              <div className="flex gap-3 mt-2">
                <button onClick={close} disabled={saving} className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white font-medium rounded-lg transition text-sm">
                  {t('fuelCancel')}
                </button>
                <button onClick={submit} disabled={saving} className="flex-2 flex-grow py-2.5 bg-[#f97316] hover:bg-[#ea6c0a] disabled:opacity-40 text-white font-semibold rounded-lg transition text-sm">
                  {saving ? t('fuelSaving') : t('fuelSave')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
