'use client'
// app/(app)/settlements/RunSettlementButton.tsx
// Opens a modal to run a new settlement — POST /api/settlements/run, which
// does the real role/tier gating and pay-rate math. Drivers with no
// settlement_type/settlement_rate configured (see DriverPayConfig.tsx) are
// shown inline with a hint rather than silently allowed to fail the API
// call.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

interface DriverOption {
  id: number
  label: string
  settlementType: string | null
  settlementRate: number | null
}

export default function RunSettlementButton({ drivers }: { drivers: DriverOption[] }) {
  const t = useTranslations('settlements')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const router = useRouter()

  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  const [open, setOpen] = useState(false)
  const [driverId, setDriverId] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const configuredDrivers = drivers.filter((d) => d.settlementType && d.settlementRate != null)
  const selected = drivers.find((d) => String(d.id) === driverId)
  const selectedNotConfigured = selected && !(selected.settlementType && selected.settlementRate != null)

  function close() {
    if (loading) return
    setOpen(false)
    setError('')
    setDriverId('')
    setPeriodStart('')
    setPeriodEnd('')
  }

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/settlements/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver_id: Number(driverId), period_start: periodStart, period_end: periodEnd }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))
      close()
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#f97316] transition'
  const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5'

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-sm font-semibold rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
      >
        <span className="material-symbols-outlined text-[18px]">add</span>
        {t('runSettlement')}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-md bg-[#0f1923] border border-white/10 rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-semibold text-lg">{t('runSettlement')}</h2>
              <button onClick={close} className="text-slate-500 hover:text-white transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50 rounded">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {configuredDrivers.length === 0 ? (
              <p className="text-slate-400 text-sm">{t('noDriversConfigured')}</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className={labelCls}>{t('driver')}</label>
                  <select className={inputCls} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                    <option value="">{tCommon('selectPlaceholder')}</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id} disabled={!(d.settlementType && d.settlementRate != null)}>
                        {d.label}{!(d.settlementType && d.settlementRate != null) ? ` (${t('notConfigured')})` : ''}
                      </option>
                    ))}
                  </select>
                  {selectedNotConfigured && <p className="text-amber-400 text-xs mt-1.5">{t('driverNotConfiguredHint')}</p>}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>{t('periodStart')}</label>
                    <input type="date" className={inputCls} value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>{t('periodEnd')}</label>
                    <input type="date" className={inputCls} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
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
                    disabled={loading || !driverId || !periodStart || !periodEnd || !!selectedNotConfigured}
                    className="flex-2 flex-grow py-2.5 bg-[#f97316] hover:bg-[#ea6c0a] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                  >
                    {loading ? t('running') : t('runSettlement')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
