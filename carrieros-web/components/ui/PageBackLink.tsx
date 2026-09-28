import Link from 'next/link'
import { cn } from './cn'

export interface PageBackLinkProps {
  /**
   * Origin path read back from a `?from=` search param (e.g. `/exceptions`),
   * as set by whatever list/summary page linked into this detail page. Only
   * honored when it looks like a same-app relative path — anything else
   * (missing, empty, absolute URL, protocol-relative `//host`) falls back to
   * `defaultHref` so a bookmarked/shared/refreshed detail-page URL with no
   * `from` never renders a broken or misleading link.
   */
  from?: string
  /** Human label for `from`, e.g. "Exceptions" — set by the linking page. */
  fromLabel?: string
  /** Sensible parent to fall back to when `from` is absent or untrusted. */
  defaultHref: string
  /** Label to pair with `defaultHref`, e.g. "Vehicles". */
  defaultLabel: string
  className?: string
}

function isSafeRelativePath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//')
}

/**
 * Back-navigation link for a detail page reached from more than one place
 * (list pages, the Exceptions inbox, etc.) — see the `from`/`fromLabel`
 * query-param convention this reads back. Renders "Back to <label>" pointing
 * at wherever the user actually came from, or the page's default parent list
 * when there's no (or an untrustworthy) `from` param.
 */
export default function PageBackLink({ from, fromLabel, defaultHref, defaultLabel, className }: PageBackLinkProps) {
  const useOrigin = !!from && isSafeRelativePath(from)
  const href = useOrigin ? from : defaultHref
  const label = useOrigin && fromLabel ? fromLabel : defaultLabel

  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-1.5 text-text-sec hover:text-text-pri transition rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50',
        className
      )}
    >
      <span className="material-symbols-outlined text-[20px]">arrow_back</span>
      <span className="text-sm font-medium">{label}</span>
    </Link>
  )
}
