// app/(app)/loads/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'
import { formatMoney } from '@/lib/format-money'
import { toDate } from '@/lib/format-datetime'
import { loadStatusVariant, type LoadStatus } from '@/lib/domain/load-status'
import StatusBadge from '@/components/ui/StatusBadge'
import { getProfileForUser } from '@/lib/queries/profiles'
import { INVOICE_ROLES } from '@/lib/roles-policy'

type LoadGroupKey = 'needs_dispatch' | 'in_progress' | 'completed' | 'cancelled' | 'declined'

const GROUPS: { key: LoadGroupKey; statuses: string[]; labelKey: string; accent: string }[] = [
  { key: 'needs_dispatch', statuses: ['draft', 'scheduled'], labelKey: 'groupNeedsDispatch', accent: 'border-l-[3px] border-l-[#f97316]' },
  { key: 'in_progress', statuses: ['dispatched', 'picked_up', 'in_transit'], labelKey: 'groupInProgress', accent: 'border-l-[3px] border-l-blue-500/60' },
  { key: 'completed', statuses: ['delivered', 'invoiced', 'paid'], labelKey: 'groupCompleted', accent: 'border-l-[3px] border-l-white/10' },
  { key: 'cancelled', statuses: ['cancelled'], labelKey: 'groupCancelled', accent: 'border-l-[3px] border-l-rose-500/40' },
  { key: 'declined', statuses: ['declined'], labelKey: 'groupDeclined', accent: 'border-l-[3px] border-l-rose-500/40' },
]

