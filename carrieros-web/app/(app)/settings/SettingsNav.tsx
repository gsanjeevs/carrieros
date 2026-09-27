'use client'
// app/(app)/settings/SettingsNav.tsx
// Route-based tab bar for everything under /settings/* — Profile, Security, Developer API,
// Integrations, Branding, Support Desk. Previously each of these was its own flat top-level Sidebar
// entry under the "Team" section (8 items total there, mislabeled — none of Security/Developer
// API/Integrations/Branding/Support Desk are team management), a real overflow/IA problem found in
// this session's UX review. They already all lived under the same /settings/* URL prefix; this is
// purely a navigation change, not a route move — no link anywhere else in the app needed updating.
//
// components/ui/Tabs.tsx is NOT reused here: that component is an onChange-callback-driven,
// client-state tab switcher for staying on one page, not real navigation between independent server
// components at different URLs. This renders actual <Link>s (each /settings/* page keeps being its
// own server component, own data fetch, own capability check — this nav is purely presentational)
// and tracks the active tab via usePathname(), the same pattern Sidebar.tsx/AdminSidebar.tsx already
// use for their own active-link highlighting.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { cn } from '@/components/ui'

export interface SettingsTabItem {
  labelKey: string
  href: string
}

export default function SettingsNav({ items }: { items: SettingsTabItem[] }) {
  const pathname = usePathname()
  const t = useTranslations('nav')

  return (
    <div className="max-w-2xl mx-auto px-6 pt-8">
      <div role="tablist" className="flex gap-1 border-b border-divider-ui overflow-x-auto">
        {items.map((item) => {
          // Exact match for /settings itself (it's a prefix of every other tab's href too);
          // startsWith for the rest so a sub-route (e.g. /settings/integrations/webhooks, if one
          // is ever added) still highlights its parent tab.
          const active = item.href === '/settings' ? pathname === '/settings' : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              role="tab"
              aria-selected={active}
              className={cn(
                'shrink-0 py-2.5 px-3 text-[12px] font-semibold border-b-2 transition-colors whitespace-nowrap',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/50',
                active ? 'text-brand-orange border-brand-orange' : 'text-text-sec border-transparent hover:text-text-pri'
              )}
            >
              {t(item.labelKey as never)}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
