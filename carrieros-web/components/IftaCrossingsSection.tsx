'use client'
// components/IftaCrossingsSection.tsx
// IFTA mileage log (audit gap #13 cluster, Growth+ `ifta_mileage_log`
// feature). Logs manual state crossings for a load into
// ifta_state_crossings — the same table check_ifta_completeness() (wired
// into the load-delivery PATCH) already reads. No GPS-based auto-crossing
// detection exists in this codebase (mobile has no background-location
// task, see share-location-section.tsx's own foreground-only scope), so
// every row this component writes is source='manual' — the "manual entry
// deletes GPS rows first" rule documented on the table is a no-op today
// since no GPS rows are ever created, not implemented here.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

export interface IftaCrossingRow {
  id: number
  state: string
  crossedAt: string
  odometerEst: number | null
}

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
]

export default function IftaCrossingsSection({
  loadId,
  orgId,
  crossings,
  canManage,
  locale,
}: {
  loadId: number
  orgId: number
  crossings: IftaCrossingRow[]
  canManage: boolean
  locale: string
}) {
  const t = useTranslations('loads')
  const router = useRouter()

  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const now = new Date().toISOString().slice(0, 16)
  const empty = { state: '', crossed_at: now, odometer_est: '' }
  const [form, setForm] = useState(empty)
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function submit() {
    if (!form.state || !form.crossed_at) {
      setError(t('iftaValidationError'))
      return
    }
    setSaving(true)
    setError('')
    const supabase = createClient()

    const { data: driver } = await supabase.auth.getUser().then(({ data }) =>
      supabase.from('drivers').select('id').eq('carrier_org_id', orgId).eq('profile_id', data.user?.id ?? '').maybeSingle()
    )

    const { error: insErr } = await supabase.from('ifta_state_crossings').insert({
      carrier_org_id: orgId,
      load_id: loadId,
      driver_id: driver?.id ?? null,
      state: form.state,
      crossed_at: new Date(form.crossed_at).toISOString(),
      odometer_est: form.odometer_est ? Number(form.odometer_est) : null,
      source: 'manual',
    })

    setSaving(false)
    if (insErr) {
      setError(t('iftaSaveFailed'))
      return
    }
    setForm(empty)
    setAdding(false)
    router.refresh()
  }

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/40 transition'

  return (
    <div className="bg-white/5 border border-white/8 rounded-xl p-5 shadow-card-dark">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-white font-medium text-sm">{t('iftaTitle')}</h2>
        {canManage && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-orange hover:bg-brand-orange-hover text-white text-xs font-semibold rounded-lg transition"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            {t('iftaLogCrossing')}
          </button>
        )}
      </div>

      {crossings.length === 0 ? (
        <p className="text-slate-500 text-sm">{t('iftaNoCrossings')}</p>
      ) : (
        <div className="space-y-1.5">
          {crossings.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-lg">
              <span className="text-white text-sm font-medium">{c.state}</span>
              <span className="text-slate-400 text-xs">{new Date(c.crossedAt).toLocaleString(locale)}</span>
              <span className="text-slate-400 text-xs">{c.odometerEst != null ? `${c.odometerEst.toLocaleString()} mi` : '—'}</span>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
          <div className="grid grid-cols-2 gap-3">
            <select className={inputCls} value={form.state} onChange={(e) => set('state', e.target.value)}>
              <option value="">{t('iftaState')}</option>
              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input type="datetime-local" className={inputCls} value={form.crossed_at} onChange={(e) => set('crossed_at', e.target.value)} />
          </div>
          <input
            type="number"
            className={inputCls}
            placeholder={t('iftaOdometer')}
            value={form.odometer_est}
            onChange={(e) => set('odometer_est', e.target.value)}
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setAdding(false); setError('') }} disabled={saving} className="flex-1 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition">
              {t('iftaCancel')}
            </button>
            <button onClick={submit} disabled={saving} className="flex-1 py-2 bg-brand-orange hover:bg-brand-orange-hover disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition">
              {saving ? t('iftaSaving') : t('iftaSave')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
