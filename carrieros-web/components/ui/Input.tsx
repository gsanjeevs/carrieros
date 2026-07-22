'use client'

// Core: `Input` (text/select/textarea) — sizes sm, md; states default,
// focus, error, disabled, readonly (ux-foundations.md §3). Recipe:
// carrieros-design-system.md §5.6 (search/filter composition uses the same
// field styling this component centralizes).
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from './cn'

export type InputSize = 'sm' | 'md'

interface CommonProps {
  size?: InputSize
  error?: boolean
  errorMessage?: string
  className?: string
}

export type InputProps =
  | (CommonProps & { as?: 'input' } & Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>)
  | (CommonProps & { as: 'textarea' } & TextareaHTMLAttributes<HTMLTextAreaElement>)
  | (CommonProps & { as: 'select'; children?: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>)

const SIZE_CLASSES: Record<InputSize, string> = {
  md: 'px-3 py-1.5 text-[13px]',
  sm: 'px-2.5 py-1 text-[12px]',
}

export default function Input(props: InputProps) {
  const { as = 'input', size = 'md', error, errorMessage, className, ...rest } = props as CommonProps & {
    as?: 'input' | 'select' | 'textarea'
  } & Record<string, unknown>

  const fieldClassName = cn(
    'w-full bg-surface-input rounded-lg text-text-pri placeholder:text-text-mut border outline-none transition-colors',
    'focus:ring-2',
    error
      ? 'border-danger focus:border-danger focus:ring-danger/30'
      : 'border-border-ui focus:border-brand-orange focus:ring-brand-orange/20',
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
      {error && errorMessage && <span className="text-[11px] text-danger">{errorMessage}</span>}
    </div>
  )
}
