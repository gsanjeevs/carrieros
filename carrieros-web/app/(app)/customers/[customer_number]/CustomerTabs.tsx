'use client'
// app/(app)/customers/[customer_number]/CustomerTabs.tsx
// Client-side tab switcher for the customer detail page. All tab content is
// server-rendered up front and passed in as ReactNodes — this component only
// controls which one is visible, no data fetching here. Same shape as
// vehicles/[vehicle_number]/VehicleTabs.tsx.

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'

export type CustomerTabKey = 'overview' | 'loads' | 'exceptions' | 'invoices' | 'contacts'

export default function CustomerTabs({
  tabs,
}: {
  tabs: { key: CustomerTabKey; content: ReactNode }[]
}) {
  const t = useTranslations('customers')
  const [active, setActive] = useState<CustomerTabKey>('overview')

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-border-ui mb-6 overflow-x-auto" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            onClick={() => setActive(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50 rounded-t ${
              active === tab.key
                ? 'border-brand-orange text-white'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {t(`detailTab_${tab.key}`)}
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
