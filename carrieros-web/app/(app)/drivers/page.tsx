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
import StatusBadge from '@/components/ui/StatusBadge'

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

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

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
          <h1 className="text-2xl font-semibold text-white">{t('title')}</h1>
          <p className="text-slate-400 text-sm mt-1">{t('driverCount', { count: drivers.length })}</p>
        </div>
        {canManage && <InviteDriverButton vehicles={vehicles} />}
      </div>

      {justInvited && (
        <div className="mb-6 flex items-center gap-3 rounded-lg bg-[#16a34a]/10 border border-[#16a34a]/20 px-4 py-3">
          <span className="material-symbols-outlined text-[#16a34a] text-[18px]">check_circle</span>
          <p className="text-[#16a34a] text-sm">{t('invitedSuccess', { driverNumber: justInvited })}</p>
        </div>
      )}

      {drivers.length === 0 ? (
        <div className="bg-white/5 border border-white/8 rounded-xl px-5 py-16 text-center shadow-card-dark">
          <span className="material-symbols-outlined text-slate-600 text-4xl">person</span>
          <p className="text-slate-500 text-sm mt-3">{t('noDriversYet')}</p>
          {canManage && <InviteDriverButton vehicles={vehicles} variant="empty" />}
        </div>
      ) : (
        <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-card-dark">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('driverNumber')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('name')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('status')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('phone')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('cdlExpiry')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('medCertExpiry')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
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
                  <tr key={driver.id} className="hover:bg-white/[0.07] transition-colors duration-150">
                    <td className="px-5 py-3.5 text-white font-medium">
                      <Link
                        href={`/drivers/${driver.driver_number}`}
                        className="hover:text-[#f97316] transition-colors rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
                      >
                        {driver.driver_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 text-slate-300">{name}</td>
                    <td className="px-4 py-3.5">
                      <StatusBadge variant={inviteStatusVariant(inviteStatus)} size="sm">
                        {t(`inviteStatus_${inviteStatus}`)}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3.5 text-slate-400">{driver.profiles?.phone ?? '—'}</td>
                    <td className="px-4 py-3.5">
                      <div className="inline-flex flex-col gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 min-w-[148px]">
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
                    </td>
                    <td className="px-4 py-3.5 text-slate-400">
                      {driver.med_cert_expiry
                        ? new Date(driver.med_cert_expiry).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
                        : '—'}
                    </td>
                    <td className="px-4 py-3.5">{topException && <ExceptionChip item={topException} />}</td>
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
