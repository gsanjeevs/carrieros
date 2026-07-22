// components/ExceptionChip.tsx
// Small colored pill surfacing a single live exception (from get_exceptions()
// via lib/exceptions.ts's getExceptions()) inline on a list-page row —
// vehicles/drivers/customers directories. Reuses the same tier -> semantic
// color mapping (TIER_COLOR) and icon as the full /exceptions inbox
// (app/(app)/exceptions/page.tsx) rather than inventing a second palette.
// item.title is the DB dev-fallback label (already short, e.g. "CDL
// expiring") — the exceptions inbox renders it unlocalized too, so this
// matches that established convention rather than introducing a separate
// per-exception-type message-catalog scheme just for this chip.
import { TIER_COLOR, type ExceptionItem } from '@/lib/exceptions'

export default function ExceptionChip({ item }: { item: ExceptionItem }) {
  const color = TIER_COLOR[item.tier]

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium whitespace-nowrap bg-${color}/15 text-${color}`}
      title={item.detail}
    >
      <span className="material-symbols-outlined text-[12px] leading-none">{item.icon}</span>
      {item.title}
    </span>
  )
}
