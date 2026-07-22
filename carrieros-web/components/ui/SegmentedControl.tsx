'use client'

// Core: `SegmentedControl` — states default, active — ux-foundations.md §3.
// Recipe: carrieros-design-system.md §5.9 (first recipe — "grouped pill
// filter").
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface SegmentedControlItem {
  value: string
  label: ReactNode
  count?: number
}

export interface SegmentedControlProps {
  items: SegmentedControlItem[]
  value: string
  onChange: (value: string) => void
  className?: string
}

export default function SegmentedControl({ items, value, onChange, className }: SegmentedControlProps) {
  return (
    <div
      role="radiogroup"
      className={cn('flex gap-0.5 bg-surface-card border border-border-ui rounded-lg p-0.5 w-fit', className)}
    >
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'px-3.5 py-1.5 rounded-md text-[12px] transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/50',
              active ? 'font-semibold bg-navy text-white' : 'font-medium text-text-sec hover:text-text-pri'
            )}
          >
            {item.label}
            {item.count !== undefined && <span className="text-[10px] ml-1 opacity-65">{item.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
