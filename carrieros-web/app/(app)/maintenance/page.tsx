// app/(app)/maintenance/page.tsx
// Fleet maintenance — upcoming reminders per vehicle + a "log a completed
// service" flow.
//
// RLS note (checked before building this — see report): Sidebar.tsx lists
// /maintenance for owner/solo/dispatcher, and both service_logs and
// maintenance_reminders DO grant dispatcher a SELECT policy
// (carrier_service_logs_select / carrier_reminders_select have no role
// filter), so dispatcher can see this whole page. But the write policies
// (owner_solo_service_logs_all / owner_solo_reminders_all) are owner/solo
// only — dispatcher cannot log a service or create/update a reminder. That
// mirrors the existing truck_documents pattern (also owner/solo-only writes
// on a trucks-scoped table) rather than looking like an oversight, and
// owner/solo — the primary users — are fully functional, so per the task
// instructions this is reported, not silently patched: dispatcher gets a
// read-only view here (no "Log Service" button).
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { formatDate, toDate } from '@/lib/format-datetime'
import LogServiceButton from './LogServiceButton'

const VIEW_ROLES   = ['owner', 'solo', 'dispatcher']
const MANAGE_ROLES = ['owner', 'solo']

type Vehicle = {
  id: number
  vehicle_number: string | null
  nickname: string | null
}

type Reminder = {
  id: number
  vehicle_id: number
  reminder_type: string
  trigger_miles: number | null
  trigger_months: number | null
  last_service_date: string | null
  last_odometer: number | null
  next_due_date: string | null
  next_due_miles: number | null
  is_active: boolean | null
  vehicles: { id: number; vehicle_number: string | null; nickname: string | null } | null
}

type ServiceLog = {
  id: number
  vehicle_id: number | null
  service_type: string
  service_date: string
  odometer: number | null
  cost: number | null
  shop_name: string | null
  notes: string | null
  vehicles: { vehicle_number: string | null; nickname: string | null } | null
}

type Status = 'overdue' | 'dueSoon' | 'ok' | 'noDate'

function computeStatus(nextDueDate: string | null): Status {
  if (!nextDueDate) return 'noDate'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = toDate(nextDueDate)
  const daysUntil = Math.round((due.getTime() - today.getTime()) / 86_400_000)
  if (daysUntil < 0) return 'overdue'
  if (daysUntil <= 14) return 'dueSoon'
  return 'ok'
}

