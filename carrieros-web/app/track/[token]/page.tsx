// app/track/[token]/page.tsx
// Public load-tracking page — no auth, shareable by SMS/email.
// Uses the SECURITY DEFINER RPC get_public_tracking() so only an allowlisted
// set of columns is ever exposed to the anon role. Do NOT query `loads`
// directly here — see RPC contract note in the task brief.
//
// The status timeline below uses the companion RPC
// get_public_tracking_events(), which returns ONLY event_type + created_at
// (never load_events.note, which can contain internal driver/dispatcher
// commentary, and never created_by). Do NOT query `load_events` directly
// here, and do NOT widen that RPC's return columns without re-reading the
// security note next to its definition in supabase/schema/schema.sql.
//
// Deliberately does not import STATUS_BADGE from the authenticated
// loads pages — this page must keep working even if that module changes.
// Text still comes from the tracking.*/loads.status_* message catalogs.
import { createClient } from '@/lib/supabase/server'
import { getTranslations, getLocale } from 'next-intl/server'
import { toDate } from '@/lib/format-datetime'

const STATUS_COLOR: Record<string, string> = {
  draft:       'bg-slate-500/20 text-slate-400',
  scheduled:   'bg-blue-500/20 text-blue-400',
  dispatched:  'bg-[#f97316]/20 text-[#f97316]',
  picked_up:   'bg-amber-500/20 text-amber-400',
  in_transit:  'bg-[#1abc9c]/20 text-[#1abc9c]',
  delivered:   'bg-[#16a34a]/20 text-[#16a34a]',
  invoiced:    'bg-purple-500/20 text-purple-400',
  paid:        'bg-[#16a34a]/20 text-[#16a34a]',
  cancelled:   'bg-rose-500/10 text-rose-400',
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return '—'
  return toDate(value).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(value: string, locale: string): string {
  return toDate(value).toLocaleString(locale, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

// event_type values are written as `status_${status}` (see
// app/api/loads/[id]/route.ts) — reuse the same loads.status_* catalog the
// header badge uses rather than adding a parallel set of timeline strings.
function eventLabel(eventType: string, tLoads: TimeAgoT): string {
  const status = eventType.replace(/^status_/, '')
  try {
    return tLoads(`status_${status}`)
  } catch {
    return eventType.replace(/_/g, ' ')
  }
}

type TimeAgoT = Awaited<ReturnType<typeof getTranslations>>

function timeAgo(value: string, t: TimeAgoT): string {
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000)
  if (seconds < 60) return t('justNow')

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    const unit = minutes === 1 ? t('minuteSingular') : t('minutePlural')
    return t('lastUpdated', { time: `${minutes} ${unit}` })
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const unit = hours === 1 ? t('hourSingular') : t('hourPlural')
    return t('lastUpdated', { time: `${hours} ${unit}` })
  }
  const days = Math.floor(hours / 24)
  const unit = days === 1 ? t('daySingular') : t('dayPlural')
  return t('lastUpdated', { time: `${days} ${unit}` })
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

  const t = await getTranslations('tracking')
  const tLoads = await getTranslations('loads')
  const locale = await getLocale()

  if (!load) {
    return (
      <div className="min-h-screen bg-[#0f1923] flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="mb-8 flex justify-center">
            <Logo />
          </div>
          <div className="bg-white/5 border border-white/8 rounded-xl px-6 py-12 shadow-card-dark">
            <span className="material-symbols-outlined text-slate-600 text-4xl">search_off</span>
            <h1 className="text-white text-lg font-semibold mt-4">{t('notFoundTitle')}</h1>
            <p className="text-slate-400 text-sm mt-2">
              {t('notFoundBody')}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const badgeColor = STATUS_COLOR[load.status] ?? STATUS_COLOR.draft
  const badgeLabel = tLoads(`status_${load.status}`)
  const origin = [load.pickup_city, load.pickup_state].filter(Boolean).join(', ') || '—'
  const destination = [load.delivery_city, load.delivery_state].filter(Boolean).join(', ') || '—'
  const hasCarrierInfo = load.carrier_name || load.carrier_phone || load.carrier_email

  const { data: events } = await supabase.rpc('get_public_tracking_events', { p_token: token })
  const timeline = events ?? []

  return (
    <div className="min-h-screen bg-[#0f1923] px-4 py-10 sm:py-16">
      <div className="w-full max-w-md mx-auto">

        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="bg-white/5 border border-white/8 rounded-xl overflow-hidden shadow-card-dark">
          <div className="px-5 sm:px-6 py-5 border-b border-white/5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-slate-500 text-xs uppercase tracking-wide">{t('loadLabel')}</p>
                <p className="text-white text-lg font-semibold">{load.load_number}</p>
              </div>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${badgeColor}`}>
                {badgeLabel}
              </span>
            </div>
          </div>

          {load.delivery_date && (
            <div className="px-5 sm:px-6 py-5 border-b border-white/5 text-center bg-gradient-to-b from-white/[0.03] to-transparent">
              <p className="text-slate-500 text-xs uppercase tracking-wide mb-2">{t('estimatedDelivery')}</p>
              <p className="text-white text-2xl font-extrabold tracking-tight">
                {formatDate(load.delivery_date, locale)}
              </p>
            </div>
          )}

          <div className="px-5 sm:px-6 py-5 border-b border-white/5">
            <p className="text-slate-500 text-xs uppercase tracking-wide mb-3">{tLoads('route')}</p>
            <div className="flex items-start gap-3">
              <div className="flex flex-col items-center pt-1">
                <div className="w-2 h-2 rounded-full bg-[#f97316]" />
                <div className="w-px h-8 bg-white/10" />
                <div className="w-2 h-2 rounded-full bg-[#1abc9c]" />
              </div>
              <div className="flex-1 space-y-6">
                <div>
                  <p className="text-white text-sm font-medium">{origin}</p>
                  <p className="text-slate-500 text-xs mt-0.5">{tLoads('pickup')} {formatDate(load.pickup_date, locale)}</p>
                </div>
                <div>
                  <p className="text-white text-sm font-medium">{destination}</p>
                  <p className="text-slate-500 text-xs mt-0.5">{tLoads('delivery')} {formatDate(load.delivery_date, locale)}</p>
                </div>
              </div>
            </div>

            {load.last_location_at && (
              <p className="text-slate-500 text-xs mt-4 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]">schedule</span>
                {timeAgo(load.last_location_at, t)}
              </p>
            )}
          </div>

          {timeline.length > 0 && (
            <div className="px-5 sm:px-6 py-5 border-b border-white/5">
              <p className="text-slate-500 text-xs uppercase tracking-wide mb-3">{t('timeline')}</p>
              <div className="space-y-4">
                {timeline.map((event, i) => (
                  <div key={`${event.event_type}-${event.created_at}`} className="flex items-start gap-3">
                    <div className="flex flex-col items-center pt-1">
                      <div className={`w-2 h-2 rounded-full ${i === timeline.length - 1 ? 'bg-[#1abc9c]' : 'bg-white/20'}`} />
                      {i < timeline.length - 1 && <div className="w-px h-6 bg-white/10 mt-1" />}
                    </div>
                    <div className="flex-1 pb-0.5">
                      <p className="text-white text-sm font-medium">{eventLabel(event.event_type, tLoads)}</p>
                      <p className="text-slate-500 text-xs mt-0.5">{formatDateTime(event.created_at, locale)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasCarrierInfo && (
            <div className="px-5 sm:px-6 py-5">
              <p className="text-slate-500 text-xs uppercase tracking-wide mb-3">{t('carrierContact')}</p>
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
          {t('poweredBy')}
        </p>
      </div>
    </div>
  )
}
