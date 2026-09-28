// Core: `StatusBadge` — variants success, warning, danger, info, neutral,
// brand, teal, purple (8, ux-foundations.md §3); sizes sm, md; states
// default only, always `rounded-full`. Recipes: carrieros-design-system.md
// §5.2. Per Core §4's "never color alone" rule, `children` (a text label)
// is required — this component never renders color/an icon with no text.
import type { ReactNode } from 'react'
import { cn } from './cn'

export type StatusBadgeVariant =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  | 'brand'
  | 'teal'
  | 'purple'
export type StatusBadgeSize = 'sm' | 'md'

export interface StatusBadgeProps {
  variant: StatusBadgeVariant
  size?: StatusBadgeSize
  className?: string
  children: ReactNode
}

// Status variants use theme-aware semantic foreground/surface pairs so load,
// billing, health and document states keep readable meaning in both themes.
// Carrier brand/accent chips use contrast-resolved foregrounds.
const VARIANT_CLASSES: Record<StatusBadgeVariant, string> = {
  success: 'bg-status-success-surface text-status-success',
  warning: 'bg-status-warning-surface text-status-warning',
  danger: 'bg-status-danger-surface text-status-danger',
  info: 'bg-status-info-surface text-status-info',
  brand: 'bg-brand-orange text-brand-on-primary',
  teal: 'bg-teal text-brand-on-accent',
  neutral: 'bg-status-neutral-surface border border-border-ui text-status-neutral',
  purple: 'bg-status-purple-surface text-status-purple',
}

const SIZE_CLASSES: Record<StatusBadgeSize, string> = {
  md: 'px-2.5 py-0.5 text-[11px]',
  sm: 'px-2 py-0.5 text-[10px]',
}

export default function StatusBadge({ variant, size = 'md', className, children }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-semibold whitespace-nowrap',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
    >
      {children}
    </span>
  )
}
