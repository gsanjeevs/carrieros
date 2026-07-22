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

// Uses the existing palette tokens already registered in globals.css's
// @theme block (bg-success-light/text-success-dark etc.) rather than the
// doc's literal one-off hex captures — per Core §1's non-negotiable #1
// (no raw hex in component code), a named token always wins over a
// hand-copied hex value, even where they differ by a shade.
const VARIANT_CLASSES: Record<StatusBadgeVariant, string> = {
  success: 'bg-success-light text-success-dark',
  warning: 'bg-warning-light text-warning-dark',
  danger: 'bg-danger-light text-danger-dark',
  info: 'bg-info-light text-info',
  // No dedicated "brand-light" token exists; reuses brand-orange at low
  // opacity, matching the tier-badge pattern already in §5.2/§6.3.
  brand: 'bg-brand-orange/15 text-brand-orange',
  teal: 'bg-teal/15 text-teal',
  // No dedicated "neutral" semantic token exists yet — bg-surface-subtle
  // (Core's "recessed/nested surface" role) is the closest available
  // semantic match for an unassigned/inactive chip, with a border added
  // for definition against a light-theme page background.
  neutral: 'bg-surface-subtle border border-border-ui text-text-sec',
  purple: 'bg-purple-light text-purple',
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
