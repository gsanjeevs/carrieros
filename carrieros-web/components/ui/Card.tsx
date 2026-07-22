'use client'

// Core: `Card` — variants standard, interactive (clickable row), selectable
// (single-choice option card); states default, hover (interactive), focus
// (interactive), selected (selectable) — ux-foundations.md §3. Recipes:
// carrieros-design-system.md §5.3 (standard/interactive), §6.10
// (selectable, "Plan / Pricing Card").
import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react'
import { cn } from './cn'

export type CardVariant = 'standard' | 'interactive' | 'selectable'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
  selected?: boolean
  children?: ReactNode
}

export default function Card({
  variant = 'standard',
  selected = false,
  className,
  onClick,
  onKeyDown,
  children,
  ...rest
}: CardProps) {
  const isClickable = variant !== 'standard' && !!onClick

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(e)
    if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      ;(onClick as unknown as (ev: unknown) => void)?.(e)
    }
  }

  return (
    <div
      className={cn(
        'bg-surface-card border rounded-xl transition-colors',
        variant === 'standard' && 'border-border-ui overflow-hidden',
        variant === 'interactive' &&
          cn(
            'border-border-ui overflow-hidden cursor-pointer hover:bg-surface-subtle',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/50'
          ),
        variant === 'selectable' &&
          cn(
            'border-2 p-5 cursor-pointer transition-all',
            selected
              ? 'border-brand-orange shadow-[0_0_0_3px_rgba(249,115,22,0.12)]'
              : 'border-border-ui hover:border-brand-orange/40',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/50'
          ),
        className
      )}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-pressed={variant === 'selectable' ? selected : undefined}
      {...rest}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-5 py-3.5 border-b border-divider-ui flex items-center justify-between', className)}
      {...rest}
    >
      {children}
    </div>
  )
}

export function CardBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('px-5 py-4', className)} {...rest}>
      {children}
    </div>
  )
}
