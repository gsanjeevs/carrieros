'use client'
// app/(app)/dispatch/DispatchMapClient.tsx
// Leaflet touches `window` at import time — must load client-only, never
// during the server render pass.
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import type { DispatchMapLoad } from '@/components/DispatchMap'

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

export default function DispatchMapClient({ loads, locale }: { loads: DispatchMapLoad[]; locale: string }) {
  return <DispatchMap loads={loads} locale={locale} />
}
