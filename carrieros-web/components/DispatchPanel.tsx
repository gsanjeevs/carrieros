'use client'
// components/DispatchPanel.tsx
// Assign driver/vehicle and advance load status. Owner/solo/dispatcher only.

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

interface Driver { id: number; driver_number: string; default_vehicle_id: number | null; profiles: { first_name: string; last_name: string } | null }
interface Vehicle { id: number; vehicle_number: string; nickname: string }

const NEXT_STATUS: Record<string, string> = {
  draft:      'scheduled',
  scheduled:  'dispatched',
  dispatched: 'picked_up',
  picked_up:  'in_transit',
  in_transit: 'delivered',
  // 'delivered' → 'invoiced' and 'invoiced' → 'paid' are deliberately NOT here.
  // Those two transitions belong to the invoice flow: creating an invoice for
  // the load sets it to 'invoiced', and marking that invoice paid sets it to
  // 'paid'. This panel used to flip the status on its own with a button
  // labelled "Create Invoice" that created no invoice at all.
}

// Maps to loads.action* keys in messages/*.json, not hardcoded English.
const STATUS_ACTION_KEY: Record<string, string> = {
  draft:      'actionMarkScheduled',
  scheduled:  'actionDispatch',
  dispatched: 'actionMarkPickedUp',
  picked_up:  'actionMarkInTransit',
  in_transit: 'actionMarkDelivered',
}

export default function DispatchPanel({
  loadId, loadNumber, currentStatus, currentDriverId, currentVehicleId, orgId,
}: {
  loadId:           number
  loadNumber:       string
  currentStatus:    string
  currentDriverId:  number | null
  currentVehicleId: number | null
  orgId:            number
}) {
  const router = useRouter()
  const t = useTranslations('loads')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')

  function friendly(code?: string) {
    if (!code) return tCommon('somethingWentWrong')
    try {
      return tErrors(code as never)
    } catch {
      return tCommon('somethingWentWrong')
    }
  }

  const [drivers, setDrivers] = useState<Driver[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [driverId, setDriverId] = useState<string>(currentDriverId?.toString() ?? '')
  const [vehicleId, setVehicleId] = useState<string>(currentVehicleId?.toString() ?? '')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => {
    fetch('/api/drivers').then(r => r.json()).then(setDrivers).catch(() => {})
    fetch('/api/vehicles').then(r => r.json()).then(setVehicles).catch(() => {})
  }, [])

  async function save(newStatus?: string) {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/loads/${loadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver_id:  driverId  ? Number(driverId)  : null,
          vehicle_id: vehicleId ? Number(vehicleId) : null,
          status:    newStatus ?? currentStatus,
        }),
      })
      if (!res.ok) {
        const j = await res.json()
        throw new Error(friendly(j.error_code))
      }
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setSaving(false)
    }
  }

  function driverInitials(d: Driver): string {
    const name = d.profiles
      ? [d.profiles.first_name, d.profiles.last_name].filter(Boolean).join(' ')
      : d.driver_number
    const initials = name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
    return initials || d.driver_number.slice(0, 2).toUpperCase()
  }

  function selectDriver(id: string) {
    setDriverId(id)
    // Auto-fill the driver's default vehicle, but only if the vehicle field
    // is currently empty — never clobber a vehicle already chosen manually.
    if (!id || vehicleId) return
    const driver = drivers.find(d => d.id.toString() === id)
    if (driver?.default_vehicle_id) {
      setVehicleId(driver.default_vehicle_id.toString())
    }
  }

  const cardBaseCls = 'flex-shrink-0 flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition focus:outline-none focus:ring-2 focus:ring-[#f97316]/50'
  const cardSelectedCls = 'border-[#f97316] bg-[#f97316]/10'
  const cardUnselectedCls = 'border-white/10 bg-white/5 hover:bg-white/10'
  const nextStatus = NEXT_STATUS[currentStatus]
  const actionKey = STATUS_ACTION_KEY[currentStatus]
  const TERMINAL_STATUSES = ['delivered', 'invoiced', 'paid', 'cancelled']
  const canCancel = !TERMINAL_STATUSES.includes(currentStatus)

  function cancelLoad() {
    if (!window.confirm(t('confirmCancelLoad'))) return
    save('cancelled')
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">{t('assignDriver')}</label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => selectDriver('')}
            className={`${cardBaseCls} ${driverId === '' ? cardSelectedCls : cardUnselectedCls}`}
          >
            <span className="w-7 h-7 rounded-full bg-navy-light flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-avatar-text text-[16px]">person_off</span>
            </span>
            <span className="text-white text-xs font-medium">— {t('unassigned')} —</span>
          </button>
          {drivers.map(d => {
            const name = d.profiles
              ? [d.profiles.first_name, d.profiles.last_name].filter(Boolean).join(' ')
              : d.driver_number
            const isSelected = driverId === d.id.toString()
            return (
              <button
                type="button"
                key={d.id}
                onClick={() => selectDriver(d.id.toString())}
                className={`${cardBaseCls} ${isSelected ? cardSelectedCls : cardUnselectedCls}`}
              >
                <span className="w-7 h-7 rounded-full bg-navy-light flex items-center justify-center flex-shrink-0">
                  <span className="text-avatar-text text-xs font-semibold">{driverInitials(d)}</span>
                </span>
                <span className="min-w-0">
                  <span className="block text-white text-xs font-medium truncate max-w-[9rem]">{name}</span>
                  <span className="block text-slate-500 text-[10px]">{d.driver_number}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">{t('assignTruck')}</label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setVehicleId('')}
            className={`${cardBaseCls} ${vehicleId === '' ? cardSelectedCls : cardUnselectedCls}`}
          >
            <span className="w-7 h-7 rounded-full bg-navy-light flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-avatar-text text-[16px]">block</span>
            </span>
            <span className="text-white text-xs font-medium">— {t('unassigned')} —</span>
          </button>
          {vehicles.map(v => {
            const isSelected = vehicleId === v.id.toString()
            return (
              <button
                type="button"
                key={v.id}
                onClick={() => setVehicleId(v.id.toString())}
                className={`${cardBaseCls} ${isSelected ? cardSelectedCls : cardUnselectedCls}`}
              >
                <span className="w-7 h-7 rounded-full bg-navy-light flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-avatar-text text-[16px]">local_shipping</span>
                </span>
                <span className="min-w-0">
                  <span className="block text-white text-xs font-medium truncate max-w-[9rem]">{v.vehicle_number}</span>
                  <span className="block text-slate-500 text-[10px] truncate max-w-[9rem]">{v.nickname}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => save()}
          disabled={saving}
          className="flex-1 py-2 bg-white/5 hover:bg-white/10 text-white text-sm font-medium rounded-lg transition disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
        >
          {tCommon('save')}
        </button>
        {nextStatus && actionKey && (
          <button
            onClick={() => save(nextStatus)}
            disabled={saving}
            className="flex-1 py-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-sm font-semibold rounded-lg transition disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
          >
            {saving ? '…' : t(actionKey as never)}
          </button>
        )}
        {canCancel && (
          <button
            onClick={cancelLoad}
            disabled={saving}
            className="flex-1 py-2 bg-transparent border border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm font-medium rounded-lg transition disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-red-500/40"
          >
            {t('actionCancelLoad')}
          </button>
        )}
      </div>
    </div>
  )
}