export default async function LoadsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; status?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)

  const params = await searchParams
  const justCreated = params.created
  const activeGroup = GROUPS.find((g) => g.key === params.status)

  const t = await getTranslations('loads')
  const locale = await getLocale()

  const statusLabel = (status: string) => t(`status_${status}` as never)

  let query = supabase
    .from('loads')
    .select('id, load_number, status, pickup_city, pickup_state, delivery_city, delivery_state, pickup_date, delivery_date, commodity, rate, customer_name_raw, driver_id')
    .order('created_at', { ascending: false })
    .limit(50)

  if (profile?.org_id) {
    query = query.eq('carrier_org_id', profile.org_id)
  }

  if (profile?.role === 'driver') {
    const { data: driver } = await supabase
      .from('drivers')
      .select('id')
      .eq('profile_id', user.id)
      .single()
    if (driver) query = query.eq('driver_id', driver.id)
  }

  if (activeGroup) {
    query = query.in('status', activeGroup.statuses)
  }

  const { data: loads } = await query
  const showRate = INVOICE_ROLES.includes(profile?.role ?? '')

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t('title')}</h1>
          <p className="text-slate-400 text-sm mt-1">{t('loadCount', { count: loads?.length ?? 0 })}</p>
        </div>
        <div className="flex items-center gap-3">
          {showRate && (
            <form action="/api/loads/export" method="get" className="flex items-center gap-2">
              <input type="date" name="from" aria-label={t('exportFrom')} className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-orange/50" />
              <span className="text-slate-500 text-xs">–</span>
              <input type="date" name="to" aria-label={t('exportTo')} className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-orange/50" />
              <button
                type="submit"
                className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/8 text-white text-xs font-medium rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                title={t('exportCsvHelp')}
              >
                <span className="material-symbols-outlined text-[16px]">download</span>
                {t('exportCsv')}
              </button>
            </form>
          )}
          <Link
            href="/loads/new"
            className="flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-sm font-semibold rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            {t('addLoad')}
          </Link>
        </div>
      </div>

      {justCreated && (
        <div className="mb-6 flex items-center gap-3 rounded-lg bg-[#16a34a]/10 border border-[#16a34a]/20 px-4 py-3">
          <span className="material-symbols-outlined text-[#16a34a] text-[18px]">check_circle</span>
          <p className="text-[#16a34a] text-sm">{t('createdSuccess', { loadNumber: justCreated })}</p>
        </div>
      )}

      {!loads || (loads.length === 0 && !activeGroup) ? (
        <div className="bg-white/5 border border-white/8 rounded-xl px-5 py-16 text-center shadow-card-dark">
          <span className="material-symbols-outlined text-slate-600 text-4xl">local_shipping</span>
          <p className="text-slate-500 text-sm mt-3">{t('noLoadsYet')}</p>
          <Link
            href="/loads/new"
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-sm font-medium rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            {t('createFirstLoad')}
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <Link
              href="/loads"
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50 ${
                !activeGroup
                  ? 'bg-[#f97316] text-white'
                  : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200'
              }`}
            >
              {t('filterAll')}
            </Link>
            {GROUPS.map((group) => (
              <Link
                key={group.key}
                href={`/loads?status=${group.key}`}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50 ${
                  activeGroup?.key === group.key
                    ? 'bg-[#f97316] text-white'
                    : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200'
                }`}
              >
                {t(group.labelKey)}
              </Link>
            ))}
          </div>

          {loads.length === 0 && activeGroup && (
            <div className="bg-white/5 border border-white/8 rounded-xl px-5 py-16 text-center shadow-card-dark">
              <span className="material-symbols-outlined text-slate-600 text-4xl">local_shipping</span>
              <p className="text-slate-500 text-sm mt-3">{t('noLoadsInGroup')}</p>
            </div>
          )}

          <div className="space-y-8">
            {GROUPS.map((group) => {
              const groupLoads = loads.filter((load) => group.statuses.includes(load.status ?? ''))
              if (groupLoads.length === 0) return null

              return (
                <div key={group.key}>
                  <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                    {t(group.labelKey)} ({groupLoads.length})
                  </h2>
                  <div className="space-y-2">
                    {groupLoads.map((load) => {
                      const statusKey = (load.status ?? 'draft') as LoadStatus
                      const route =
                        [load.pickup_city, load.pickup_state].filter(Boolean).join(', ') +
                        ' → ' +
                        [load.delivery_city, load.delivery_state].filter(Boolean).join(', ')

                      return (
                        <div
                          key={load.id}
                          className={`bg-white/5 border border-white/8 ${group.accent} rounded-xl px-5 py-4 shadow-card-dark hover:bg-white/[0.07] transition-colors duration-150 flex items-center justify-between gap-4`}
                        >
                          <div className="flex items-center gap-4 min-w-0 flex-1">
                            <Link
                              href={`/loads/${load.load_number}`}
                              className="text-white font-medium hover:text-[#f97316] transition-colors rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50 shrink-0"
                            >
                              {load.load_number}
                            </Link>
                            <span className="shrink-0">
                              <StatusBadge variant={loadStatusVariant(statusKey)} size="sm">
                                {statusLabel(statusKey)}
                              </StatusBadge>
                            </span>
                            <span className="text-slate-300 text-sm truncate">{route}</span>
                          </div>

                          <div className="flex items-center gap-6 shrink-0">
                            <span className="text-slate-400 text-sm hidden sm:inline">
                              {load.pickup_date
                                ? toDate(load.pickup_date).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
                                : '—'}
                            </span>
                            <span className="text-slate-400 text-sm max-w-[160px] truncate hidden md:inline">
                              {load.customer_name_raw ?? '—'}
                            </span>
                            {showRate && (
                              <span className="text-white font-medium text-sm">
                                {formatMoney(load.rate, 'USD', locale)}
                              </span>
                            )}
                            {group.key === 'needs_dispatch' && (
                              <Link
                                href={`/loads/${load.load_number}`}
                                className="flex items-center gap-1 px-3 py-1.5 bg-[#f97316]/10 hover:bg-[#f97316]/20 text-[#f97316] text-xs font-semibold rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                              >
                                {t('dispatchAction')}
                              </Link>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
