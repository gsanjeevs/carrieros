// lib/support-triage.ts
// AI triage for in-app support tickets (decisions.md T16). Mirrors lib/extract-load.ts's structure
// exactly, per T6/T16's explicit "reuse the existing pattern" instruction: same transport (now
// lib/ai/'s provider abstraction, decisions.md T17), same "throw a typed error if the provider isn't
// configured" convention, structured output via a system prompt + JSON schema.
//
// What this decides, per ticket:
//   target_queue    — which HUMAN queue this belongs to, based on content: 'carrieros_support' (a
//                      CarrierOS product/platform question) or 'org_support' (a question about this
//                      carrier's own internal operations — pay, schedule, an internal policy — that
//                      only THEIR employer can actually answer). Forced to 'carrieros_support' when
//                      the org isn't Enterprise-entitled (org_support isn't a valid target at all
//                      below that tier — T16).
//   can_auto_resolve — true only for a common, low-stakes, factual product-usage question with a
//                      clear correct answer ("how do I do X", "where do I find Y"). The system
//                      prompt instructs the model to say false for anything about money, compliance,
//                      safety, account access/security, or anything ambiguous — and app code below
//                      enforces the money/compliance/safety half of that as a HARD override keyed off
//                      the user-picked category, rather than trusting the model alone for the
//                      highest-stakes categories (defense in depth: a prompt instruction can be wrong
//                      or drift after a model update; a category-keyed code check cannot).
//   confidence        — 0..1, the model's confidence in its own classification AND (when
//                      can_auto_resolve is true) that auto_answer fully and correctly resolves the
//                      question.
//   auto_answer       — required when can_auto_resolve is true; null otherwise.
//
// Confidence threshold reasoning (no prior calibration data to tune against, so this is a documented
// starting point, not a derived number): AI_RESOLVED_CONFIDENCE_THRESHOLD = 0.85. Set high and paired
// with the category hard-override above because T16's own framing is "trust AI if well setup... trust
// conditioned on the guardrail actually existing" — an auto-answer that turns out wrong on a billing
// or compliance question is a real support failure (and a compliance/legal exposure for a trucking
// SaaS), where a false negative (a human answers an easy question that AI could have handled) costs
// only a few minutes of staff time. Revisit downward only once real resolution-quality data exists.
import { getActiveLLMProvider, LLMCallError, LLMProviderNotConfiguredError } from '@/lib/ai'
import { logError, logEvent, type LogContext } from '@/lib/observability'

export const AI_RESOLVED_CONFIDENCE_THRESHOLD = 0.85

// Categories that must NEVER auto-resolve, regardless of what the model returns — money, compliance,
// and safety are explicitly called out in the task brief as "route anything remotely ambiguous or
// about money/compliance/safety to a human". Enforced here, not just in the prompt.
const NEVER_AUTO_RESOLVE_CATEGORIES = new Set(['account_billing', 'compliance_safety'])

export type SupportCategory =
  | 'technical_issue'
  | 'load_dispatch'
  | 'account_billing'
  | 'compliance_safety'
  | 'driver_pay_hr'
  | 'feature_request'
  | 'other'

export type SupportQueue = 'carrieros_support' | 'org_support' | 'ai_resolved'
export type HumanQueue = Exclude<SupportQueue, 'ai_resolved'>

export interface TriageInput {
  category: SupportCategory
  body: string
  relatedLoadNumber?: string | null
  submitterRole: string
  /** has_feature('support_desk') for the submitter's org — org_support is not a valid target at all when false (T16). */
  orgSupportEligible: boolean
}

export interface TriageResult {
  queue: SupportQueue
  /** The human queue this would route to / does route to on escalation. Always set (mirrors fallback_queue's DB semantics even for non-ai_resolved rows, where queue itself already equals it). */
  targetQueue: HumanQueue
  confidence: number
  autoAnswer: string | null
}

export class TriageFailedError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message)
  }
}

