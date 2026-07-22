// app/(app)/dashboard/MyLoadCard.tsx
// Shared "my active load" presentational card, used by DriverView (full
// size) and SoloView (compact, prepended above the owner content). Plain
// props in, no data-fetching here — each caller resolves its own load row
// via the drivers.profile_id -> loads.driver_id chain (same pattern as
// app/(app)/loads/page.tsx's driver-scoping query).
import Link from 'next/link'
import { STATUS_COLOR } from '@/lib/domain/load-status'

export interface MyLoad {
  load_number: string
  status: string | null
  pickup_city: string | null
  pickup_state: string | null
  delivery_city: string | null
  delivery_state: string | null
  customer_name_raw: string | null
}

export default function MyLoadCard({
  load,
  title,
  noActiveLoadLabel,
  statusLabel,
  compact = false,
}: {
  load: MyLoad | null
  title: string
  noActiveLoadLabel: string
  statusLabel: (status: string) => string
  compact?: boolean
}) {
  if (!load) {
    return (
      <div className="bg-white/5 border border-white/8 rounded-xl shadow-card-dark px-5 py-8 text-center mb-8">
        <span className="material-symbols-outlined text-slate-600 text-4xl">local_shipping</span>
        <p className="text-slate-500 text-sm mt-3">{noActiveLoadLabel}</p>
      </div>
    )
  }

  const route =
    [load.pickup_city, load.pickup_state].filter(Boolean).join(', ') +
    ' → ' +
    [load.delivery_city, load.delivery_state].filter(Boolean).join(', ')
  const badgeColor = (load.status ? STATUS_COLOR[load.status] : null) ?? STATUS_COLOR.draft

  return (
    <Link
      href={`/loads/${load.load_number}`}
      className={`block bg-white/5 border border-white/8 rounded-xl shadow-card-dark hover:bg-white/[0.07] hover:shadow-hover-dark transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-brand-orange/50 mb-8 ${compact ? 'p-4' : 'p-6'}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-slate-400 text-xs font-medium uppercase tracking-wide">{title}</span>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badgeColor}`}>
          {statusLabel(load.status ?? 'draft')}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className={`text-white font-bold tracking-tight ${compact ? 'text-lg' : 'text-2xl'}`}>{load.load_number}</p>
          <p className="text-slate-300 text-sm truncate">{route}</p>
        </div>
        {load.customer_name_raw && (
          <span className="text-slate-400 text-sm max-w-[160px] truncate hidden sm:inline">{load.customer_name_raw}</span>
        )}
      </div>
    </Link>
  )
}
