// app/(app)/drivers/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations, getLocale } from 'next-intl/server'
import Link from 'next/link'
import InviteDriverButton from './InviteDriverButton'
import ExceptionChip from '@/components/ExceptionChip'
import { getExceptions } from '@/lib/exceptions'
import { inviteStatusVariant, type InviteStatus } from '@/lib/domain/invite-status'
import { cdlGlowStatus } from '@/lib/domain/driver-compliance'
import { Card, EmptyState, StatusBadge, Table, TableHeaderCell, TableRow, TableCell } from '@/components/ui'
import { getProfileForUser } from '@/lib/queries/profiles'

type Driver = {
  id: number
  driver_number: string
  invite_status: string
  default_vehicle_id: number | null
  cdl_number: string | null
  cdl_class: string | null
  cdl_state: string | null
  cdl_expiry: string | null
  med_cert_expiry: string | null
  endorsements: string[] | null
  is_active: boolean
  profiles: { first_name: string | null; last_name: string | null; phone: string | null } | null
}

type Vehicle = {
  id: number
  vehicle_number: string | null
  nickname: string | null
}

export default async function DriversPage({
  searchParams,
}: {
  searchParams: Promise<{ invited?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)

  const params = await searchParams
  const justInvited = params.invited
  const canManage = ['owner', 'solo'].includes(profile?.role ?? '')

  const t = await getTranslations('drivers')
  const locale = await getLocale()

  let drivers: Driver[] = []
  let vehicles: Vehicle[] = []
  let exceptions: Awaited<ReturnType<typeof getExceptions>> = []

  if (profile?.org_id) {
    const [{ data }, exceptionItems] = await Promise.all([
      supabase
        .from('drivers')
        .select('id, driver_number, invite_status, default_vehicle_id, cdl_number, cdl_class, cdl_state, cdl_expiry, med_cert_expiry, endorsements, is_active, profiles(first_name, last_name, phone)')
        .eq('carrier_org_id', profile.org_id)
        .eq('is_active', true)
        .order('driver_number'),
      getExceptions(supabase, profile.org_id),
    ])
    drivers = (data ?? []) as unknown as Driver[]
    exceptions = exceptionItems

    if (canManage) {
      const { data: vehicleData } = await supabase
        .from('vehicles')
        .select('id, vehicle_number, nickname')
        .eq('carrier_org_id', profile.org_id)
        .eq('is_active', true)
        .order('vehicle_number')
      vehicles = vehicleData ?? []
    }
  }

  // get_exceptions() is already sorted most-urgent-first — first match per
  // driver is its top exception.
  const topExceptionByDriver = new Map<number, (typeof exceptions)[number]>()
  for (const item of exceptions) {
    if (item.entity_type === 'driver' && !topExceptionByDriver.has(item.entity_id)) {
      topExceptionByDriver.set(item.entity_id, item)
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-text-pri">{t('title')}</h1>
          <p className="text-text-sec text-sm mt-1">{t('driverCount', { count: drivers.length })}</p>
        </div>
        {canManage && <InviteDriverButton vehicles={vehicles} />}
      </div>

      {justInvited && (
        <div className="mb-6 flex items-center gap-3 rounded-lg bg-success/10 border border-success/20 px-4 py-3">
          <span className="material-symbols-outlined text-success text-[18px]">check_circle</span>
          <p className="text-success text-sm">{t('invitedSuccess', { driverNumber: justInvited })}</p>
        </div>
      )}

      {drivers.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center pb-8">
            <EmptyState icon="person" title={t('noDriversYet')} />
            {canManage && <InviteDriverButton vehicles={vehicles} variant="empty" />}
          </div>
        </Card>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <TableHeaderCell>{t('driverNumber')}</TableHeaderCell>
                <TableHeaderCell>{t('name')}</TableHeaderCell>
                <TableHeaderCell>{t('status')}</TableHeaderCell>
                <TableHeaderCell>{t('phone')}</TableHeaderCell>
                <TableHeaderCell>{t('cdlExpiry')}</TableHeaderCell>
                <TableHeaderCell>{t('medCertExpiry')}</TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {drivers.map((driver) => {
                const inviteStatus = (driver.invite_status || 'pending') as InviteStatus
                const name = [driver.profiles?.first_name, driver.profiles?.last_name].filter(Boolean).join(' ') || '—'

                const glow = cdlGlowStatus(driver.cdl_expiry)
                const glowDotClass =
                  glow === 'success' ? 'bg-[#16a34a] shadow-glow-success' :
                  glow === 'warning' ? 'bg-amber-500 shadow-glow-warning' :
                  'bg-rose-500 shadow-glow-danger'
                const topException = topExceptionByDriver.get(driver.id)

                return (
                  <TableRow key={driver.id}>
                    <TableCell className="font-medium text-text-pri">
                      <Link
                        href={`/drivers/${driver.driver_number}`}
                        className="hover:text-brand-orange transition-colors rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                      >
                        {driver.driver_number}
                      </Link>
                    </TableCell>
                    <TableCell>{name}</TableCell>
                    <TableCell>
                      <StatusBadge variant={inviteStatusVariant(inviteStatus)} size="sm">
                        {t(`inviteStatus_${inviteStatus}`)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>{driver.profiles?.phone ?? '—'}</TableCell>
                    <TableCell>
                      <div className="inline-flex flex-col gap-1.5 rounded-lg border border-border-ui bg-white/[0.03] px-3 py-2 min-w-[148px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 text-2xs font-semibold tracking-wide">
                            {driver.cdl_class ? t('cdlClass', { class: driver.cdl_class }) : t('cdlClassUnknown')}
                          </span>
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${glowDotClass}`}
                            style={{
                              boxShadow:
                                glow === 'success' ? 'var(--shadow-glow-success)' :
                                glow === 'warning' ? 'var(--shadow-glow-warning)' :
                                'var(--shadow-glow-danger)',
                            }}
                          />
                        </div>
                        <div className="text-slate-400 text-xs">
                          {driver.cdl_expiry
                            ? new Date(driver.cdl_expiry).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
                            : '—'}
                        </div>
                        {driver.endorsements && driver.endorsements.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {driver.endorsements.map((code) => (
                              <span
                                key={code}
                                className="inline-flex items-center px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/5 text-amber-400 text-2xs font-medium"
                              >
                                {t.has(`endorsement_${code}`) ? t(`endorsement_${code}`) : code}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {driver.med_cert_expiry
                        ? new Date(driver.med_cert_expiry).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
                        : '—'}
                    </TableCell>
                    <TableCell>{topException && <ExceptionChip item={topException} />}</TableCell>
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
