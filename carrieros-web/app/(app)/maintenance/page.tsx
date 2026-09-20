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
import { getMaintenanceIcon } from '@/components/icons/maintenance'
import { Card, CardHeader, StatusBadge, type StatusBadgeVariant, Table, TableHeaderCell, TableRow, TableCell, ProgressBar, EmptyState } from '@/components/ui'
import { getProfileForUser } from '@/lib/queries/profiles'
import { logError } from '@/lib/observability'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

// Viewing the schedule is wider than logging service (`service_log`) and
// matches no capability's role set, so it stays an explicit list.
const VIEW_ROLES   = ['owner', 'solo', 'dispatcher']

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

const STATUS_VARIANT: Record<Status, StatusBadgeVariant> = {
  overdue: 'danger',
  dueSoon: 'warning',
  ok:      'success',
  noDate:  'neutral',
}

// date-only equivalent of LogServiceButton's addMonths, run in reverse — used
// to back into a baseline date when a reminder has next_due_date +
// trigger_months but no last_service_date (e.g. a reminder created directly
// with a due date, never yet serviced).
function subtractMonths(dateStr: string, months: number): string {
  const d = toDate(dateStr)
  d.setMonth(d.getMonth() - months)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type Progress = { pct: number; status: Exclude<Status, 'noDate'> } | null

// Progress toward a reminder's due date, as a 0–1 fraction of the interval
// between when the clock started (last_service_date, or — if that's
// missing — next_due_date minus trigger_months as an approximation) and
// next_due_date itself.
//
// next_due_miles exists on this table too, but there is no live
// current-odometer feed anywhere in the schema to compare it against (see
// the schema.sql note above maintenance_reminders' upcoming-reminders view;
// vehicles has no odometer column and service_logs/dvir odometer readings
// are only point-in-time snapshots from past services). So mileage-based
// reminders fall back to the plain status chip instead of a fabricated bar.
function computeProgress(r: Reminder): Progress {
  if (!r.next_due_date) return null
  // computeStatus can only return 'noDate' when next_due_date is null,
  // already excluded above — safe to narrow.
  const status = computeStatus(r.next_due_date) as Exclude<Status, 'noDate'>

  const baseline = r.last_service_date
    ?? (r.trigger_months ? subtractMonths(r.next_due_date, r.trigger_months) : null)
  if (!baseline) return null

  const start = toDate(baseline).getTime()
  const end = toDate(r.next_due_date).getTime()
  const now = new Date()
  now.setHours(0, 0, 0, 0)

  if (end <= start) return { pct: 1, status }
  const pct = (now.getTime() - start) / (end - start)
  return { pct: Math.min(1, Math.max(0, pct)), status }
}

const PROGRESS_BAR_VARIANT: Record<Exclude<Status, 'noDate'>, 'success' | 'warning' | 'danger'> = {
  overdue: 'danger',
  dueSoon: 'warning',
  ok:      'success',
}

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ logged?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)

  if (!profile?.org_id) redirect('/onboarding')
  if (!VIEW_ROLES.includes(profile.role)) redirect('/dashboard')

  const canManage = roleHasCapability(profile.role, 'service_log')
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

  if (remindersError) logError({ route: 'maintenance' }, remindersError.message, { step: 'reminders query failed' })

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
          <h1 className="text-2xl font-semibold text-text-pri">{t('title')}</h1>
          <p className="text-text-sec text-sm mt-1">
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
        <div className="mb-6 flex items-center gap-3 rounded-lg bg-success/10 border border-success/20 px-4 py-3">
          <span className="material-symbols-outlined text-success text-[18px]">check_circle</span>
          <p className="text-success text-sm">{t('loggedSuccess', { truck: params.logged })}</p>
        </div>
      )}

      {vehicles.length === 0 ? (
        <Card>
          <EmptyState icon="build" title={t('noTrucksYet')} />
        </Card>
      ) : (
        <div className="space-y-4 mb-8">
          {vehicles.map((vehicle) => {
            const vehicleReminders = remindersByVehicle.get(vehicle.id) ?? []
            return (
              <Card key={vehicle.id}>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-text-sec text-[18px]">fire_truck</span>
                    <span className="text-text-pri font-medium">{vehicle.vehicle_number}</span>
                    {vehicle.nickname && <span className="text-text-sec text-sm">— {vehicle.nickname}</span>}
                  </div>
                </CardHeader>
                {vehicleReminders.length === 0 ? (
                  <div className="px-5 py-4 text-text-sec text-sm">{t('noRemindersForTruck')}</div>
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <TableHeaderCell>{t('reminderType')}</TableHeaderCell>
                        <TableHeaderCell>{t('lastService')}</TableHeaderCell>
                        <TableHeaderCell>{t('nextDue')}</TableHeaderCell>
                        <TableHeaderCell numeric>{t('status')}</TableHeaderCell>
                      </tr>
                    </thead>
                    <tbody>
                      {vehicleReminders.map((r) => {
                        const status = computeStatus(r.next_due_date)
                        const progress = computeProgress(r)
                        const nextDue = [
                          r.next_due_date ? formatDate(r.next_due_date, profile) : null,
                          r.next_due_miles ? t('milesValue', { miles: r.next_due_miles.toLocaleString() }) : null,
                        ].filter(Boolean).join(' · ') || '—'
                        const Icon = getMaintenanceIcon(r.reminder_type)
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium text-text-pri">
                              <div className="flex items-center gap-2.5">
                                <Icon className="w-4 h-4 shrink-0 text-text-sec" />
                                {r.reminder_type}
                              </div>
                            </TableCell>
                            <TableCell>
                              {r.last_service_date ? formatDate(r.last_service_date, profile) : t('never')}
                            </TableCell>
                            <TableCell>
                              <div>{nextDue}</div>
                              {progress && (
                                <div className="mt-1.5 w-24">
                                  <ProgressBar value={Math.round(progress.pct * 100)} variant={PROGRESS_BAR_VARIANT[progress.status]} thin label={t('dueProgress')} />
                                </div>
                              )}
                            </TableCell>
                            <TableCell numeric>
                              <StatusBadge variant={STATUS_VARIANT[status]} size="sm">
                                {t(`status_${status}`)}
                              </StatusBadge>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </tbody>
                  </Table>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <h2 className="text-text-pri font-semibold text-lg mb-3">{t('recentServiceLogs')}</h2>
      {logs.length === 0 ? (
        <Card>
          <EmptyState title={t('noServiceLogsYet')} />
        </Card>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <TableHeaderCell>{t('date')}</TableHeaderCell>
                <TableHeaderCell>{t('truck')}</TableHeaderCell>
                <TableHeaderCell>{t('serviceType')}</TableHeaderCell>
                <TableHeaderCell>{t('shop')}</TableHeaderCell>
                <TableHeaderCell>{t('odometer')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('cost')}</TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>{formatDate(log.service_date, profile)}</TableCell>
                  <TableCell className="font-medium text-text-pri">
                    {log.vehicles?.vehicle_number ?? '—'}{log.vehicles?.nickname ? ` — ${log.vehicles.nickname}` : ''}
                  </TableCell>
                  <TableCell>{log.service_type}</TableCell>
                  <TableCell>{log.shop_name ?? '—'}</TableCell>
                  <TableCell>{log.odometer ? log.odometer.toLocaleString() : '—'}</TableCell>
                  <TableCell numeric className="font-medium text-text-pri">
                    {log.cost != null ? `$${Number(log.cost).toFixed(2)}` : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  )
}
