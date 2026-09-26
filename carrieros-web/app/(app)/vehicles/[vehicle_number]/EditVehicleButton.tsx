'use client'
// app/(app)/vehicles/[vehicle_number]/EditVehicleButton.tsx
// Opens a modal form pre-filled with the vehicle's current values and calls
// PATCH /api/v1/vehicles/{id}, then refreshes the detail page. Mirrors
// AddVehicleButton.tsx's structure/success-handling, minus the vehicle-type
// picker: vehicle_type_id is fixed at creation and isn't part of the PATCH
// body schema.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, Input, Modal } from '@/components/ui'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
]

// Same curated swatches as AddVehicleButton.tsx — literal hex, not design
// tokens, for the same reason documented there (domain data, not theming).
const FLEET_COLORS: { name: string; hex: string }[] = [
  { name: 'White', hex: '#f8fafc' },
  { name: 'Black', hex: '#0f172a' },
  { name: 'Silver', hex: '#94a3b8' },
  { name: 'Red', hex: '#dc2626' },
  { name: 'Blue', hex: '#2563eb' },
  { name: 'Orange', hex: '#f97316' },
]

const CAB_TYPES = ['sleeper', 'day_cab', 'other'] as const

const labelCls = 'block text-xs font-medium text-text-sec mb-1.5'

export type EditVehicleInitial = {
  id: number
  nickname: string | null
  year: number | null
  make: string | null
  model: string | null
  vin: string | null
  license_plate: string | null
  license_state: string | null
  cab_type: string | null
  color: string | null
  dimensions: string | null
}

function toForm(v: EditVehicleInitial) {
  return {
    nickname: v.nickname ?? '',
    year: v.year != null ? String(v.year) : '',
    make: v.make ?? '',
    model: v.model ?? '',
    vin: v.vin ?? '',
    license_plate: v.license_plate ?? '',
    license_state: v.license_state ?? '',
    cab_type: v.cab_type ?? '',
    color: v.color ?? '',
    dimensions: v.dimensions ?? '',
  }
}

export default function EditVehicleButton({ vehicle }: { vehicle: EditVehicleInitial }) {
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
  const [form, setForm] = useState(() => toForm(vehicle))

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  function openModal() {
    setForm(toForm(vehicle))
    setError('')
    setOpen(true)
  }

  function close() {
    if (loading) return
    setOpen(false)
    setError('')
  }

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/vehicles/${vehicle.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: form.nickname.trim() || undefined,
          year: form.year ? Number(form.year) : undefined,
          make: form.make.trim() || undefined,
          model: form.model.trim() || undefined,
          vin: form.vin.trim() || undefined,
          license_plate: form.license_plate.trim() || undefined,
          license_state: form.license_state || undefined,
          cab_type: form.cab_type || undefined,
          color: form.color || undefined,
          dimensions: form.dimensions.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))

      setOpen(false)
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={openModal}>
        <span className="material-symbols-outlined text-[16px]">edit</span>
        {t('editTruck')}
      </Button>

      <Modal
        open={open}
        onClose={close}
        size="lg"
        title={t('editTruck')}
        className="max-h-[90vh] overflow-y-auto"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={close} disabled={loading}>
              {tCommon('cancel')}
            </Button>
            <Button size="sm" onClick={submit} disabled={loading || !form.nickname} loading={loading}>
              {loading ? t('saving') : tCommon('save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className={labelCls}>{t('nickname')} *</label>
            <Input
              placeholder="Big Red"
              value={form.nickname}
              onChange={e => set('nickname', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>{t('year')}</label>
              <Input placeholder="2022" inputMode="numeric"
                value={form.year} onChange={e => set('year', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('make')}</label>
              <Input placeholder="Freightliner"
                value={form.make} onChange={e => set('make', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('model')}</label>
              <Input placeholder="Cascadia"
                value={form.model} onChange={e => set('model', e.target.value)} />
            </div>
          </div>

          <div>
            <label className={labelCls}>VIN</label>
            <Input placeholder="1FUJGHDV8CLBP1234"
              value={form.vin} onChange={e => set('vin', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('licensePlate')}</label>
              <Input placeholder="ABC-1234"
                value={form.license_plate} onChange={e => set('license_plate', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('licenseState')}</label>
              <Input as="select" value={form.license_state} onChange={e => set('license_state', e.target.value)}>
                <option value="">{tCommon('selectPlaceholder')}</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </Input>
            </div>
          </div>

          <div>
            <label className={labelCls}>{t('cabType')}</label>
            <div className="grid grid-cols-4 gap-2">
              {[...CAB_TYPES, ''].map(ct => {
                const selected = form.cab_type === ct
                const label = ct === ''
                  ? t('cabTypeNotApplicable')
                  : t(`cabType${ct === 'sleeper' ? 'Sleeper' : ct === 'day_cab' ? 'DayCab' : 'Other'}` as never)
                return (
                  <button
                    key={ct || 'na'}
                    type="button"
                    onClick={() => set('cab_type', ct)}
                    className={`py-2 rounded-lg border text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50 ${
                      selected
                        ? 'border-brand-orange bg-brand-orange/10 text-text-pri'
                        : 'border-border-ui bg-surface-subtle text-text-sec hover:bg-surface-subtle/70'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className={labelCls}>{t('dimensions')}</label>
            <Input placeholder={t('dimensionsPlaceholder')}
              value={form.dimensions} onChange={e => set('dimensions', e.target.value)} />
          </div>

          <div>
            <label className={labelCls}>{t('color')}</label>
            <div className="flex gap-2 flex-wrap">
              {FLEET_COLORS.map(c => {
                const selected = form.color === c.name
                return (
                  <button
                    key={c.name}
                    type="button"
                    title={c.name}
                    onClick={() => set('color', selected ? '' : c.name)}
                    className={`w-8 h-8 rounded-full border-2 transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50 ${
                      selected ? 'border-brand-orange scale-110' : 'border-border-ui'
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                )
              })}
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm">
              {error}
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
