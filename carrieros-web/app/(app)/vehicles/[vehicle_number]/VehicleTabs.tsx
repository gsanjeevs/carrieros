'use client'
// app/(app)/vehicles/[vehicle_number]/VehicleTabs.tsx
// Client-side tab switcher for the vehicle detail page. All 4 tabs' content
// is server-rendered up front and passed in as ReactNodes — this component
// only controls which one is visible, no data fetching here.

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'

export type VehicleTabKey = 'details' | 'loadHistory' | 'maintenance' | 'fuel' | 'dvirs'

export default function VehicleTabs({
  tabs,
}: {
  tabs: { key: VehicleTabKey; content: ReactNode }[]
}) {
  const t = useTranslations('vehicles')
  const [active, setActive] = useState<VehicleTabKey>('details')

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-white/8 mb-6 overflow-x-auto" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            onClick={() => setActive(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50 rounded-t ${
              active === tab.key
                ? 'border-[#f97316] text-white'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {t(`tab_${tab.key}`)}
          </button>
        ))}
      </div>

      {tabs.map((tab) => (
        <div key={tab.key} role="tabpanel" hidden={active !== tab.key}>
          {active === tab.key && tab.content}
        </div>
      ))}
    </div>
  )
}
