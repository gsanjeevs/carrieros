// Core: `ChecklistItem` — mockup `.checklist-item` / `.ci-check`, used by
// mockup-06's completion screen ("Company Info ✓", "Add Your First Load →")
// and generically anywhere a flow needs a done/active/pending checklist row.
import { cn } from './cn'

export type ChecklistItemState = 'done' | 'active' | 'pending'

export interface ChecklistItemProps {
  state: ChecklistItemState
  title: string
  sub?: string
  action?: { label: string; onClick: () => void }
  className?: string
}

const MARK_CLASSES: Record<ChecklistItemState, string> = {
  done: 'bg-success border-success text-white',
  active: 'bg-brand-orange border-brand-orange text-white',
  pending: 'border-white/20 text-transparent',
}

const ROW_CLASSES: Record<ChecklistItemState, string> = {
  done: 'border-success/25 bg-success/5',
  active: 'border-brand-orange/30 bg-brand-orange/5',
  pending: 'border-border-ui bg-surface-card opacity-60',
}

export default function ChecklistItem({ state, title, sub, action, className }: ChecklistItemProps) {
  return (
    <div className={cn('flex items-center gap-3 rounded-lg border px-3.5 py-3', ROW_CLASSES[state], className)}>
      <div
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[11px]',
          MARK_CLASSES[state]
        )}
        aria-hidden="true"
      >
        {state === 'done' ? '✓' : state === 'active' ? '→' : '•'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold text-text-pri">{title}</div>
        {sub && <div className="text-[11px] text-text-sec mt-0.5">{sub}</div>}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="shrink-0 text-xs font-semibold text-brand-orange hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/50 rounded"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
