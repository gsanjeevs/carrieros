import Link from 'next/link'
import type { ComponentProps } from 'react'
import { cn } from './cn'

export interface FilterLinkProps extends ComponentProps<typeof Link> {
  active?: boolean
}

/** Query/route filter chip with a shared active and inactive treatment. */
export default function FilterLink({ active = false, className, ...rest }: FilterLinkProps) {
  return (
    <Link
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/50',
        active
          ? 'border-brand-orange bg-brand-orange text-brand-on-primary'
          : 'border-border-ui bg-surface-subtle text-text-sec hover:bg-surface-subtle/70 hover:text-text-pri',
        className
      )}
      aria-current={active ? 'page' : undefined}
      {...rest}
    />
  )
}
