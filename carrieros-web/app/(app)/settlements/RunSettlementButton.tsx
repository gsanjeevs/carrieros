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
import { Button, Input, Modal } from '@/components/ui'

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

  const labelCls = 'block text-xs font-medium text-text-sec mb-1.5'

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <span className="material-symbols-outlined text-[18px]">add</span>
        {t('runSettlement')}
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={t('runSettlement')}
        className="max-h-[90vh] overflow-y-auto"
        footer={
          configuredDrivers.length === 0 ? (
            <Button variant="secondary" size="sm" onClick={close}>
              {tCommon('cancel')}
            </Button>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={close} disabled={loading}>
                {tCommon('cancel')}
              </Button>
              <Button
                size="sm"
                onClick={submit}
                disabled={loading || !driverId || !periodStart || !periodEnd || !!selectedNotConfigured}
                loading={loading}
              >
                {loading ? t('running') : t('runSettlement')}
              </Button>
            </>
          )
        }
      >
        {configuredDrivers.length === 0 ? (
          <p className="text-text-sec text-sm">{t('noDriversConfigured')}</p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className={labelCls}>{t('driver')}</label>
              <Input as="select" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">{tCommon('selectPlaceholder')}</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id} disabled={!(d.settlementType && d.settlementRate != null)}>
                    {d.label}{!(d.settlementType && d.settlementRate != null) ? ` (${t('notConfigured')})` : ''}
                  </option>
                ))}
              </Input>
              {selectedNotConfigured && <p className="text-warning text-xs mt-1.5">{t('driverNotConfiguredHint')}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{t('periodStart')}</label>
                <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>{t('periodEnd')}</label>
                <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm">
                {error}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}
