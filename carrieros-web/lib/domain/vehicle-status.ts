// lib/domain/vehicle-status.ts
// Rule A of docs/architecture-principles.md — shared source for
// vehicles.status color mapping (schema.sql: active/idle/in_shop).
export type VehicleStatus = 'active' | 'idle' | 'in_shop'

export const VEHICLE_STATUSES: readonly VehicleStatus[] = ['active', 'idle', 'in_shop']

export function vehicleStatusColor(status: VehicleStatus): string {
  switch (status) {
    case 'active':
      return 'bg-[#16a34a]/20 text-[#16a34a]'
    case 'idle':
      return 'bg-slate-500/20 text-slate-400'
    case 'in_shop':
      return 'bg-amber-500/20 text-amber-400'
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}

export const VEHICLE_STATUS_COLOR: Record<string, string> = Object.fromEntries(
  VEHICLE_STATUSES.map(s => [s, vehicleStatusColor(s)])
)

// Maps to components/ui/StatusBadge.tsx's variant union — see
// load-status.ts's loadStatusVariant() for why this stays a hand-duplicated
// literal union rather than importing StatusBadgeVariant here.
export type StatusBadgeVariant =
  | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand' | 'teal' | 'purple'

export function vehicleStatusVariant(status: VehicleStatus): StatusBadgeVariant {
  switch (status) {
    case 'active':
      return 'success'
    case 'idle':
      return 'neutral'
    case 'in_shop':
      return 'warning'
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}
