// Core: `SectionTitle` — mockup `.section-title` (11px/700/1.5px-tracking
// uppercase, orange). Divides a form or panel into named groups — mockup-06's
// "Truck Added" heading above the truck `EntityCard`, for example.
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface SectionTitleProps {
  children: ReactNode
  className?: string
}

export default function SectionTitle({ children, className }: SectionTitleProps) {
  return (
    <div className={cn('text-[11px] font-bold uppercase tracking-[1.5px] text-brand-orange', className)}>
      {children}
    </div>
  )
}
