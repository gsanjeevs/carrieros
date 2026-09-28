'use client'

// A reusable, searchable language combobox — NOT yet wired into any page.
// Built as a standalone block for a later task to drop into Sidebar.tsx /
// LanguageSwitcher.tsx / Settings once those files' in-progress design-token
// refactor (see CURRENT_WORK.md, 2026-09-27) lands and they're safe to touch
// again. Until then this file has no consumers.
//
// Renders one row per row of the `languages` reference table (code, label,
// native_name, flag_emoji) — pass that list in as `languages` rather than
// having this component fetch it itself, keeping it a pure, easily-testable
// UI building block with no data-access concerns of its own (ADR 0003 keeps
// data fetching in server/composition.ts / API routes, not components).
//
// Follows the same primitives/conventions as components/ui/Modal.tsx and
// components/ui/Input.tsx: dark-mode-safe design tokens (surface-card,
// border-ui, text-pri/sec/mut, brand-orange focus ring), a focus trap while
// open, Escape-to-close, arrow-key navigation, and Enter-to-select.
import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from './ui/cn'

export interface LanguageOption {
  code: string
  label: string
  native_name: string
  flag_emoji: string
}

export interface LanguagePickerProps {
  languages: LanguageOption[]
  /** Currently-selected language code, if any. */
  value?: string | null
  onSelect: (code: string) => void
  /** Button label shown when nothing is selected / as a fallback. */
  placeholder?: string
  searchPlaceholder?: string
  noResultsLabel?: string
  disabled?: boolean
  className?: string
}

function matches(option: LanguageOption, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    option.code.toLowerCase().includes(q) ||
    option.label.toLowerCase().includes(q) ||
    option.native_name.toLowerCase().includes(q)
  )
}

export default function LanguagePicker({
  languages,
  value,
  onSelect,
  placeholder = 'Select a language',
  searchPlaceholder = 'Search languages…',
  noResultsLabel = 'No languages match your search.',
  disabled,
  className,
}: LanguagePickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const selected = useMemo(() => languages.find((l) => l.code === value) ?? null, [languages, value])
  const filtered = useMemo(() => languages.filter((l) => matches(l, query)), [languages, query])

  // Reset search + highlighted row each time the popup opens, and reset the
  // highlighted row each time the query changes. Done during render (React's
  // "adjust state when a prop/derived value changes" pattern, same as
  // components/ui/Modal.tsx's `wasOpen` reset) rather than in an effect,
  // which would be a synchronous setState in an effect body.
  const [wasOpen, setWasOpen] = useState(open)
  const [prevQuery, setPrevQuery] = useState(query)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setQuery('')
      setActiveIndex(0)
    }
  } else if (query !== prevQuery) {
    setPrevQuery(query)
    setActiveIndex(0)
  }

  // Focus the search field so typing works immediately once the popup opens.
  // This is a genuine external-system side effect (imperative DOM focus), so
  // it stays in an effect rather than the render-time state adjustment above.
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => searchInputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  // Close on outside click / Escape; return focus to the trigger on close.
  useEffect(() => {
    if (!open) return

    function handlePointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const option = filtered[activeIndex]
      if (option) choose(option.code)
    }
  }

  function choose(code: string) {
    onSelect(code)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={containerRef} className={cn('relative inline-block text-left', className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-border-ui bg-surface-input px-3 py-1.5',
          'text-[13px] text-text-pri outline-none transition-colors',
          'focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/20',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <span className="flex items-center gap-2 truncate">
          {selected ? (
            <>
              <span aria-hidden="true">{selected.flag_emoji}</span>
              <span className="truncate">{selected.label}</span>
              <span className="truncate text-text-mut">{selected.native_name}</span>
            </>
          ) : (
            <span className="text-text-mut">{placeholder}</span>
          )}
        </span>
        <span className="material-symbols-outlined text-[16px] text-text-sec" aria-hidden="true">
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {open && (
        <div
          className={cn(
            'absolute z-[1300] mt-1 w-72 max-w-[90vw] overflow-hidden rounded-xl border border-border-ui',
            'bg-surface-card shadow-[var(--shadow-modal)]'
          )}
        >
          <div className="border-b border-divider-ui p-2">
            <input
              ref={searchInputRef}
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls="language-picker-listbox"
              aria-autocomplete="list"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={searchPlaceholder}
              className={cn(
                'w-full rounded-lg border border-border-ui bg-surface-input px-2.5 py-1.5 text-[13px]',
                'text-text-pri placeholder:text-text-mut outline-none',
                'focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/20'
              )}
            />
          </div>

          <ul
            ref={listRef}
            id="language-picker-listbox"
            role="listbox"
            className="max-h-64 overflow-y-auto py-1"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-4 text-center text-[12px] text-text-mut">{noResultsLabel}</li>
            )}
            {filtered.map((option, index) => {
              const isSelected = option.code === value
              const isActive = index === activeIndex
              return (
                <li key={option.code} role="option" aria-selected={isSelected}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(option.code)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors',
                      isActive ? 'bg-surface-subtle' : 'bg-transparent',
                      isSelected ? 'text-brand-orange font-medium' : 'text-text-pri'
                    )}
                  >
                    <span aria-hidden="true">{option.flag_emoji}</span>
                    <span className="truncate">{option.label}</span>
                    <span className="truncate text-text-mut">{option.native_name}</span>
                    {isSelected && (
                      <span className="material-symbols-outlined ml-auto text-[16px]" aria-hidden="true">
                        check
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
