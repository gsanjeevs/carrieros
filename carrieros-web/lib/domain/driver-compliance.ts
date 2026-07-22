// lib/domain/driver-compliance.ts
// Rule A of docs/architecture-principles.md — shared source for the CDL-card
// glow-dot status. Consolidates an exact duplicate found during Wave 2 page
// migration (2026-07-22): app/(app)/drivers/page.tsx and
// app/(app)/drivers/[driver_number]/page.tsx each defined an identical
// cdlGlowStatus() (the driver detail page's own comment already flagged this
// as deliberate-for-now duplication from a since-resolved concurrent edit).
export function cdlGlowStatus(cdlExpiry: string | null): 'success' | 'warning' | 'danger' {
  if (!cdlExpiry) return 'danger'
  const daysUntil = (new Date(cdlExpiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  if (daysUntil < 0) return 'danger'
  if (daysUntil <= 30) return 'warning'
  return 'success'
}
