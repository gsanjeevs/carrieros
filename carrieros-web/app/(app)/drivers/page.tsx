// app/(app)/drivers/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import InviteDriverButton from './InviteDriverButton'

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  pending:  { label: 'Pending',  color: 'bg-amber-500/20 text-amber-400' },
  accepted: { label: 'Active',   color: 'bg-[#16a34a]/20 text-[#16a34a]' },
  revoked:  { label: 'Revoked',  color: 'bg-slate-500/20 text-slate-400' },
}

type Driver = {
  id: number
  driver_number: string
  invite_status: string
  default_truck_id: number | null
  cdl_expiry: string | null
  med_cert_expiry: string | null
  is_active: boolean
  profiles: { first_name: string | null; last_name: string | null; phone: string | null } | null
}

type Truck = {
  id: number
  truck_number: string | null
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

  let drivers: Driver[] = []
  let trucks: Truck[] = []

  if (profile?.org_id) {
    const { data } = await supabase
      .from('drivers')
      .select('id, driver_number, invite_status, default_truck_id, cdl_expiry, med_cert_expiry, is_active, profiles(first_name, last_name, phone)')
      .eq('carrier_org_id', profile.org_id)
      .eq('is_active', true)
      .order('driver_number')
    drivers = (data ?? []) as unknown as Driver[]

    if (canManage) {
      const { data: truckData } = await supabase
        .from('trucks')
        .select('id, truck_number, nickname')
        .eq('carrier_org_id', profile.org_id)
        .eq('is_active', true)
        .order('truck_number')
      trucks = truckData ?? []
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Drivers</h1>
          <p className="text-slate-400 text-sm mt-1">{drivers.length} drivers</p>
        </div>
        {canManage && <InviteDriverButton trucks={trucks} />}
      </div>

      {justInvited && (
        <div className="mb-6 flex items-center gap-3 rounded-lg bg-[#16a34a]/10 border border-[#16a34a]/20 px-4 py-3">
          <span className="material-symbols-outlined text-[#16a34a] text-[18px]">check_circle</span>
          <p className="text-[#16a34a] text-sm">Driver <span className="font-semibold">{justInvited}</span> invited successfully.</p>
        </div>
      )}

      {drivers.length === 0 ? (
        <div className="bg-white/5 border border-white/8 rounded-xl px-5 py-16 text-center">
          <span className="material-symbols-outlined text-slate-600 text-4xl">person</span>
          <p className="text-slate-500 text-sm mt-3">No drivers yet.</p>
          {canManage && <InviteDriverButton trucks={trucks} variant="empty" />}
        </div>
      ) : (
        <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Driver #</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Phone</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">CDL Expiry</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Med Cert Expiry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {drivers.map((driver) => {
                const badge = STATUS_BADGE[driver.invite_status] ?? STATUS_BADGE.pending
                const name = [driver.profiles?.first_name, driver.profiles?.last_name].filter(Boolean).join(' ') || '—'

                return (
                  <tr key={driver.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-5 py-3.5 text-white font-medium">{driver.driver_number}</td>
                    <td className="px-4 py-3.5 text-slate-300">{name}</td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.color}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-400">{driver.profiles?.phone ?? '—'}</td>
                    <td className="px-4 py-3.5 text-slate-400">
                      {driver.cdl_expiry
                        ? new Date(driver.cdl_expiry).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : '—'}
                    </td>
                    <td className="px-4 py-3.5 text-slate-400">
                      {driver.med_cert_expiry
                        ? new Date(driver.med_cert_expiry).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : '—'}
                    </td>
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
