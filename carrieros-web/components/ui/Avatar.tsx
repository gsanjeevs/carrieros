// Core: `Avatar` — variants circle (user), rounded-square (org); sizes sm
// (28px), md (32px), lg (40px); color assigned consistently per entity, not
// per-render random — ux-foundations.md §3. Recipe: carrieros-design-system.md
// §5.7 (px mapping + "additional color variants" palette).
import { cn } from './cn'

export type AvatarVariant = 'circle' | 'rounded-square'
export type AvatarSize = 'sm' | 'md' | 'lg'

export interface AvatarProps {
  initials: string
  variant?: AvatarVariant
  size?: AvatarSize
  /** Picks a fixed color from §5.7's "additional color variants" palette —
   * pass a stable value per entity (e.g. a hash of the entity id), never a
   * random number per render. */
  colorIndex?: number
  className?: string
}

const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: 'w-7 h-7 text-[11px]', // 28px
  md: 'w-8 h-8 text-xs', // 32px
  lg: 'w-10 h-10 text-sm', // 40px
}

// Default palette (bg-navy-light / text-avatar-text) plus §5.7's
// "additional color variants for visual distinction" — indexed so the same
// colorIndex always resolves to the same pair for a given entity.
const COLOR_VARIANTS = [
  'bg-navy-light text-avatar-text',
  'bg-[#1a3a2f] text-green-400',
  'bg-[#2a1f3a] text-purple-400',
  'bg-[#1a2f3a] text-blue-400',
  'bg-[#3a1f1f] text-red-400',
]

export default function Avatar({ initials, variant = 'circle', size = 'md', colorIndex = 0, className }: AvatarProps) {
  const colorClasses = COLOR_VARIANTS[Math.abs(colorIndex) % COLOR_VARIANTS.length]

  return (
    <div
      className={cn(
        'flex items-center justify-center flex-shrink-0 font-bold',
        variant === 'circle' ? 'rounded-full' : 'rounded-lg',
        SIZE_CLASSES[size],
        colorClasses,
        className
      )}
      aria-hidden="true"
    >
      {initials}
    </div>
  )
}
