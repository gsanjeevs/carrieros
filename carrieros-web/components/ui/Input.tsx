'use client'

// Core: `Input` (text/select/textarea) — sizes sm, md, lg; states default,
// filled, focus, error, disabled, readonly (ux-foundations.md §3). Recipe:
// carrieros-design-system.md §5.6 (search/filter composition uses the same
// field styling this component centralizes).
//
// `lg` and `state="filled"` added in the mockup-06 re-skin (2026-07-25) to
// absorb 17 local `inputCls` string constants across 15 files, all of which
// used `px-3 py-2.5 text-[13px]` — a DIFFERENT size than this component's
// existing `md` (`px-3 py-1.5`). Adding `lg` rather than changing `md` keeps
// this a purely additive change for the 14 pre-existing `md` consumers; see
// docs/decisions.md V6/re-skin notes for why the two weren't reconciled.
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from './cn'

export type InputSize = 'sm' | 'md' | 'lg'
export type FieldState = 'default' | 'filled' | 'error'

interface CommonProps {
  size?: InputSize
  /** Mockup-06 `.field-input.filled` — a green border/tint that reads as
   * "this field is valid," distinct from `error`. `error` (below) remains a
   * back-compat boolean alias for `state="error"` — existing call sites
   * that pass `error` keep working unchanged. */
  state?: FieldState
  error?: boolean
  errorMessage?: string
  className?: string
}

export type InputProps =
  | (CommonProps & { as?: 'input' } & Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>)
  | (CommonProps & { as: 'textarea' } & TextareaHTMLAttributes<HTMLTextAreaElement>)
  | (CommonProps & { as: 'select'; children?: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>)

const SIZE_CLASSES: Record<InputSize, string> = {
  lg: 'px-3 py-2.5 text-[13px]', // mockup-06 .field-input
  md: 'px-3 py-1.5 text-[13px]',
  sm: 'px-2.5 py-1 text-[12px]',
}

export default function Input(props: InputProps) {
  const {
    as = 'input',
    size = 'md',
    state,
    error,
    errorMessage,
    className,
    ...rest
  } = props as CommonProps & {
    as?: 'input' | 'select' | 'textarea'
  } & Record<string, unknown>

  const resolvedState: FieldState = error ? 'error' : (state ?? 'default')
  const isError = resolvedState === 'error'

  const fieldClassName = cn(
    'w-full bg-surface-input rounded-lg text-text-pri placeholder:text-text-mut border outline-none transition-colors',
    'focus:ring-2',
    isError && 'border-danger focus:border-danger focus:ring-danger/30',
    // filled: mockup-06's "this value is valid" green treatment. Focus still
    // takes over on top of it (matches the mockup: a filled field being
    // actively edited shows the orange focus ring, not the green one).
    resolvedState === 'filled' &&
      'border-success/35 bg-success/5 focus:border-brand-orange/50 focus:bg-brand-orange/5 focus:ring-brand-orange/20',
    resolvedState === 'default' && 'border-border-ui focus:border-brand-orange focus:ring-brand-orange/20',
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-surface-subtle',
    'read-only:bg-surface-subtle read-only:cursor-default',
    as === 'select' && 'cursor-pointer',
    SIZE_CLASSES[size],
    className
  )

  let field: ReactNode
  if (as === 'textarea') {
    field = <textarea className={fieldClassName} {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)} />
  } else if (as === 'select') {
    field = <select className={fieldClassName} {...(rest as SelectHTMLAttributes<HTMLSelectElement>)} />
  } else {
    field = <input className={fieldClassName} {...(rest as InputHTMLAttributes<HTMLInputElement>)} />
  }

  return (
    <div className="flex flex-col gap-1">
      {field}
      {isError && errorMessage && <span className="text-[11px] text-danger">{errorMessage}</span>}
    </div>
  )
}
