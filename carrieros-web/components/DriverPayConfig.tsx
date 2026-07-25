'use client'
// components/DriverPayConfig.tsx
// Sets a driver's default settlement_type/settlement_rate — the two
// columns app/api/settlements/run/route.ts reads to compute real pay
// (percent_of_rate/per_mile/flat_per_load). Direct client-side update via
// owner_solo_drivers_all's RLS policy (FOR ALL), same pattern as other
// owner/solo-only inline-edit cards — no API route needed for a single-
// table update already covered by RLS.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { Card, CardBody, Field, Input, Button } from '@/components/ui'

type SettlementType = 'percent_of_rate' | 'per_mile' | 'flat_per_load'

const RATE_LABEL_KEY: Record<SettlementType, string> = {
  percent_of_rate: 'rateLabelPercent',
  per_mile: 'rateLabelPerMile',
  flat_per_load: 'rateLabelFlatPerLoad',
}
const RATE_INPUT_LABEL_KEY: Record<SettlementType, string> = {
  percent_of_rate: 'rateInputPercent',
  per_mile: 'rateInputPerMile',
  flat_per_load: 'rateInputFlatPerLoad',
}

export default function DriverPayConfig({
  driverId,
  settlementType,
  settlementRate,
}: {
  driverId: number
  settlementType: SettlementType | null
  settlementRate: number | null
}) {
  const t = useTranslations('drivers')
  const router = useRouter()

  const [editing, setEditing] = useState(false)
  const [type, setType] = useState<SettlementType>(settlementType ?? 'percent_of_rate')
  const [rate, setRate] = useState(settlementRate != null ? String(settlementRate) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    const rateNum = Number(rate)
    if (!rate.trim() || Number.isNaN(rateNum) || rateNum <= 0) {
      setError(t('payRateInvalid'))
      return
    }
    setSaving(true)
    setError('')
    const supabase = createClient()
    const { error: updErr } = await supabase
      .from('drivers')
      .update({ settlement_type: type, settlement_rate: rateNum })
      .eq('id', driverId)
    setSaving(false)
    if (updErr) {
      setError(t('payConfigSaveFailed'))
      return
    }
    setEditing(false)
    router.refresh()
  }

  if (!editing) {
    return (
      <Card>
        <CardBody>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-text-pri font-medium text-sm">{t('payConfig')}</h2>
          <button
            onClick={() => setEditing(true)}
            className="text-brand-orange hover:text-brand-orange-light text-xs font-medium transition"
          >
            {settlementType ? t('editPayConfig') : t('setPayConfig')}
          </button>
        </div>
        {settlementType && settlementRate != null ? (
          <p className="text-slate-300 text-sm">
            {t(`settlementType_${settlementType}`)} — {t(RATE_LABEL_KEY[settlementType], { rate: settlementRate })}
          </p>
        ) : (
          <p className="text-slate-500 text-sm">{t('noPayConfig')}</p>
        )}
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardBody className="space-y-3">
      <h2 className="text-text-pri font-medium text-sm">{t('payConfig')}</h2>
      <Field label={t('settlementType')}>
        <select
          className="w-full bg-surface-input border border-border-ui rounded-lg px-3 py-2.5 text-[13px] text-text-pri cursor-pointer focus:outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          value={type}
          onChange={(e) => setType(e.target.value as SettlementType)}
          disabled={saving}
        >
          <option value="percent_of_rate">{t('settlementType_percent_of_rate')}</option>
          <option value="per_mile">{t('settlementType_per_mile')}</option>
          <option value="flat_per_load">{t('settlementType_flat_per_load')}</option>
        </select>
      </Field>
      <Field label={t(RATE_INPUT_LABEL_KEY[type] as never)}>
        <Input
          size="lg"
          type="number"
          step="0.01"
          min="0"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          disabled={saving}
        />
      </Field>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-2">
        <Button
          variant="secondary"
          onClick={() => { setEditing(false); setError('') }}
          disabled={saving}
          className="flex-1"
        >
          {t('payConfigCancel')}
        </Button>
        <Button
          onClick={save}
          disabled={saving}
          loading={saving}
          className="flex-1"
        >
          {saving ? t('payConfigSaving') : t('payConfigSave')}
        </Button>
      </div>
      </CardBody>
    </Card>
  )
}
