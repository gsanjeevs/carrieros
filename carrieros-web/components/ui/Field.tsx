// Core: `Field` — the Label/Field wrapper mockup-06's `.field-label` /
// `.field-hint` pattern needs and that never existed as a shared component.
// That absence is why 17 local `labelCls`/`inputCls` string constants
// accumulated across 15 files (re-skin audit, 2026-07-25) — everyone wrote
// their own instead of importing one. Wraps a single form control; does not
// render the control itself (pass an `Input`/`select`/etc as `children`) so
// it composes with anything rather than replacing `Input`.
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface FieldProps {
  label: string
  /** Renders the mockup's orange required-marker after the label. */
  required?: boolean
  hint?: string
  error?: string
  htmlFor?: string
  className?: string
  children: ReactNode
}

export default function Field({ label, required, hint, error, htmlFor, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-2xs font-bold uppercase tracking-[1px] text-text-sec">
        {label}
        {required && <span className="text-brand-orange"> *</span>}
      </label>
      {children}
      {error ? (
        <span className="text-[11px] text-danger">{error}</span>
      ) : hint ? (
        <span className="text-[11px] text-text-mut">{hint}</span>
      ) : null}
    </div>
  )
}
