// app/(app)/loads/[load_number]/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import DispatchPanel from '@/components/DispatchPanel'

const STATUS_FLOW = [
  { key: 'draft',      label: 'Draft',      icon: 'draft' },
  { key: 'scheduled',  label: 'Scheduled',  icon: 'event' },
  { key: 'dispatched', label: 'Dispatched', icon: 'send' },
  { key: 'picked_up',  label: 'Picked Up',  icon: 'inventory_2' },
  { key: 'in_transit', label: 'In Transit', icon: 'local_shipping' },
  { key: 'delivered',  label: 'Delivered',  icon: 'where_to_vote' },
  { key: 'invoiced',   label: 'Invoiced',   icon: 'receipt' },
  { key: 'paid',       label: 'Paid',       icon: 'paid' },
]

const STATUS_COLOR: Record<string, string> = {
  draft:      'bg-slate-500/20 text-slate-400',
  scheduled:  'bg-blue-500/20 text-blue-400',
  dispatched: 'bg-[#f97316]/20 text-[#f97316]',
  picked_up:  'bg-amber-500/20 text-amber-400',
  in_transit: 'bg-[#1abc9c]/20 text-[#1abc9c]',
  delivered:  'bg-green-500/20 text-green-400',
  invoiced:   'bg-purple-500/20 text-purple-400',
  paid:       'bg-green-500/20 text-green-400',
}

function fmt(date: string | null) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex justify-between items-start py-2.5 border-b border-white/5 last:border-0">
      <span className="text-slate-500 text-sm">{label}</span>
      <span className="text-white text-sm text-right ml-4">{value ?? '—'}</span>
    </div>
  )
}

