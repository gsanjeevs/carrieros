'use client'
// app/(app)/dispatch/DispatchMapClient.tsx
// Leaflet touches `window` at import time — must load client-only, never
// during the server render pass.
//
// Live updates: subscribes to Postgres Changes on TWO tables, filtered to
// this org, merging both into one DispatchMapPin list (components/DispatchMap.tsx):
//   - `loads` UPDATE — a driver's phone GPS ping (migration 0041).
//   - `vehicle_locations` INSERT/UPDATE — real telematics (migration 0042;
//     Motive webhook receiver / Samsara poller). This is what makes an idle
//     truck (no active load) start showing up live, not just at page load.
// Both require their table in the `supabase_realtime` publication (0041 for
// `loads`, 0042 for `vehicle_locations`). RLS still applies to the payload
// exactly as it does to a normal SELECT, same posture already documented for
// driver_messages/loads.
//
// Precedence when a vehicle has both a load pin and a vehicle pin: same rule
// as the server's initial query, applied continuously via dedupeByVehicle()
// on every render — whichever pin has the more recent lastLocationAt wins,
// not a fixed source priority. Each realtime event only ever upserts its OWN
// candidate pin (load-<id> or vehicle-<vehicleId>) into local state; the
// final dedupe pass right before rendering is what resolves which one
// actually gets drawn, so an out-of-order or slow-to-arrive event from one
// source can never permanently clobber a fresher reading from the other.
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { dedupeByVehicle, estimateMovement, type DispatchMapPin } from '@/lib/dispatch-map-pins'

const ACTIVE_STATUSES = new Set(['dispatched', 'picked_up', 'in_transit'])

function DispatchMapLoading() {
  const t = useTranslations('dispatch')
  return (
    <div className="h-[480px] w-full rounded-xl bg-surface-card border border-border-ui flex items-center justify-center">
      <span className="text-text-sec text-sm">{t('loadingMap')}</span>
    </div>
  )
}

const DispatchMap = dynamic(() => import('@/components/DispatchMap'), {
  ssr: false,
  loading: DispatchMapLoading,
})

type LoadLocationRow = {
  id: number
  load_number: string
  status: string
  vehicle_id: number | null
  last_location_lat: number | string | null
  last_location_lng: number | string | null
  last_location_at: string | null
}

type VehicleLocationRow = {
  id: number
  vehicle_id: number
  carrier_org_id: number
  lat: number | string
  lng: number | string
  recorded_at: string
  source: string
}

