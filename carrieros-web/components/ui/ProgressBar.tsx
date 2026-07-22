// Core: `ProgressBar` / `HealthBar` — variants success, warning, danger
// (fill color by threshold), value 0-100 — ux-foundations.md §3. Recipe:
// carrieros-design-system.md §5.8.
import { cn } from './cn'

export type ProgressBarVariant = 'success' | 'warning' | 'danger'

export interface ProgressBarProps {
  value: number
  variant?: ProgressBarVariant
  /** Track/fill thickness — §5.8's health-score bar (1.5) vs. feature
   * adoption bar (1) both appear in the recipe; default to the thicker one. */
  thin?: boolean
  label?: string
  className?: string
}

const FILL_CLASSES: Record<ProgressBarVariant, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
}

export default function ProgressBar({ value, variant = 'success', thin = false, label, className }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value))

  return (
    <div
      className={cn('w-full rounded-full bg-white/10 overflow-hidden', thin ? 'h-1' : 'h-1.5', className)}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={cn('h-full rounded-full transition-all', FILL_CLASSES[variant])} style={{ width: `${clamped}%` }} />
    </div>
  )
}
