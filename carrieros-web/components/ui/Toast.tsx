'use client'

// Core: `Toast` — variants success, warning, danger, info; states entering,
// visible, exiting — ux-foundations.md §3. Must use `role="status"` for
// success/info and `role="alert"` for danger/warning per Core §4's ARIA
// baseline. No CarrierOS recipe exists yet (§5.10) — this implementation
// follows Core's token roles directly.
//
// This is a single render-and-auto-dismiss component only, per the task
// scope — a full toast-manager/context (queueing, stacking, imperative
// `toast.success(...)` API) is out of scope here and is a real follow-up:
// today, a page that wants a toast renders <Toast> itself and controls its
// own `open` state.
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from './cn'

export type ToastVariant = 'success' | 'warning' | 'danger' | 'info'

export interface ToastProps {
  variant: ToastVariant
  open: boolean
  onClose: () => void
  children: ReactNode
  /** ms before auto-dismiss; pass 0 to disable auto-dismiss. */
  duration?: number
  className?: string
}

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: 'bg-success/15 border-success/30 text-success-dark',
  warning: 'bg-warning/15 border-warning/30 text-warning',
  danger: 'bg-danger/15 border-danger/30 text-danger',
  info: 'bg-info/15 border-info/30 text-info',
}

const VARIANT_ICON: Record<ToastVariant, string> = {
  success: 'check_circle',
  warning: 'warning',
  danger: 'error',
  info: 'info',
}

export default function Toast({ variant, open, onClose, children, duration = 5000, className }: ToastProps) {
  const t = useTranslations('common')
  useEffect(() => {
    if (!open || duration <= 0) return
    const timer = setTimeout(onClose, duration)
    return () => clearTimeout(timer)
  }, [open, duration, onClose])

  if (!open) return null

  const isAlert = variant === 'danger' || variant === 'warning'

  return (
    <div
      role={isAlert ? 'alert' : 'status'}
      aria-live={isAlert ? 'assertive' : 'polite'}
      className={cn(
        'fixed bottom-4 right-4 z-[1400] flex items-start gap-2.5 rounded-lg border px-4 py-3 shadow-[var(--shadow-hover)] max-w-sm',
        'bg-surface-card',
        VARIANT_CLASSES[variant],
        className
      )}
    >
      <span className="material-symbols-outlined text-[18px] leading-none flex-shrink-0" aria-hidden="true">
        {VARIANT_ICON[variant]}
      </span>
      <div className="flex-1 text-[13px] font-medium leading-snug">{children}</div>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('dismiss')}
        className="flex-shrink-0 text-current/70 hover:text-current focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/50 rounded"
      >
        <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">
          close
        </span>
      </button>
    </div>
  )
}
