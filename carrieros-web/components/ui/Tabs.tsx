'use client'

// Core: `Tabs` (page-level underline) — states default, active, focus —
// ux-foundations.md §3. Recipe: carrieros-design-system.md §5.9 (second
// recipe — "within-page underline strip").
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface TabItem {
  value: string
  label: ReactNode
}

export interface TabsProps {
  items: TabItem[]
  value: string
  onChange: (value: string) => void
  className?: string
}

export default function Tabs({ items, value, onChange, className }: TabsProps) {
  return (
    <div role="tablist" className={cn('flex border-b border-divider-ui', className)}>
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'flex-1 py-2.5 px-2 text-[12px] font-semibold border-b-2 transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/50',
              active ? 'text-brand-orange border-brand-orange' : 'text-text-sec border-transparent hover:text-text-pri'
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
