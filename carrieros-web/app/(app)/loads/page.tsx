// app/(app)/loads/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  draft:       { label: 'Draft',      color: 'bg-slate-500/20 text-slate-400' },
  scheduled:   { label: 'Scheduled',  color: 'bg-blue-500/20 text-blue-400' },
  dispatched:  { label: 'Dispatched', color: 'bg-[#f97316]/20 text-[#f97316]' },
  picked_up:   { label: 'Picked Up',  color: 'bg-amber-500/20 text-amber-400' },
  in_transit:  { label: 'In Transit', color: 'bg-[#1abc9c]/20 text-[#1abc9c]' },
  delivered:   { label: 'Delivered',  color: 'bg-[#16a34a]/20 text-[#16a34a]' },
  invoiced:    { label: 'Invoiced',   color: 'bg-purple-500/20 text-purple-400' },
  paid:        { label: 'Paid',       color: 'bg-[#16a34a]/20 text-[#16a34a]' },
}

export default async function LoadsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>
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
  const justCreated = params.created

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

  const { data: loads } = await query
  const showRate = ['owner', 'solo', 'finance'].includes(profile?.role ?? '')

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Loads</h1>
          <p className="text-slate-400 text-sm mt-1">{loads?.length ?? 0} loads</p>
        </div>
        <Link
          href="/loads/new"
          className="flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-sm font-semibold rounded-lg transition"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Add Load
        </Link>
      </div>

      {justCreated && (
        <div className="mb-6 flex items-center gap-3 rounded-lg bg-[#16a34a]/10 border border-[#16a34a]/20 px-4 py-3">
          <span className="material-symbols-outlined text-[#16a34a] text-[18px]">check_circle</span>
          <p className="text-[#16a34a] text-sm">Load <span className="font-semibold">{justCreated}</span> created successfully.</p>
        </div>
      )}

      {!loads || loads.length === 0 ? (
        <div className="bg-white/5 border border-white/8 rounded-xl px-5 py-16 text-center">
          <span className="material-symbols-outlined text-slate-600 text-4xl">local_shipping</span>
          <p className="text-slate-500 text-sm mt-3">No loads yet.</p>
          <Link
            href="/loads/new"
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-sm font-medium rounded-lg transition"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            Create first load
          </Link>
        </div>
      ) : (
        <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Load #</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Route</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Pickup</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Customer</th>
                {showRate && (
                  <th className="text-right px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Rate</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loads.map((load) => {
                const badge = STATUS_BADGE[load.status] ?? STATUS_BADGE.draft
                const route =
                  [load.pickup_city, load.pickup_state].filter(Boolean).join(', ') +
                  ' → ' +
                  [load.delivery_city, load.delivery_state].filter(Boolean).join(', ')

                return (
                  <tr key={load.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-5 py-3.5">
                      <Link href={`/loads/${load.load_number}`} className="text-white font-medium hover:text-[#f97316] transition-colors">
                        {load.load_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.color}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-300 max-w-[220px] truncate">{route}</td>
                    <td className="px-4 py-3.5 text-slate-400">
                      {load.pickup_date
                        ? new Date(load.pickup_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        : '—'}
                    </td>
                    <td className="px-4 py-3.5 text-slate-400 max-w-[160px] truncate">
                      {load.customer_name_raw ?? '—'}
                    </td>
                    {showRate && (
                      <td className="px-5 py-3.5 text-right text-white font-medium">
                        {load.rate != null ? `$${Number(load.rate).toLocaleString()}` : '—'}
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
