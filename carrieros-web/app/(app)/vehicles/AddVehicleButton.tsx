'use client'
// app/(app)/vehicles/AddVehicleButton.tsx
// Opens a modal form that calls POST /api/vehicles, then refreshes the vehicles
// list with a success banner (?created=<vehicle_number>).

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { VEHICLE_TYPE_ICONS } from '@/components/icons/vehicle-types'
import { Button, Input, Modal } from '@/components/ui'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
]

// Curated set of common fleet paint colors. Stored as the human-readable
// name in `vehicles.color` (plain TEXT column) — keep the swatch hex in
// sync with the label so the UI stays simple (no free-form color picker).
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

type VehicleTypeRow = { id: number; code: string }

const emptyForm = {
  vehicle_type_id: '',
  nickname: '',
  year: '',
  make: '',
  model: '',
  vin: '',
  license_plate: '',
  license_state: '',
  cab_type: '',
  color: '',
  dimensions: '',
}

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
  const [typeError, setTypeError] = useState(false)

  const [vehicleTypes, setVehicleTypes] = useState<VehicleTypeRow[] | null>(null)
  const typesLoading = open && vehicleTypes === null

  const [form, setForm] = useState(emptyForm)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!open || vehicleTypes !== null) return
    let cancelled = false
    const supabase = createClient()
    supabase
      .from('vehicle_types')
      .select('id, code')
      .order('display_order')
      .then(({ data }) => {
        if (!cancelled) setVehicleTypes(data ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [open, vehicleTypes])

  function close() {
    if (loading) return
    setOpen(false)
    setError('')
    setTypeError(false)
    setForm(emptyForm)
  }

  async function submit() {
    if (!form.vehicle_type_id) {
      setTypeError(true)
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_type_id: Number(form.vehicle_type_id),
          nickname: form.nickname.trim(),
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
      setForm(emptyForm)
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
        <Button onClick={() => setOpen(true)} className="mt-4">
          <span className="material-symbols-outlined text-[16px]">add</span>
          {t('addFirstTruck')}
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <span className="material-symbols-outlined text-[18px]">add</span>
          {t('addTruck')}
        </Button>
      )}

      <Modal
        open={open}
        onClose={close}
        size="lg"
        title={t('addTruck')}
        className="max-h-[90vh] overflow-y-auto"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={close} disabled={loading}>
              {tCommon('cancel')}
            </Button>
            <Button size="sm" onClick={submit} disabled={loading || !form.nickname || !form.vehicle_type_id} loading={loading}>
              {loading ? t('adding') : t('addTruck')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className={labelCls}>{t('chooseType')} *</label>
            {typesLoading ? (
              <p className="text-text-sec text-sm">{tCommon('loading')}</p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {(vehicleTypes ?? []).map(vt => {
                  const Icon = VEHICLE_TYPE_ICONS[vt.code]
                  const selected = form.vehicle_type_id === String(vt.id)
                  return (
                    <button
                      key={vt.id}
                      type="button"
                      onClick={() => {
                        set('vehicle_type_id', String(vt.id))
                        setTypeError(false)
                      }}
                      className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-3 text-center transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50 ${
                        selected
                          ? 'border-[#f97316] bg-[#f97316]/10 ring-2 ring-[#f97316]/40'
                          : 'border-border-ui bg-surface-subtle hover:bg-surface-subtle/70'
                      }`}
                    >
                      {Icon && (
                        <Icon
                          className={`w-7 h-7 ${selected ? 'text-[#f97316]' : 'text-text-sec'}`}
                        />
                      )}
                      <span className={`text-[11px] leading-tight ${selected ? 'text-text-pri font-medium' : 'text-text-sec'}`}>
                        {t(`type_${vt.code}` as never)}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            {typeError && (
              <p className="text-danger text-xs mt-1.5">{t('chooseTypeRequired')}</p>
            )}
          </div>

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
                        ? 'border-[#f97316] bg-[#f97316]/10 text-text-pri'
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
                      selected ? 'border-[#f97316] scale-110' : 'border-white/20'
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
