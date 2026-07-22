'use client'

// Core: `EmptyState` — default (icon/illustration + message + optional CTA)
// — ux-foundations.md §3. No CarrierOS-specific recipe exists yet (§5.10).
// Composes the new `Button` component for its optional CTA.
import type { ReactNode } from 'react'
import { cn } from './cn'
import Button, { type ButtonProps } from './Button'

export interface EmptyStateProps {
  icon?: string
  title: string
  description?: ReactNode
  action?: {
    label: string
    onClick: () => void
    variant?: ButtonProps['variant']
  }
  className?: string
}

export default function EmptyState({ icon = 'inbox', title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center px-6 py-16', className)}>
      <div className="w-14 h-14 rounded-full bg-surface-subtle flex items-center justify-center mb-4">
        <span className="material-symbols-outlined text-[28px] text-text-mut" aria-hidden="true">
          {icon}
        </span>
      </div>
      <h3 className="text-sm font-bold text-text-pri">{title}</h3>
      {description && <p className="text-xs text-text-sec mt-1.5 max-w-xs">{description}</p>}
      {action && (
        <div className="mt-4">
          <Button variant={action.variant ?? 'primary'} size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        </div>
      )}
    </div>
  )
}
