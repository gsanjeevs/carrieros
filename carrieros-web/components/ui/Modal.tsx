'use client'

// Core: `Modal` / `Dialog` — sizes sm, md, lg; states entering, visible,
// exiting — ux-foundations.md §3. Must trap focus while open and return
// focus to the triggering element on close (Core §4 ARIA baseline), and
// support the destructive-action confirmation pattern from Core §7 (a
// `confirm-destructive` variant requiring a typed confirmation phrase for
// the highest-risk tier before its confirm action enables).
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from './cn'
import Button from './Button'

export type ModalSize = 'sm' | 'md' | 'lg'
export type ModalVariant = 'default' | 'confirm-destructive'

export interface ModalProps {
  open: boolean
  onClose: () => void
  size?: ModalSize
  title?: ReactNode
  children?: ReactNode
  /** Custom footer content — omit to get the default Cancel/Confirm pair. */
  footer?: ReactNode
  variant?: ModalVariant
  /** confirm-destructive only: the exact phrase the user must type (e.g.
   * the entity's own name, per Core §7's highest-risk-tier requirement)
   * before the confirm button enables. */
  confirmPhrase?: string
  confirmLabel?: string
  onConfirm?: () => void
  className?: string
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

export default function Modal({
  open,
  onClose,
  size = 'md',
  title,
  children,
  footer,
  variant = 'default',
  confirmPhrase,
  confirmLabel = 'Confirm',
  onConfirm,
  className,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const [typedPhrase, setTypedPhrase] = useState('')

  // Focus trap + return focus to the trigger on close (Core §4 ARIA baseline).
  useEffect(() => {
    if (!open) return

    previouslyFocused.current = document.activeElement as HTMLElement | null
    const node = dialogRef.current
    const initialFocusable = node?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    initialFocusable?.[0]?.focus()

    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab' || !node) return

      const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused.current?.focus()
    }
  }, [open, onClose])

  useEffect(() => {
    if (open) setTypedPhrase('')
  }, [open])

  if (!open) return null

  const isConfirmDestructive = variant === 'confirm-destructive'
  const confirmDisabled = isConfirmDestructive && !!confirmPhrase && typedPhrase !== confirmPhrase

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        className={cn(
          'relative w-full bg-surface-card border border-border-ui rounded-2xl shadow-[var(--shadow-modal)] overflow-hidden',
          SIZE_CLASSES[size],
          className
        )}
      >
        {title && (
          <div className="px-5 py-4 border-b border-divider-ui flex items-center justify-between">
            <h2 id="modal-title" className="text-sm font-bold text-text-pri">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-text-sec hover:text-text-pri focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/50 rounded"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                close
              </span>
            </button>
          </div>
        )}

        <div className="px-5 py-4">
          {children}

          {isConfirmDestructive && confirmPhrase && (
            <div className="mt-4">
              <label htmlFor="modal-confirm-phrase" className="block text-xs font-medium text-text-sec mb-1.5">
                Type &ldquo;{confirmPhrase}&rdquo; to confirm
              </label>
              <input
                id="modal-confirm-phrase"
                value={typedPhrase}
                onChange={(e) => setTypedPhrase(e.target.value)}
                className="w-full bg-surface-input border border-border-ui rounded-lg px-3 py-1.5 text-[13px] text-text-pri outline-none focus:border-danger focus:ring-2 focus:ring-danger/20"
                autoComplete="off"
              />
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-divider-ui flex items-center justify-end gap-2">
          {footer ?? (
            <>
              <Button variant="secondary" size="sm" onClick={onClose}>
                Cancel
              </Button>
              {onConfirm && (
                <Button
                  variant={isConfirmDestructive ? 'danger' : 'primary'}
                  size="sm"
                  disabled={confirmDisabled}
                  onClick={onConfirm}
                >
                  {confirmLabel}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
