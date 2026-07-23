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
import { Card, StatusBadge, Table, TableHeaderCell, TableRow, TableCell, EmptyState } from '@/components/ui'
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
        <h1 className="text-2xl font-semibold text-text-pri mb-4">{t('title')}</h1>
        <Card>
          <EmptyState icon="payments" title={t('upgradeRequired')} />
        </Card>
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
          <h1 className="text-2xl font-semibold text-text-pri">{t('title')}</h1>
          <p className="text-text-sec text-sm mt-1">{t('settlementCount', { count: settlements.length })}</p>
        </div>
        {isStaff && <RunSettlementButton drivers={driversForForm} />}
      </div>

      {settlements.length === 0 ? (
        <Card>
          <EmptyState icon="payments" title={t('noSettlementsYet')} />
        </Card>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                {isStaff && <TableHeaderCell>{t('colDriver')}</TableHeaderCell>}
                <TableHeaderCell>{t('colPeriod')}</TableHeaderCell>
                <TableHeaderCell>{t('colMethod')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('colGross')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('colNet')}</TableHeaderCell>
                <TableHeaderCell>{t('colStatus')}</TableHeaderCell>
                {isStaff && <TableHeaderCell></TableHeaderCell>}
              </tr>
            </thead>
            <tbody>
              {settlements.map((s) => {
                const driverName = s.drivers
                  ? [s.drivers.profiles?.first_name, s.drivers.profiles?.last_name].filter(Boolean).join(' ') || s.drivers.driver_number
                  : '—'
                const status = (s.payment_status ?? 'pending') as SettlementStatus
                return (
                  <TableRow key={s.id}>
                    {isStaff && <TableCell className="font-medium text-text-pri">{driverName}</TableCell>}
                    <TableCell>
                      {s.period_start && s.period_end
                        ? `${formatDate(s.period_start, profile)} – ${formatDate(s.period_end, profile)}`
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {t(`payMethod_${s.pay_method}` as never)}
                      {s.rate_value != null && s.pay_method === 'percent_of_rate' && ` (${s.rate_value}%)`}
                      {s.rate_value != null && s.pay_method === 'per_mile' && ` ($${s.rate_value}/mi)`}
                      {s.rate_value != null && s.pay_method === 'flat_per_load' && ` ($${s.rate_value}/load)`}
                    </TableCell>
                    <TableCell numeric>{formatMoney(s.gross_revenue, 'USD', locale)}</TableCell>
                    <TableCell numeric className="font-medium text-text-pri">{formatMoney(s.net_pay, 'USD', locale)}</TableCell>
                    <TableCell>
                      <StatusBadge variant={settlementStatusVariant(status)} size="sm">
                        {t(`status_${status}`)}
                      </StatusBadge>
                    </TableCell>
                    {isStaff && (
                      <TableCell>
                        {status === 'pending' && (
                          <SendAchButton settlementId={s.id} entitled={achEntitled} />
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  )
}
