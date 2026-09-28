import { cn } from './cn'

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'success'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-brand-orange text-brand-on-primary hover:bg-brand-orange/90 active:bg-brand-orange/80',
  accent: 'bg-teal text-brand-on-accent hover:bg-teal-hover active:bg-teal-hover/80',
  secondary:
    'bg-surface-card border-2 border-border-ui text-text-pri hover:border-brand-orange/60 hover:text-brand-orange active:bg-surface-subtle',
  ghost: 'bg-surface-subtle border border-border-ui text-text-sec hover:bg-surface-hover hover:text-text-pri active:bg-surface-hover',
  danger: 'bg-status-danger-surface border border-status-danger/25 text-status-danger hover:bg-status-danger-surface/80 active:bg-status-danger-surface/70',
  success: 'bg-success/20 border border-success/20 text-success hover:bg-success/30 active:bg-success/40',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  lg: 'px-4 py-2 text-sm',
  md: 'px-3 py-1.5 text-xs',
  sm: 'px-2 py-1 text-[11px]',
}

export function buttonClasses(variant: ButtonVariant, size: ButtonSize, className?: string): string {
  return cn(
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-brand-orange/50',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className
  )
}
