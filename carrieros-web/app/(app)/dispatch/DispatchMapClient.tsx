'use client'
// app/(app)/dispatch/DispatchMapClient.tsx
// Leaflet touches `window` at import time — must load client-only, never
// during the server render pass.
import dynamic from 'next/dynamic'
import type { DispatchMapLoad } from '@/components/DispatchMap'

const DispatchMap = dynamic(() => import('@/components/DispatchMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[480px] w-full rounded-xl bg-white/5 border border-white/8 flex items-center justify-center">
      <span className="text-slate-500 text-sm">Loading map…</span>
    </div>
  ),
})

export default function DispatchMapClient({ loads, locale }: { loads: DispatchMapLoad[]; locale: string }) {
  return <DispatchMap loads={loads} locale={locale} />
}
