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
import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonStyles'

export type { ButtonSize, ButtonVariant } from './buttonStyles'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
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
      className={buttonClasses(variant, size, className)}
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
