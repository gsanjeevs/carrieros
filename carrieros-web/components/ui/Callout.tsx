// Core: `Callout` — mockup `.callout`, a soft tinted inline notice (plan-
// limit warnings, trial notices). The mockup itself is orange-only; this
// generalizes to the full status palette so it composes with
// success/warning/danger/info contexts too — mockup-06 separately hand-rolls
// a green trial-notice block that this same component now covers via
// `tone="success"`.
import type { ReactNode } from 'react'
import { cn } from './cn'

export type CalloutTone = 'orange' | 'success' | 'warning' | 'danger' | 'info'

export interface CalloutProps {
  tone?: CalloutTone
  icon?: ReactNode
  children: ReactNode
  className?: string
}

const TONE_CLASSES: Record<CalloutTone, string> = {
  orange: 'bg-brand-orange/10 border-brand-orange/25 text-brand-orange-light',
  success: 'bg-success/10 border-success/25 text-success',
  warning: 'bg-warning/10 border-warning/25 text-warning',
  danger: 'bg-danger/10 border-danger/25 text-danger',
  info: 'bg-info/10 border-info/25 text-info',
}

export default function Callout({ tone = 'orange', icon, children, className }: CalloutProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[11px] leading-relaxed',
        TONE_CLASSES[tone],
        className
      )}
    >
      {icon && (
        <span className="shrink-0 text-sm leading-none" aria-hidden="true">
          {icon}
        </span>
      )}
      <div>{children}</div>
    </div>
  )
}
