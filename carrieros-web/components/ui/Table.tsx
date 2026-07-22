'use client'

// Core: `Table` — states default row, hover row, sorted-column header,
// bulk-select, sticky header (ux-foundations.md §3). Recipe:
// carrieros-design-system.md §5.5.
//
// Known gap (per §5.5's own note, carried forward here rather than
// silently "solved"): this implementation covers the base row/header/hover/
// sorted-header/numeric states. Pagination, bulk-select action bar, and the
// responsive card-collapse behavior Core's expanded matrix also calls for
// are NOT implemented — CarrierOS's current list pages don't have them
// either, so this component doesn't invent them speculatively. Add them
// here (not per-page) when a page actually needs them.
import type { ReactNode, ThHTMLAttributes, HTMLAttributes, TdHTMLAttributes } from 'react'
import { cn } from './cn'

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  children?: ReactNode
  /** Keeps the header visible on vertical scroll within the table's own
   * scroll container (Core §3's "Sticky header" state) — wrap the table in
   * a container with a bounded height/overflow-y for this to take effect. */
  stickyHeader?: boolean
}

export function Table({ className, children, stickyHeader, ...rest }: TableProps) {
  return (
    <div className={cn('overflow-x-auto', stickyHeader && 'overflow-y-auto')}>
      <table className={cn('w-full border-collapse', className)} {...rest}>
        {children}
      </table>
    </div>
  )
}

export interface TableHeaderCellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean
  /** Sorted-column header state (Core §3). `false`/omitted = not the
   * active sort column; 'asc'/'desc' = active, with the matching caret. */
  sorted?: false | 'asc' | 'desc'
  onSort?: () => void
  sticky?: boolean
}

export function TableHeaderCell({
  numeric,
  sorted = false,
  onSort,
  sticky,
  className,
  children,
  ...rest
}: TableHeaderCellProps) {
  const isSortable = !!onSort
  return (
    <th
      className={cn(
        'text-[10px] font-bold uppercase tracking-[0.08em] text-text-sec pb-2.5 px-3 border-b border-divider-ui',
        numeric ? 'text-right' : 'text-left',
        isSortable && 'cursor-pointer select-none hover:text-text-pri',
        sticky && 'sticky top-0 bg-surface-page z-10',
        className
      )}
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
      {...rest}
    >
      {isSortable ? (
        <button
          type="button"
          onClick={onSort}
          className="inline-flex items-center gap-0.5 uppercase tracking-[0.08em] font-bold text-inherit"
        >
          {children}
          {sorted && (
            <span className="material-symbols-outlined text-[13px] leading-none" aria-hidden="true">
              {sorted === 'asc' ? 'arrow_upward' : 'arrow_downward'}
            </span>
          )}
        </button>
      ) : (
        children
      )}
    </th>
  )
}

export function TableRow({ className, children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('hover:bg-white/[0.025] transition-colors', className)} {...rest}>
      {children}
    </tr>
  )
}

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean
}

export function TableCell({ numeric, className, children, ...rest }: TableCellProps) {
  return (
    <td
      className={cn(
        'py-2.5 px-3 text-[13px] text-text-pri border-b border-divider-ui last:border-b-0',
        numeric && 'text-right [font-variant-numeric:tabular-nums]',
        className
      )}
      {...rest}
    >
      {children}
    </td>
  )
}
