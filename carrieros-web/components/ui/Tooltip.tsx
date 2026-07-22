'use client'

// Core: `Tooltip` — states entering, visible, exiting — ux-foundations.md
// §3. Simple hover/focus-triggered tooltip (no dedicated CarrierOS recipe
// exists yet — §5.10 notes Tooltip has no mockup-derived recipe; this
// implementation follows Core's token roles directly).
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface TooltipProps {
  content: ReactNode
  children: ReactNode
  className?: string
}

export default function Tooltip({ content, children, className }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const id = useId()

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      <span aria-describedby={visible ? id : undefined}>{children}</span>
      <span
        role="tooltip"
        id={id}
        className={cn(
          'pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-[1500]',
          'whitespace-nowrap rounded-md bg-navy text-white text-[11px] font-medium px-2 py-1',
          'transition-opacity duration-150',
          visible ? 'opacity-100' : 'opacity-0'
        )}
      >
        {content}
      </span>
    </span>
  )
}
