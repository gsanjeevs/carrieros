// Core: `Skeleton` (loading placeholder) — variants text, block, avatar;
// pulsing animation using `motion-duration-slow` — ux-foundations.md §3.
// No CarrierOS-specific recipe exists yet (§5.10) — this implementation
// uses the semantic surface token for the pulse fill.
import { cn } from './cn'

export type SkeletonVariant = 'text' | 'block' | 'avatar'

export interface SkeletonProps {
  variant?: SkeletonVariant
  /** Only meaningful for `text` — number of lines to render. */
  lines?: number
  className?: string
}

export default function Skeleton({ variant = 'block', lines = 1, className }: SkeletonProps) {
  if (variant === 'avatar') {
    return <div className={cn('w-8 h-8 rounded-full bg-surface-subtle animate-pulse', className)} aria-hidden="true" />
  }

  if (variant === 'text') {
    return (
      <div className="flex flex-col gap-1.5" aria-hidden="true">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-3 rounded bg-surface-subtle animate-pulse',
              i === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full',
              className
            )}
          />
        ))}
      </div>
    )
  }

  return <div className={cn('rounded-lg bg-surface-subtle animate-pulse', className)} aria-hidden="true" />
}
