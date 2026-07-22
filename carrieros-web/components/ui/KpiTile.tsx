// Core: `KpiTile` — states default, loading (skeleton) — ux-foundations.md
// §3. Recipe: carrieros-design-system.md §5.3 (KpiTile grid) + §6.8 ("Delta
// Chips" for the change indicator, reused here as the `delta` prop).
import { cn } from './cn'

export type DeltaTone = 'success' | 'danger' | 'warning'

export interface KpiTileDelta {
  label: string
  tone: DeltaTone
}

export interface KpiTileProps {
  label: string
  value?: string | number
  delta?: KpiTileDelta
  helperText?: string
  loading?: boolean
  className?: string
}

const DELTA_CLASSES: Record<DeltaTone, string> = {
  success: 'bg-success/20 text-success-dark',
  danger: 'bg-danger/20 text-danger',
  warning: 'bg-warning/20 text-warning',
}

export default function KpiTile({ label, value, delta, helperText, loading = false, className }: KpiTileProps) {
  return (
    <div className={cn('bg-surface-card border border-border-ui rounded-xl px-5 py-4', className)}>
      <div className="text-[10px] font-bold tracking-[0.08em] uppercase text-text-sec mb-2">{label}</div>

      {loading ? (
        <div className="h-[26px] w-24 rounded bg-surface-subtle animate-pulse" aria-hidden="true" />
      ) : (
        <div className="text-[26px] font-extrabold tracking-tight text-text-pri [font-variant-numeric:tabular-nums] leading-none">
          {value}
        </div>
      )}

      {!loading && (delta || helperText) && (
        <div className="text-xs text-text-sec mt-1.5 flex items-center gap-1">
          {delta && (
            <span
              className={cn(
                'text-[11px] font-semibold px-1.5 py-0.5 rounded inline-flex items-center gap-0.5',
                DELTA_CLASSES[delta.tone]
              )}
            >
              {delta.label}
            </span>
          )}
          {helperText}
        </div>
      )}

      {loading && (
        <div className="mt-1.5 h-3 w-20 rounded bg-surface-subtle animate-pulse" aria-hidden="true" />
      )}
    </div>
  )
}
