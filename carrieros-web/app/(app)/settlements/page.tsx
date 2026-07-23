// app/(app)/settlements/page.tsx
// Driver Settlement UI (audit gap #7) — owner/solo/finance run settlements
// and view the full org list; drivers see only their own (RLS's
// driver_own_settlements_select does the actual scoping — dispatchers have
// no access at all, matching driver_settlements' RLS, which has no
// dispatcher policy). driver_settlements itself is Growth+
// (SETTLEMENT_ROLES's gate in app/api/settlements/run/route.ts); this page
// shows an upgrade prompt to staff on lower tiers rather than an empty list.
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations, getLocale } from 'next-intl/server'
import { formatDate } from '@/lib/format-datetime'
import { formatMoney } from '@/lib/format-money'
import { hasFeature } from '@/lib/entitlements'
import { settlementStatusVariant, type SettlementStatus } from '@/lib/domain/settlement-status'
import StatusBadge from '@/components/ui/StatusBadge'
import RunSettlementButton from './RunSettlementButton'
import SendAchButton from './SendAchButton'

const STAFF_ROLES = ['owner', 'solo', 'finance']
const VIEW_ROLES = ['owner', 'solo', 'finance', 'driver']

export default async function SettlementsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role, date_format, time_format')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) redirect('/onboarding')
  if (!VIEW_ROLES.includes(profile.role)) redirect('/dashboard')

  const isStaff = STAFF_ROLES.includes(profile.role)
  const t = await getTranslations('settlements')
  const locale = await getLocale()

  const [entitled, achEntitled] = await Promise.all([
    hasFeature(supabase, 'driver_settlements'),
    hasFeature(supabase, 'settlement_ach'),
  ])

  if (isStaff && !entitled) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-white mb-4">{t('title')}</h1>
        <div className="bg-white/5 border border-white/8 rounded-xl px-5 py-16 text-center shadow-card-dark">
          <span className="material-symbols-outlined text-slate-600 text-4xl">payments</span>
          <p className="text-slate-400 text-sm mt-3">{t('upgradeRequired')}</p>
        </div>
      </div>
    )
  }

  const { data: settlementsData } = await supabase
    .from('driver_settlements')
    .select('id, driver_id, pay_method, gross_revenue, net_pay, loads_count, rate_value, payment_status, period_start, period_end, created_at, drivers(driver_number, profiles(first_name, last_name))')
    .order('created_at', { ascending: false })

  const settlements = settlementsData ?? []

  let driversForForm: { id: number; label: string; settlementType: string | null; settlementRate: number | null }[] = []
  if (isStaff) {
    const { data: driverRows } = await supabase
      .from('drivers')
      .select('id, driver_number, settlement_type, settlement_rate, profiles(first_name, last_name)')
      .eq('carrier_org_id', profile.org_id)
      .eq('is_active', true)
      .order('driver_number')

    driversForForm = (driverRows ?? []).map((d) => ({
      id: d.id,
      label: [d.profiles?.first_name, d.profiles?.last_name].filter(Boolean).join(' ') || d.driver_number || `#${d.id}`,
      settlementType: d.settlement_type,
      settlementRate: d.settlement_rate != null ? Number(d.settlement_rate) : null,
    }))
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t('title')}</h1>
          <p className="text-slate-400 text-sm mt-1">{t('settlementCount', { count: settlements.length })}</p>
        </div>
        {isStaff && <RunSettlementButton drivers={driversForForm} />}
      </div>

      {settlements.length === 0 ? (
        <div className="bg-white/5 border border-white/8 rounded-xl px-5 py-16 text-center shadow-card-dark">
          <span className="material-symbols-outlined text-slate-600 text-4xl">payments</span>
          <p className="text-slate-500 text-sm mt-3">{t('noSettlementsYet')}</p>
        </div>
      ) : (
        <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-card-dark">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                {isStaff && <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('colDriver')}</th>}
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('colPeriod')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('colMethod')}</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('colGross')}</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('colNet')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('colStatus')}</th>
                {isStaff && <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {settlements.map((s) => {
                const driverName = s.drivers
                  ? [s.drivers.profiles?.first_name, s.drivers.profiles?.last_name].filter(Boolean).join(' ') || s.drivers.driver_number
                  : '—'
                const status = (s.payment_status ?? 'pending') as SettlementStatus
                return (
                  <tr key={s.id} className="hover:bg-white/[0.07] transition-colors duration-150">
                    {isStaff && <td className="px-5 py-3.5 text-white font-medium">{driverName}</td>}
                    <td className="px-4 py-3.5 text-slate-300">
                      {s.period_start && s.period_end
                        ? `${formatDate(s.period_start, profile)} – ${formatDate(s.period_end, profile)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3.5 text-slate-400">
                      {t(`payMethod_${s.pay_method}` as never)}
                      {s.rate_value != null && s.pay_method === 'percent_of_rate' && ` (${s.rate_value}%)`}
                      {s.rate_value != null && s.pay_method === 'per_mile' && ` ($${s.rate_value}/mi)`}
                      {s.rate_value != null && s.pay_method === 'flat_per_load' && ` ($${s.rate_value}/load)`}
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-300">{formatMoney(s.gross_revenue, 'USD', locale)}</td>
                    <td className="px-4 py-3.5 text-right text-white font-medium">{formatMoney(s.net_pay, 'USD', locale)}</td>
                    <td className="px-4 py-3.5">
                      <StatusBadge variant={settlementStatusVariant(status)} size="sm">
                        {t(`status_${status}`)}
                      </StatusBadge>
                    </td>
                    {isStaff && (
                      <td className="px-4 py-3.5">
                        {status === 'pending' && (
                          <SendAchButton settlementId={s.id} entitled={achEntitled} />
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
