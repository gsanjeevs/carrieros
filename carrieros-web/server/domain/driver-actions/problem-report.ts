// server/domain/driver-actions/problem-report.ts
// A driver flagging a problem on a load. Stored in the existing Exceptions inbox
// (exception_events) so dispatch sees it beside every other exception. The reason
// is a CODE, not text: the inbox renders it in the reader's own language.
import { ok, err, validationFailed, type Result } from '../shared/result'

export const PROBLEM_REASONS = ['breakdown', 'traffic', 'weather', 'accident', 'customer_issue', 'other'] as const
export type ProblemReason = (typeof PROBLEM_REASONS)[number]

export interface ProblemReportDraft {
  readonly title: string
  readonly detail: string | null
}

export function buildProblemReport(reason: string, note?: string | null): Result<ProblemReportDraft> {
  if (!(PROBLEM_REASONS as readonly string[]).includes(reason)) {
    return err(validationFailed('Unknown problem reason', { reason: 'INVALID' }))
  }
  const detail = note?.trim() || null
  if (detail && detail.length > 1000) return err(validationFailed('Note is too long', { note: 'TOO_LONG' }))
  return ok({ title: `reason:${reason}`, detail })
}