export default function DispatchMapClient({ pins, locale, orgId }: { pins: DispatchMapPin[]; locale: string; orgId: number }) {
  const [rawPins, setRawPins] = useState(pins)
  const [view, setView] = useState<'all' | 'moving' | 'loads' | 'parked' | 'unloaded' | 'stale'>('all')
  // DispatchMap derives each pin's live/stale badge from `now`, not by calling
  // Date.now() itself during render (impure, react-hooks/purity flags it) --
  // with no state changing otherwise, nothing would ever re-render it as time
  // passes, so a pin would look "live" forever even with no new location
  // update. This ticks `now` forward every minute so staleness is recomputed
  // even when nothing else has changed.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`dispatch-map-org-${orgId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'loads', filter: `carrier_org_id=eq.${orgId}` },
        (payload) => {
          const row = payload.new as LoadLocationRow
          const hasLocation = row.last_location_lat != null && row.last_location_lng != null && row.last_location_at != null
          const isActive = ACTIVE_STATUSES.has(row.status)
          const id = `load-${row.id}`

          setRawPins((prev) => {
            if (!hasLocation || !isActive) return prev.filter((p) => p.id !== id)
            const previous = prev.find((p) => p.id === id)
            const lat = Number(row.last_location_lat)
            const lng = Number(row.last_location_lng)
            const lastLocationAt = row.last_location_at as string
            const updated: DispatchMapPin = {
              id,
              kind: 'load',
              vehicleId: row.vehicle_id,
              label: row.load_number,
              status: row.status,
              // driverName isn't in this payload (Realtime sends the raw row, no joins) — keep
              // whatever the last known name was rather than blanking it out on every location tick.
              driverName: prev.find((p) => p.id === id)?.driverName ?? null,
              lat,
              lng,
              lastLocationAt,
              source: 'phone',
              onActiveLoad: true,
              movement: estimateMovement(previous, { lat, lng, lastLocationAt }),
              shipment: previous?.shipment,
            }
            const exists = prev.some((p) => p.id === id)
            return exists ? prev.map((p) => (p.id === id ? updated : p)) : [...prev, updated]
          })
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'vehicle_locations', filter: `carrier_org_id=eq.${orgId}` },
        (payload) => {
          const row = payload.new as VehicleLocationRow
          const id = `vehicle-${row.vehicle_id}`
          const source = row.source === 'samsara' || row.source === 'motive' ? row.source : 'phone'

          setRawPins((prev) => {
            const existing = prev.find((p) => p.id === id)
            const updated: DispatchMapPin = {
              id,
              kind: 'vehicle',
              vehicleId: row.vehicle_id,
              // No vehicle nickname/number in this payload (raw row, no join) — keep whatever label
              // was already known (from the initial server query, or a prior ping) rather than
              // showing a blank one; a brand-new never-before-seen vehicle falls back to its id.
              label: existing?.label ?? `#${row.vehicle_id}`,
              status: existing?.status ?? 'active',
              driverName: null,
              lat: Number(row.lat),
              lng: Number(row.lng),
              lastLocationAt: row.recorded_at,
              source,
              onActiveLoad: existing?.onActiveLoad ?? false,
              movement: estimateMovement(existing, { lat: Number(row.lat), lng: Number(row.lng), lastLocationAt: row.recorded_at }),
              shipment: existing?.shipment,
            }
            const exists = prev.some((p) => p.id === id)
            return exists ? prev.map((p) => (p.id === id ? updated : p)) : [...prev, updated]
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [orgId])

  const dedupedPins = useMemo(() => dedupeByVehicle(rawPins), [rawPins])
  const visiblePins = useMemo(() => dedupedPins.filter((pin) => {
    if (view === 'moving') return pin.movement === 'moving'
    if (view === 'loads') return pin.onActiveLoad
    if (view === 'parked') return pin.movement === 'stationary' && !pin.onActiveLoad
    if (view === 'unloaded') return !pin.onActiveLoad
    if (view === 'stale') return now - new Date(pin.lastLocationAt).getTime() > 15 * 60 * 1000
    return true
  }), [dedupedPins, now, view])
  const t = useTranslations('dispatch')

  const views = [
    ['all', t('mapViewAll'), dedupedPins.length],
    ['moving', t('mapViewMoving'), dedupedPins.filter((pin) => pin.movement === 'moving').length],
    ['loads', t('mapViewLoads'), dedupedPins.filter((pin) => pin.onActiveLoad).length],
    ['parked', t('mapViewParked'), dedupedPins.filter((pin) => pin.movement === 'stationary' && !pin.onActiveLoad).length],
    ['unloaded', t('mapViewUnloaded'), dedupedPins.filter((pin) => !pin.onActiveLoad).length],
    ['stale', t('mapViewStale'), dedupedPins.filter((pin) => now - new Date(pin.lastLocationAt).getTime() > 15 * 60 * 1000).length],
  ] as const

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={t('mapViews')}>
        {views.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            aria-pressed={view === key}
            onClick={() => setView(key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${view === key ? 'border-brand-orange bg-brand-orange/10 text-brand-orange' : 'border-border-ui text-text-sec hover:text-text-pri'}`}
          >{label} <span className="tabular-nums">{count}</span></button>
        ))}
      </div>
      <DispatchMap pins={visiblePins} locale={locale} now={now} />
    </>
  )
}
