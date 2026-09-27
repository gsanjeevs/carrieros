'use client'
// app/(app)/dispatch/DispatchMapClient.tsx
// Leaflet touches `window` at import time — must load client-only, never
// during the server render pass.
//
// Live updates (2026-09-26): subscribes to Postgres Changes UPDATE events on
// `loads`, filtered to this org, so a pin's position moves the moment the
// driver's phone (share-location-section.tsx) writes a new
// last_location_lat/lng/last_location_at — no page reload needed. Requires
// `loads` to be in the `supabase_realtime` publication (migration 0041; it
// wasn't, before this feature — see that migration's header comment). RLS
// still applies to the payload exactly as it does to a normal SELECT, same
// posture DriverMessageThread.tsx already documents for driver_messages.
//
// A load leaving the active-status set (delivered, etc.) is removed from the
// map; a load newly entering it (e.g. just got dispatched with a location
// already on file) is added — both derived from the same UPDATE payload,
// not a second query.
import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import type { DispatchMapLoad } from '@/components/DispatchMap'

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
  last_location_lat: number | string | null
  last_location_lng: number | string | null
  last_location_at: string | null
}

export default function DispatchMapClient({ loads, locale, orgId }: { loads: DispatchMapLoad[]; locale: string; orgId: number }) {
  const [mapLoads, setMapLoads] = useState(loads)
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

          setMapLoads((prev) => {
            if (!hasLocation || !isActive) return prev.filter((l) => l.id !== row.id)
            const updated: DispatchMapLoad = {
              id: row.id,
              loadNumber: row.load_number,
              status: row.status,
              // driverName isn't in this payload (Realtime sends the raw row, no joins) — keep
              // whatever the last known name was rather than blanking it out on every location tick.
              driverName: prev.find((l) => l.id === row.id)?.driverName ?? null,
              lat: Number(row.last_location_lat),
              lng: Number(row.last_location_lng),
              lastLocationAt: row.last_location_at as string,
            }
            const exists = prev.some((l) => l.id === row.id)
            return exists ? prev.map((l) => (l.id === row.id ? updated : l)) : [...prev, updated]
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [orgId])

  return <DispatchMap loads={mapLoads} locale={locale} now={now} />
}
