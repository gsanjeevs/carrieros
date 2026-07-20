// app/track/[token]/page.tsx
// Public load-tracking page — no auth, shareable by SMS/email.
// Uses the SECURITY DEFINER RPC get_public_tracking() so only an allowlisted
// set of columns is ever exposed to the anon role. Do NOT query `loads`
// directly here — see RPC contract note in the task brief.
import { createClient } from '@/lib/supabase/server'

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

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function timeAgo(value: string): string {
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function Logo() {
  return (
    <div className="inline-flex items-center gap-2">
      <div className="w-8 h-8 rounded-lg bg-[#f97316] flex items-center justify-center">
        <span className="text-white font-bold text-sm">C</span>
      </div>
      <span className="text-white font-semibold text-xl tracking-tight">CarrierOS</span>
    </div>
  )
}

export default async function TrackingPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_public_tracking', { p_token: token })

  const load = !error && data && data.length > 0 ? data[0] : null

  if (!load) {
    return (
      <div className="min-h-screen bg-[#0f1923] flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="mb-8 flex justify-center">
            <Logo />
          </div>
          <div className="bg-white/5 border border-white/8 rounded-xl px-6 py-12">
            <span className="material-symbols-outlined text-slate-600 text-4xl">search_off</span>
            <h1 className="text-white text-lg font-semibold mt-4">Tracking link not found</h1>
            <p className="text-slate-400 text-sm mt-2">
              This link may be invalid or expired. Please check the link or contact the carrier for an update.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const badge = STATUS_BADGE[load.status] ?? STATUS_BADGE.draft
  const origin = [load.pickup_city, load.pickup_state].filter(Boolean).join(', ') || '—'
  const destination = [load.delivery_city, load.delivery_state].filter(Boolean).join(', ') || '—'
  const hasCarrierInfo = load.carrier_name || load.carrier_phone || load.carrier_email

  return (
    <div className="min-h-screen bg-[#0f1923] px-4 py-10 sm:py-16">
      <div className="w-full max-w-md mx-auto">

        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden">
          <div className="px-5 sm:px-6 py-5 border-b border-white/5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-slate-500 text-xs uppercase tracking-wide">Load</p>
                <p className="text-white text-lg font-semibold">{load.load_number}</p>
              </div>
              <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap ${badge.color}`}>
                {badge.label}
              </span>
            </div>
          </div>

          <div className="px-5 sm:px-6 py-5 border-b border-white/5">
            <p className="text-slate-500 text-xs uppercase tracking-wide mb-3">Route</p>
            <div className="flex items-start gap-3">
              <div className="flex flex-col items-center pt-1">
                <div className="w-2 h-2 rounded-full bg-[#f97316]" />
                <div className="w-px h-8 bg-white/10" />
                <div className="w-2 h-2 rounded-full bg-[#1abc9c]" />
              </div>
              <div className="flex-1 space-y-6">
                <div>
                  <p className="text-white text-sm font-medium">{origin}</p>
                  <p className="text-slate-500 text-xs mt-0.5">Pickup {formatDate(load.pickup_date)}</p>
                </div>
                <div>
                  <p className="text-white text-sm font-medium">{destination}</p>
                  <p className="text-slate-500 text-xs mt-0.5">Delivery {formatDate(load.delivery_date)}</p>
                </div>
              </div>
            </div>

            {load.last_location_at && (
              <p className="text-slate-500 text-xs mt-4 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]">schedule</span>
                Last updated: {timeAgo(load.last_location_at)}
              </p>
            )}
          </div>

          {hasCarrierInfo && (
            <div className="px-5 sm:px-6 py-5">
              <p className="text-slate-500 text-xs uppercase tracking-wide mb-3">Carrier</p>
              <div className="space-y-2">
                {load.carrier_name && (
                  <p className="text-white text-sm font-medium">{load.carrier_name}</p>
                )}
                {load.carrier_phone && (
                  <a
                    href={`tel:${load.carrier_phone}`}
                    className="flex items-center gap-2 text-slate-300 text-sm hover:text-[#f97316] transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">call</span>
                    {load.carrier_phone}
                  </a>
                )}
                {load.carrier_email && (
                  <a
                    href={`mailto:${load.carrier_email}`}
                    className="flex items-center gap-2 text-slate-300 text-sm hover:text-[#f97316] transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">mail</span>
                    {load.carrier_email}
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          Powered by CarrierOS
        </p>
      </div>
    </div>
  )
}