const STATUS_COLOR: Record<Status, string> = {
  overdue: 'bg-red-500/20 text-red-400',
  dueSoon: 'bg-amber-500/20 text-amber-400',
  ok:      'bg-[#16a34a]/20 text-[#16a34a]',
  noDate:  'bg-slate-500/20 text-slate-400',
}

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ logged?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role, date_format')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) redirect('/onboarding')
  if (!VIEW_ROLES.includes(profile.role)) redirect('/dashboard')

  const canManage = MANAGE_ROLES.includes(profile.role)
  const params = await searchParams
  const t = await getTranslations('maintenance')

  const [{ data: vehiclesData }, { data: remindersData, error: remindersError }, { data: logsData }] = await Promise.all([
    supabase
      .from('vehicles')
      .select('id, vehicle_number, nickname')
      .eq('carrier_org_id', profile.org_id)
      .eq('is_active', true)
      .order('vehicle_number'),
    supabase
      .from('maintenance_reminders')
      .select('id, vehicle_id, reminder_type, trigger_miles, trigger_months, last_service_date, last_odometer, next_due_date, next_due_miles, is_active, vehicles(id, vehicle_number, nickname)')
      .eq('carrier_org_id', profile.org_id)
      .eq('is_active', true)
      .order('next_due_date', { ascending: true, nullsFirst: false }),
    supabase
      .from('service_logs')
      .select('id, vehicle_id, service_type, service_date, odometer, cost, shop_name, notes, vehicles(vehicle_number, nickname)')
      .eq('carrier_org_id', profile.org_id)
      .order('service_date', { ascending: false })
      .limit(20),
  ])

  if (remindersError) console.error('[maintenance] reminders query failed:', remindersError.message)

  const vehicles = (vehiclesData ?? []) as Vehicle[]
  const reminders = (remindersData ?? []) as unknown as Reminder[]
  const logs = (logsData ?? []) as unknown as ServiceLog[]

  // Group reminders by vehicle so each vehicle gets its own card, in vehicle
  // order (including vehicles with zero reminders, so an owner notices the gap).
  const remindersByVehicle = new Map<number, Reminder[]>()
  for (const r of reminders) {
    const list = remindersByVehicle.get(r.vehicle_id) ?? []
    list.push(r)
    remindersByVehicle.set(r.vehicle_id, list)
  }

  const overdueCount = reminders.filter(r => computeStatus(r.next_due_date) === 'overdue').length
  const dueSoonCount = reminders.filter(r => computeStatus(r.next_due_date) === 'dueSoon').length

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t('title')}</h1>
          <p className="text-slate-400 text-sm mt-1">
            {overdueCount > 0
              ? t('summaryOverdue', { overdue: overdueCount, dueSoon: dueSoonCount })
              : dueSoonCount > 0
                ? t('summaryDueSoon', { dueSoon: dueSoonCount })
                : t('summaryOk')}
          </p>
        </div>
        {canManage && <LogServiceButton vehicles={vehicles} reminders={reminders} />}
      </div>

      {params.logged && (
        <div className="mb-6 flex items-center gap-3 rounded-lg bg-[#16a34a]/10 border border-[#16a34a]/20 px-4 py-3 shadow-card-dark">
          <span className="material-symbols-outlined text-[#16a34a] text-[18px]">check_circle</span>
          <p className="text-[#16a34a] text-sm">{t('loggedSuccess', { truck: params.logged })}</p>
        </div>
      )}

      {vehicles.length === 0 ? (
        <div className="bg-white/5 border border-white/8 rounded-xl px-5 py-16 text-center shadow-card-dark">
          <span className="material-symbols-outlined text-slate-600 text-4xl">build</span>
          <p className="text-slate-500 text-sm mt-3">{t('noTrucksYet')}</p>
        </div>
      ) : (
        <div className="space-y-4 mb-8">
          {vehicles.map((vehicle) => {
            const vehicleReminders = remindersByVehicle.get(vehicle.id) ?? []
            return (
              <div key={vehicle.id} className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-card-dark">
                <div className="px-5 py-3.5 border-b border-white/5 flex items-center gap-2">
                  <span className="material-symbols-outlined text-slate-500 text-[18px]">fire_truck</span>
                  <span className="text-white font-medium">{vehicle.vehicle_number}</span>
                  {vehicle.nickname && <span className="text-slate-500 text-sm">— {vehicle.nickname}</span>}
                </div>
                {vehicleReminders.length === 0 ? (
                  <div className="px-5 py-4 text-slate-500 text-sm">{t('noRemindersForTruck')}</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/5">
                        <th className="text-left px-5 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('reminderType')}</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('lastService')}</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('nextDue')}</th>
                        <th className="text-right px-5 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('status')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {vehicleReminders.map((r) => {
                        const status = computeStatus(r.next_due_date)
                        const nextDue = [
                          r.next_due_date ? formatDate(r.next_due_date, profile) : null,
                          r.next_due_miles ? t('milesValue', { miles: r.next_due_miles.toLocaleString() }) : null,
                        ].filter(Boolean).join(' · ') || '—'
                        return (
                          <tr key={r.id} className="hover:bg-white/[0.07] transition-colors duration-150">
                            <td className="px-5 py-3 text-white font-medium">{r.reminder_type}</td>
                            <td className="px-4 py-3 text-slate-400">
                              {r.last_service_date ? formatDate(r.last_service_date, profile) : t('never')}
                            </td>
                            <td className="px-4 py-3 text-slate-300">{nextDue}</td>
                            <td className="px-5 py-3 text-right">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[status]}`}>
                                {t(`status_${status}`)}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </div>
      )}

      <h2 className="text-white font-semibold text-lg mb-3">{t('recentServiceLogs')}</h2>
      {logs.length === 0 ? (
        <div className="bg-white/5 border border-white/8 rounded-xl px-5 py-10 text-center shadow-card-dark">
          <p className="text-slate-500 text-sm">{t('noServiceLogsYet')}</p>
        </div>
      ) : (
        <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-card-dark">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('date')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('truck')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('serviceType')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('shop')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('odometer')}</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{t('cost')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-white/[0.07] transition-colors duration-150">
                  <td className="px-5 py-3 text-slate-300">{formatDate(log.service_date, profile)}</td>
                  <td className="px-4 py-3 text-white font-medium">
                    {log.vehicles?.vehicle_number ?? '—'}{log.vehicles?.nickname ? ` — ${log.vehicles.nickname}` : ''}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{log.service_type}</td>
                  <td className="px-4 py-3 text-slate-400">{log.shop_name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{log.odometer ? log.odometer.toLocaleString() : '—'}</td>
                  <td className="px-5 py-3 text-right text-white font-medium">
                    {log.cost != null ? `$${Number(log.cost).toFixed(2)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
