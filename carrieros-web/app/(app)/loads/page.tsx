// app/(app)/loads/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'
import { formatMoney } from '@/lib/format-money'
import { toDate } from '@/lib/format-datetime'
import { loadStatusVariant, type LoadStatus } from '@/lib/domain/load-status'
import { Card, EmptyState, Input, StatusBadge } from '@/components/ui'
import LiveRefresh from '@/components/LiveRefresh'
import { createLoadQueryService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import { LOAD_STATUS_GROUPS } from '@/server/domain/load/status-groups'

type LoadGroupKey = 'needs_dispatch' | 'in_progress' | 'completed' | 'cancelled' | 'declined'

const GROUPS: { key: LoadGroupKey; statuses: string[]; labelKey: string; accent: string }[] = [
  { key: 'needs_dispatch', statuses: [...LOAD_STATUS_GROUPS.needs_dispatch], labelKey: 'groupNeedsDispatch', accent: 'border-l-[3px] border-l-brand-orange' },
  { key: 'in_progress', statuses: [...LOAD_STATUS_GROUPS.in_progress], labelKey: 'groupInProgress', accent: 'border-l-[3px] border-l-blue-500/60' },
  { key: 'completed', statuses: [...LOAD_STATUS_GROUPS.completed], labelKey: 'groupCompleted', accent: 'border-l-[3px] border-l-border-ui' },
  { key: 'cancelled', statuses: [...LOAD_STATUS_GROUPS.cancelled], labelKey: 'groupCancelled', accent: 'border-l-[3px] border-l-rose-500/40' },
  { key: 'declined', statuses: [...LOAD_STATUS_GROUPS.declined], labelKey: 'groupDeclined', accent: 'border-l-[3px] border-l-rose-500/40' },
]

export default async function LoadsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; status?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const actor = await buildActorContext(supabase, user, crypto.randomUUID())
  if (!actor.ok) redirect('/onboarding')

  const params = await searchParams
  const justCreated = params.created
  const activeGroup = GROUPS.find((g) => g.key === params.status)

  const t = await getTranslations('loads')
  const locale = await getLocale()

  const statusLabel = (status: string) => t(`status_${status}` as never)

  // Same service the /api/v1/loads endpoint uses (mobile, web client code):
  // tenant scoping, driver restriction and rate visibility are decided there.
  const result = await createLoadQueryService(supabase).list(actor.value, {
    statusGroups: activeGroup?.key ? [activeGroup.key] : undefined,
  })
  const loads = result.ok ? result.value.loads : []
  const showRate = result.ok && result.value.canSeeRate

  return (
    <div className="p-8">
      <LiveRefresh entities={['loads']} />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t('title')}</h1>
          <p className="text-slate-400 text-sm mt-1">{t('loadCount', { count: loads?.length ?? 0 })}</p>
        </div>
        <div className="flex items-center gap-3">
          {showRate && (
            <form action="/api/loads/export" method="get" className="flex items-center gap-2">
              <Input type="date" name="from" size="sm" aria-label={t('exportFrom')} />
              <span className="text-text-sec text-xs">–</span>
              <Input type="date" name="to" size="sm" aria-label={t('exportTo')} />
              <button
                type="submit"
                className="flex items-center gap-1.5 px-3 py-2 bg-surface-subtle hover:bg-surface-subtle/70 border border-border-ui text-text-pri text-xs font-medium rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                title={t('exportCsvHelp')}
              >
                <span className="material-symbols-outlined text-[16px]">download</span>
                {t('exportCsv')}
              </button>
            </form>
          )}
          <Link
            href="/loads/new"
            className="flex items-center gap-2 px-4 py-2 bg-brand-orange hover:bg-brand-orange-hover text-white text-sm font-semibold rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            {t('addLoad')}
          </Link>
        </div>
      </div>

      {justCreated && (
        <div className="mb-6 flex items-center gap-3 rounded-lg bg-success/10 border border-success/20 px-4 py-3">
          <span className="material-symbols-outlined text-success text-[18px]">check_circle</span>
          <p className="text-success text-sm">{t('createdSuccess', { loadNumber: justCreated })}</p>
        </div>
      )}

      {!loads || (loads.length === 0 && !activeGroup) ? (
        <Card>
          <div className="flex flex-col items-center pb-8">
            <EmptyState icon="local_shipping" title={t('noLoadsYet')} />
            <Link
              href="/loads/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-brand-orange hover:bg-brand-orange-hover text-white text-sm font-medium rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              {t('createFirstLoad')}
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <Link
              href="/loads"
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-brand-orange/50 ${
                !activeGroup
                  ? 'bg-brand-orange text-white'
                  : 'bg-surface-subtle text-text-sec hover:bg-surface-subtle/70 hover:text-text-pri'
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
                    ? 'bg-brand-orange text-white'
                    : 'bg-surface-subtle text-text-sec hover:bg-surface-subtle/70 hover:text-text-pri'
                }`}
              >
                {t(group.labelKey)}
              </Link>
            ))}
          </div>

          {loads.length === 0 && activeGroup && (
            <Card>
              <EmptyState icon="local_shipping" title={t('noLoadsInGroup')} />
            </Card>
          )}

          <div className="space-y-8">
            {GROUPS.map((group) => {
              const groupLoads = loads.filter((load) => group.statuses.includes(load.status ?? ''))
              if (groupLoads.length === 0) return null

              return (
                <div key={group.key}>
                  <h2 className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-3">
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
                        <Link key={load.id} href={`/loads/${load.load_number}`} className="block">
                          <Card variant="interactive" className={`${group.accent} px-5 py-4 flex items-center justify-between gap-4`}>
                            <div className="flex items-center gap-4 min-w-0 flex-1">
                              <span className="text-text-pri font-medium shrink-0">{load.load_number}</span>
                              <span className="shrink-0">
                                <StatusBadge variant={loadStatusVariant(statusKey)} size="sm">
                                  {statusLabel(statusKey)}
                                </StatusBadge>
                              </span>
                              <span className="text-text-sec text-sm truncate">{route}</span>
                            </div>

                            <div className="flex items-center gap-6 shrink-0">
                              <span className="text-text-mut text-sm hidden sm:inline">
                                {load.pickup_date
                                  ? toDate(load.pickup_date).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
                                  : '—'}
                              </span>
                              <span className="text-text-mut text-sm max-w-[160px] truncate hidden md:inline">
                                {load.customer_name_raw ?? '—'}
                              </span>
                              {showRate && (
                                <span className="text-text-pri font-medium text-sm">
                                  {formatMoney(load.rate, 'USD', locale)}
                                </span>
                              )}
                              {group.key === 'needs_dispatch' && (
                                <span className="flex items-center gap-1 px-3 py-1.5 bg-brand-orange/10 text-brand-orange text-xs font-semibold rounded-lg">
                                  {t('dispatchAction')}
                                </span>
                              )}
                            </div>
                          </Card>
                        </Link>
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