export default async function LoadDetailPage({
  params,
}: {
  params: Promise<{ load_number: string }>
}) {
  const { load_number } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) redirect('/onboarding')

  // Fetch load
  const { data: load } = await supabase
    .from('loads')
    .select(`
      *,
      drivers ( id, driver_number, profile_id, profiles ( first_name, last_name ) ),
      trucks  ( id, truck_number, nickname, make, model, year )
    `)
    .eq('load_number', load_number)
    .eq('carrier_org_id', profile.org_id)
    .single()

  if (!load) notFound()

  // Fetch customer name if linked
  let customerName: string | null = null
  if (load.customer_org_id) {
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', load.customer_org_id)
      .single()
    customerName = org?.name ?? null
  }

  // Fetch load events
  const { data: events } = await supabase
    .from('load_events')
    .select('id, event_type, note, created_at, profiles(first_name, last_name)')
    .eq('load_id', load.id)
    .order('created_at', { ascending: true })

  const showRate    = ['owner', 'solo', 'finance'].includes(profile.role)
  const canDispatch = ['owner', 'solo', 'dispatcher'].includes(profile.role)

  const currentIdx  = STATUS_FLOW.findIndex(s => s.key === load.status)
  const driverName  = load.drivers?.profiles
    ? [load.drivers.profiles.first_name, load.drivers.profiles.last_name].filter(Boolean).join(' ')
    : null
  const truckLabel  = load.trucks
    ? `${load.trucks.truck_number ?? ''} ${load.trucks.nickname}`.trim()
    : null

  return (
    <div className="p-8 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/loads" className="text-slate-500 hover:text-white transition">
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            </Link>
            <h1 className="text-2xl font-semibold text-white">{load.load_number}</h1>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold ${STATUS_COLOR[load.status] ?? STATUS_COLOR.draft}`}>
              {STATUS_FLOW.find(s => s.key === load.status)?.label ?? load.status}
            </span>
          </div>
          <p className="text-slate-400 text-sm ml-9">
            {[load.pickup_city, load.pickup_state].filter(Boolean).join(', ')}
            {' → '}
            {[load.delivery_city, load.delivery_state].filter(Boolean).join(', ')}
          </p>
        </div>
      </div>

      {/* Status timeline */}
      <div className="bg-white/5 border border-white/8 rounded-xl p-5 mb-6">
        <div className="flex items-center gap-0 overflow-x-auto">
          {STATUS_FLOW.map((s, i) => {
            const done    = i < currentIdx
            const current = i === currentIdx
            const future  = i > currentIdx
            return (
              <div key={s.key} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center transition ${
                    current ? 'bg-[#f97316] ring-2 ring-[#f97316]/30' :
                    done    ? 'bg-[#f97316]/20' : 'bg-white/5'
                  }`}>
                    <span className={`material-symbols-outlined text-[16px] ${
                      current ? 'text-white' : done ? 'text-[#f97316]' : 'text-slate-600'
                    }`}>{s.icon}</span>
                  </div>
                  <span className={`text-[10px] font-medium whitespace-nowrap ${
                    current ? 'text-[#f97316]' : done ? 'text-slate-400' : 'text-slate-600'
                  }`}>{s.label}</span>
                </div>
                {i < STATUS_FLOW.length - 1 && (
                  <div className={`flex-1 h-px mx-1 ${done ? 'bg-[#f97316]/40' : 'bg-white/8'}`} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left: Load details */}
        <div className="lg:col-span-2 space-y-6">

          {/* Route */}
          <div className="bg-white/5 border border-white/8 rounded-xl p-5">
            <h2 className="text-white font-medium text-sm mb-4">Route</h2>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[#f97316] font-semibold mb-2">Pickup</p>
                <p className="text-white text-sm font-medium">{load.pickup_address ?? '—'}</p>
                <p className="text-slate-400 text-sm">{[load.pickup_city, load.pickup_state, load.pickup_zip].filter(Boolean).join(', ')}</p>
                <p className="text-slate-500 text-xs mt-2">{fmt(load.pickup_date)}{load.pickup_time ? ` · ${load.pickup_time}` : ''}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[#1abc9c] font-semibold mb-2">Delivery</p>
                <p className="text-white text-sm font-medium">{load.delivery_address ?? '—'}</p>
                <p className="text-slate-400 text-sm">{[load.delivery_city, load.delivery_state, load.delivery_zip].filter(Boolean).join(', ')}</p>
                <p className="text-slate-500 text-xs mt-2">{fmt(load.delivery_date)}{load.delivery_time ? ` · ${load.delivery_time}` : ''}</p>
              </div>
            </div>
          </div>

          {/* Load info */}
          <div className="bg-white/5 border border-white/8 rounded-xl p-5">
            <h2 className="text-white font-medium text-sm mb-3">Load Details</h2>
            <InfoRow label="Customer"   value={customerName ?? load.customer_name_raw} />
            <InfoRow label="Commodity"  value={load.commodity} />
            <InfoRow label="Weight"     value={load.weight_lbs ? `${Number(load.weight_lbs).toLocaleString()} lbs` : null} />
            <InfoRow label="Miles"      value={load.total_miles ? `${load.total_miles} mi` : null} />
            {showRate && <InfoRow label="Rate" value={load.rate != null ? `$${Number(load.rate).toLocaleString()}` : null} />}
            <InfoRow label="Intake"     value={load.intake_method} />
          </div>

          {/* Timeline */}
          <div className="bg-white/5 border border-white/8 rounded-xl p-5">
            <h2 className="text-white font-medium text-sm mb-4">Activity</h2>
            {!events || events.length === 0 ? (
              <p className="text-slate-500 text-sm">No activity yet.</p>
            ) : (
              <div className="space-y-3">
                {events.map((e) => {
                  const actor = e.profiles
                    ? [e.profiles.first_name, e.profiles.last_name].filter(Boolean).join(' ')
                    : 'System'
                  return (
                    <div key={e.id} className="flex gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#f97316] mt-2 shrink-0" />
                      <div>
                        <p className="text-white text-sm">{e.event_type.replace(/_/g, ' ')}</p>
                        {e.note && <p className="text-slate-400 text-xs mt-0.5">{e.note}</p>}
                        <p className="text-slate-600 text-xs mt-0.5">
                          {actor} · {new Date(e.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: Dispatch panel */}
        <div className="space-y-6">
          <div className="bg-white/5 border border-white/8 rounded-xl p-5">
            <h2 className="text-white font-medium text-sm mb-4">Assignment</h2>
            <div className="space-y-3 mb-4">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-slate-500 text-[20px]">person</span>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">Driver</p>
                  <p className="text-white text-sm">{driverName ?? 'Unassigned'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-slate-500 text-[20px]">local_shipping</span>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">Truck</p>
                  <p className="text-white text-sm">{truckLabel ?? 'Unassigned'}</p>
                </div>
              </div>
            </div>

            {canDispatch && (
              <DispatchPanel
                loadId={load.id}
                loadNumber={load.load_number}
                currentStatus={load.status}
                currentDriverId={load.driver_id}
                currentTruckId={load.truck_id}
                orgId={profile.org_id}
              />
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
