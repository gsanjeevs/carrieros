'use client'
// components/DispatchPanel.tsx
// Assign driver/truck and advance load status. Owner/solo/dispatcher only.

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

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

const STATUS_ACTION: Record<string, string> = {
  draft:      'Mark Scheduled',
  scheduled:  'Dispatch',
  dispatched: 'Mark Picked Up',
  picked_up:  'Mark In Transit',
  in_transit: 'Mark Delivered',
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
        throw new Error(j.error ?? 'Failed')
      }
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  const selectCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#f97316] transition'
  const nextStatus = NEXT_STATUS[currentStatus]
  const actionLabel = STATUS_ACTION[currentStatus]

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Assign Driver</label>
        <select className={selectCls} value={driverId} onChange={e => setDriverId(e.target.value)}>
          <option value="">— Unassigned —</option>
          {drivers.map(d => {
            const name = d.profiles
              ? [d.profiles.first_name, d.profiles.last_name].filter(Boolean).join(' ')
              : d.driver_number
            return <option key={d.id} value={d.id}>{d.driver_number} · {name}</option>
          })}
        </select>
      </div>

      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Assign Truck</label>
        <select className={selectCls} value={truckId} onChange={e => setTruckId(e.target.value)}>
          <option value="">— Unassigned —</option>
          {trucks.map(t => (
            <option key={t.id} value={t.id}>{t.truck_number} · {t.nickname}</option>
          ))}
        </select>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => save()}
          disabled={saving}
          className="flex-1 py-2 bg-white/5 hover:bg-white/10 text-white text-sm font-medium rounded-lg transition disabled:opacity-40"
        >
          Save
        </button>
        {nextStatus && actionLabel && (
          <button
            onClick={() => save(nextStatus)}
            disabled={saving}
            className="flex-1 py-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-sm font-semibold rounded-lg transition disabled:opacity-40"
          >
            {saving ? '…' : actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}
