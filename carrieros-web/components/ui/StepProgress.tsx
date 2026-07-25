// Core: `StepProgress` — mockup `.ob-progress` / `.ob-step-label`, a thin
// filled bar plus a "Step N of M" caption for onboarding-style multi-step
// flows. Distinct from `ProgressBar`: that component is a value/percent
// meter with success/warning/danger tones for measuring something (health,
// completeness); `StepProgress` always counts discrete steps and is always
// the brand orange.
import { cn } from './cn'

export interface StepProgressProps {
  /** 1-indexed current step. */
  current: number
  total: number
  /** Defaults to `Step {current} of {total}`. */
  label?: string
  labelPosition?: 'right' | 'center'
  className?: string
}

export default function StepProgress({ current, total, label, labelPosition = 'right', className }: StepProgressProps) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (current / total) * 100)) : 0

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={total}
        className="h-1 w-full rounded-full bg-white/10 overflow-hidden"
      >
        <div className="h-full rounded-full bg-brand-orange transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <div
        className={cn(
          'text-[10px] font-semibold text-text-sec',
          labelPosition === 'center' ? 'text-center' : 'text-right'
        )}
      >
        {label ?? `Step ${current} of ${total}`}
      </div>
    </div>
  )
}