const SYSTEM_PROMPT = `You are a support-ticket triage assistant for CarrierOS, a SaaS product for small trucking carriers (1-5 trucks). You read one support ticket and classify it. Return ONLY valid JSON matching the schema below. Do not include any explanation or text outside the JSON.

Routing rule for target_queue:
- "org_support": the question is about this carrier's OWN internal operations — driver pay, work schedule, an internal company policy, a dispute with a coworker — something only the carrier's OWN management could actually answer, not CarrierOS.
- "carrieros_support": everything else — how the CarrierOS product works, a bug, a billing/subscription question about CarrierOS itself, a feature request, a compliance/safety question about using the app.
If org_support_eligible is false, you MUST still pick the queue the content actually belongs to (for logging/audit purposes) but understand it will be forced to carrieros_support by the caller regardless of your answer.

Routing rule for can_auto_resolve (be conservative — only true for a common, low-stakes, purely factual product-usage question with one clear correct answer, e.g. "how do I add a driver" or "where do I find my invoices"):
- ALWAYS false for anything touching money, billing, payments, compliance, safety (DVIR/HOS/CDL), account security/access, or legal/contractual matters.
- ALWAYS false if the ticket is ambiguous, emotional/frustrated in tone, describes a bug or data-loss, or you are not confident you have the full context to answer correctly.
- Only true when you can write a complete, correct, specific auto_answer yourself right now.

confidence is 0.0-1.0: your confidence in the queue classification, and (only relevant when can_auto_resolve is true) that auto_answer is fully correct.`

const SCHEMA = `{
  "target_queue": "carrieros_support" | "org_support",
  "can_auto_resolve": boolean,
  "confidence": number,        // 0.0 to 1.0
  "auto_answer": string | null // required (non-null) when can_auto_resolve is true, else null
}`

function buildUserMessage(input: TriageInput): string {
  const lines = [
    `Submitter role: ${input.submitterRole}`,
    `org_support_eligible: ${input.orgSupportEligible}`,
    `Ticket category: ${input.category}`,
    input.relatedLoadNumber ? `Related load number: ${input.relatedLoadNumber}` : null,
    ``,
    `Ticket body:`,
    input.body,
  ].filter((l): l is string => l !== null)

  return `Classify this support ticket. Return JSON matching this schema:\n${SCHEMA}\n\n${lines.join('\n')}`
}

export async function classifySupportTicket(
  input: TriageInput,
  logContext: LogContext
): Promise<TriageResult> {
  let provider: Awaited<ReturnType<typeof getActiveLLMProvider>>
  try {
    provider = await getActiveLLMProvider()
  } catch (err) {
    if (err instanceof LLMProviderNotConfiguredError) {
      throw new TriageFailedError(err.message, 500)
    }
    throw err
  }

  let result: Awaited<ReturnType<typeof provider.provider.call>>
  try {
    result = await provider.provider.call({
      model: provider.model,
      maxTokens: 1024,
      system: SYSTEM_PROMPT,
      userContent: buildUserMessage(input),
    })
  } catch (err) {
    const failureMode = err instanceof LLMCallError ? err.failureMode : 'unknown'
    const status = err instanceof LLMCallError ? err.status : undefined
    logError(logContext, err, { failure_mode: failureMode, status })
    throw new TriageFailedError('Triage classification failed. Please try again shortly.', 502)
  }

  const raw = result.text
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

  let parsed: { target_queue?: unknown; can_auto_resolve?: unknown; confidence?: unknown; auto_answer?: unknown }
  try {
    parsed = JSON.parse(cleaned)
  } catch (err) {
    logError(logContext, err, { failure_mode: 'malformed_model_output', raw_response_length: raw.length })
    throw new TriageFailedError('Triage classification failed.', 500)
  }

  logEvent(logContext, {
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
  })

  const modelTargetQueue: HumanQueue = parsed.target_queue === 'org_support' ? 'org_support' : 'carrieros_support'
  // org_support is not a valid routing target at all below Enterprise (T16) — forced regardless of
  // what the model returned, never just "trusted" from the classification call.
  const targetQueue: HumanQueue = input.orgSupportEligible ? modelTargetQueue : 'carrieros_support'

  const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
    ? Math.min(1, Math.max(0, parsed.confidence))
    : 0

  const modelWantsAutoResolve = parsed.can_auto_resolve === true && typeof parsed.auto_answer === 'string' && parsed.auto_answer.trim().length > 0
  const categoryAllowsAutoResolve = !NEVER_AUTO_RESOLVE_CATEGORIES.has(input.category)
  const canAutoResolve = modelWantsAutoResolve && categoryAllowsAutoResolve && confidence >= AI_RESOLVED_CONFIDENCE_THRESHOLD

  return {
    queue: canAutoResolve ? 'ai_resolved' : targetQueue,
    targetQueue,
    confidence,
    autoAnswer: canAutoResolve ? (parsed.auto_answer as string).trim() : null,
  }
}
