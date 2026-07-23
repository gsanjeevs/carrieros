// app/(app)/dashboard/MyLoadCard.tsx
// Shared "my active load" presentational card, used by DriverView (full
// size) and SoloView (compact, prepended above the owner content). Plain
// props in, no data-fetching here — each caller resolves its own load row
// via the drivers.profile_id -> loads.driver_id chain (same pattern as
// app/(app)/loads/page.tsx's driver-scoping query).
import Link from 'next/link'
import { loadStatusVariant, type LoadStatus } from '@/lib/domain/load-status'
import StatusBadge from '@/components/ui/StatusBadge'
import { Card } from '@/components/ui'

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
      <Card className="px-5 py-8 text-center mb-8">
        <span className="material-symbols-outlined text-text-mut text-4xl">local_shipping</span>
        <p className="text-text-mut text-sm mt-3">{noActiveLoadLabel}</p>
      </Card>
    )
  }

  const route =
    [load.pickup_city, load.pickup_state].filter(Boolean).join(', ') +
    ' → ' +
    [load.delivery_city, load.delivery_state].filter(Boolean).join(', ')
  const statusKey = (load.status ?? 'draft') as LoadStatus

  return (
    <Link
      href={`/loads/${load.load_number}`}
      className="block mb-8 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-orange/50"
    >
      <Card className={`hover:bg-surface-subtle transition-colors ${compact ? 'p-4' : 'p-6'}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-text-sec text-xs font-medium uppercase tracking-wide">{title}</span>
          <StatusBadge variant={loadStatusVariant(statusKey)} size="sm">
            {statusLabel(statusKey)}
          </StatusBadge>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className={`text-text-pri font-bold tracking-tight ${compact ? 'text-lg' : 'text-2xl'}`}>{load.load_number}</p>
            <p className="text-text-sec text-sm truncate">{route}</p>
          </div>
          {load.customer_name_raw && (
            <span className="text-text-sec text-sm max-w-[160px] truncate hidden sm:inline">{load.customer_name_raw}</span>
          )}
        </div>
      </Card>
    </Link>
  )
}
