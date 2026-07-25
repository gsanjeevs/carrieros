'use client'

// Core: `Button` — variants primary, secondary (outline), ghost, danger,
// success; sizes sm, md; states default/hover/focus/active/disabled/loading
// (ux-foundations.md §3). Recipes: carrieros-design-system.md §5.1.
//
// `secondary` (outline) has no existing CarrierOS recipe to copy — §5.1
// flags this as a documentation gap (only `ghost` exists in current
// mockup/code capture). The recipe below is originated here: a solid,
// opaque card-surface background with a heavier 2px border, deliberately
// distinct from `ghost`'s translucent single-px border over a dark
// backdrop.
import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-brand-orange text-white hover:bg-brand-orange/90 active:bg-brand-orange/80',
  // Originated recipe — see note above. Opaque bg-surface-card + a 2px
  // border (vs ghost's translucent 1px border) is the distinguishing
  // signal that makes this variant visually distinct from `ghost`.
  secondary:
    'bg-surface-card border-2 border-border-ui text-text-pri hover:border-brand-orange/60 hover:text-brand-orange active:bg-surface-subtle',
  // Translucent border over a colored/dark backdrop (§5.1). border-white/8
  // and text-slate-400 in the doc's literal recipe are the documented
  // "interim" classes for color-border / color-text-secondary (§1.3) — now
  // that Layer 3 semantic tokens exist (globals.css), swapped to their real
  // semantic classes here.
  ghost: 'bg-white/7 border border-border-ui text-text-sec hover:bg-white/12 hover:text-text-pri active:bg-white/16',
  danger: 'bg-danger/20 border border-danger/20 text-danger hover:bg-danger/30 active:bg-danger/40',
  success: 'bg-success/20 border border-success/20 text-success hover:bg-success/30 active:bg-success/40',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: 'px-3 py-1.5 text-xs',
  sm: 'px-2 py-1 text-[11px]',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading

  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        // rounded-lg (8px) matches the mockups' --radius-sm exactly — no new
        // token needed, Tailwind's stock 8px step already lines up. Was
        // rounded-md (6px) until the 2026-07-25 re-skin.
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-brand-orange/50',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
      {...rest}
    >
      {loading && (
        <span className="material-symbols-outlined animate-spin text-[15px] leading-none" aria-hidden="true">
          progress_activity
        </span>
      )}
      {children}
    </button>
  )
}
