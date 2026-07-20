'use client'
// components/DispatchPanel.tsx
// Assign driver/truck and advance load status. Owner/solo/dispatcher only.

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

interface Driver { id: number; driver_number: string; profiles: { first_name: string; last_name: string } | null }
interface Truck  { id: number; truck_number: string; nickname: string }

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
  loadId, loadNumber, currentStatus, currentDriverId, currentTruckId, orgId,
}: {
  loadId:          number
  loadNumber:      string
  currentStatus:   string
  currentDriverId: number | null
  currentTruckId:  number | null
  orgId:           number
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
  const [trucks,  setTrucks]  = useState<Truck[]>([])
  const [driverId, setDriverId] = useState<string>(currentDriverId?.toString() ?? '')
  const [truckId,  setTruckId]  = useState<string>(currentTruckId?.toString()  ?? '')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => {
    fetch('/api/drivers').then(r => r.json()).then(setDrivers).catch(() => {})
    fetch('/api/trucks').then(r => r.json()).then(setTrucks).catch(() => {})
  }, [])

  async function save(newStatus?: string) {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/loads/${loadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver_id: driverId ? Number(driverId) : null,
          truck_id:  truckId  ? Number(truckId)  : null,
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

  const selectCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#f97316] focus:ring-2 focus:ring-[#f97316]/40 transition'
  const nextStatus = NEXT_STATUS[currentStatus]
  const actionKey = STATUS_ACTION_KEY[currentStatus]

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">{t('assignDriver')}</label>
        <select className={selectCls} value={driverId} onChange={e => setDriverId(e.target.value)}>
          <option value="">— {t('unassigned')} —</option>
          {drivers.map(d => {
            const name = d.profiles
              ? [d.profiles.first_name, d.profiles.last_name].filter(Boolean).join(' ')
              : d.driver_number
            return <option key={d.id} value={d.id}>{d.driver_number} · {name}</option>
          })}
        </select>
      </div>

      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">{t('assignTruck')}</label>
        <select className={selectCls} value={truckId} onChange={e => setTruckId(e.target.value)}>
          <option value="">— {t('unassigned')} —</option>
          {trucks.map(tr => (
            <option key={tr.id} value={tr.id}>{tr.truck_number} · {tr.nickname}</option>
          ))}
        </select>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => save()}
          disabled={saving}
          className="flex-1 py-2 bg-white/5 hover:bg-white/10 text-white text-sm font-medium rounded-lg transition disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[#f97316]/50"
        >
          {tCommon('save')}
        </button>
        {nextStatus && actionKey && (
          <button
            onClick={() => save(nextStatus)}
            disabled={saving}
            className="flex-1 py-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-sm font-semibold rounded-lg transition disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[#f97316]/50"
          >
            {saving ? '…' : t(actionKey as never)}
          </button>
        )}
      </div>
    </div>
  )
}
