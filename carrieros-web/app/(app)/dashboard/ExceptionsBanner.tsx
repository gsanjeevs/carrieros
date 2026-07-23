// app/(app)/dashboard/ExceptionsBanner.tsx
// Lightweight summary banner shown near the top of Owner/Solo (via
// OwnerView, embedded) and Dispatcher dashboards: total exception count
// (ungated — safety/compliance signals stay visible at every tier, only the
// full inbox's rendered list is tier-gated) + the single most-urgent item's
// title + a link to the full /exceptions inbox. Zero exceptions renders a
// positive all-clear state instead of an empty banner.
import Link from 'next/link'
import { getExceptions } from '@/lib/exceptions'
import { createClient } from '@/lib/supabase/server'
import { getTranslations } from 'next-intl/server'
import { Card } from '@/components/ui'

export default async function ExceptionsBanner({ orgId }: { orgId: number | undefined }) {
  const supabase = await createClient()
  const t = await getTranslations('dashboard')

  const items = await getExceptions(supabase, orgId)

  if (items.length === 0) {
    return (
      <Card className="px-5 py-4 mb-6 flex items-center gap-3">
        <span className="material-symbols-outlined text-success text-[20px]">check_circle</span>
        <div>
          <p className="text-text-pri text-sm font-medium">{t('exceptionsAllClear')}</p>
          <p className="text-text-mut text-xs">{t('exceptionsAllClearSub')}</p>
        </div>
      </Card>
    )
  }

  const top = items[0]

  return (
    <Link
      href="/exceptions"
      className="block mb-6 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
    >
      <Card className="px-5 py-4 hover:bg-surface-subtle transition-colors">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="material-symbols-outlined text-danger text-[20px]">warning</span>
            <div className="min-w-0">
              <p className="text-text-pri text-sm font-medium">
                {t('exceptionsCount', { count: items.length })}
              </p>
              <p className="text-text-sec text-xs truncate">{top.title} — {top.detail}</p>
            </div>
          </div>
          <span className="text-brand-orange text-xs font-medium flex-shrink-0">{t('exceptionsViewAll')} →</span>
        </div>
      </Card>
    </Link>
  )
}
