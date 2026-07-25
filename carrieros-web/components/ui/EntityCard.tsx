// Core: `EntityCard` — mockup `.entity-card`, a compact summary row for "the
// thing you just added" (a truck, a customer) inside a multi-step flow, with
// a green confirmed border+check once saved. Distinct from `Card`:
// `EntityCard` is always an icon+name+sub summary of a single entity, never
// a generic container — reach for `Card` for anything else.
import type { MouseEventHandler, ReactNode } from 'react'
import { cn } from './cn'

export type EntityCardState = 'default' | 'confirmed'

export interface EntityCardProps {
  icon?: ReactNode
  name: string
  sub?: ReactNode
  state?: EntityCardState
  /** Custom trailing content — omit to get the default confirmed-check when
   * `state="confirmed"`. */
  trailing?: ReactNode
  onClick?: MouseEventHandler<HTMLDivElement>
  className?: string
}

export default function EntityCard({
  icon,
  name,
  sub,
  state = 'default',
  trailing,
  onClick,
  className,
}: EntityCardProps) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        'flex items-center gap-3 rounded-card border p-3.5 transition-colors',
        state === 'confirmed' ? 'border-success/30 bg-success/5' : 'border-border-ui bg-surface-card',
        onClick && 'cursor-pointer',
        className
      )}
    >
      {icon && (
        <span className="shrink-0 text-2xl leading-none" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-text-pri truncate">{name}</div>
        {sub && <div className="text-[11px] text-text-sec mt-0.5">{sub}</div>}
      </div>
      {trailing ??
        (state === 'confirmed' && (
          <span className="material-symbols-outlined text-success text-lg shrink-0" aria-hidden="true">
            check_circle
          </span>
        ))}
    </div>
  )
}
