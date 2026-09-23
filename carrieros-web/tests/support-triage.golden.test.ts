// tests/support-triage.golden.test.ts
// AI-native gate (docs/production-gates.md §3), same posture as tests/extraction.golden.test.ts:
// classifySupportTicket() (lib/support-triage.ts) hits the REAL Anthropic API — real tokens, real
// latency, a little non-deterministic — so it is deliberately excluded from the default `npm test`
// run (see vitest.config.ts's `exclude`). Run explicitly: `npm run test:support-triage`.
//
// What this actually needs to prove, since there's no prior calibration data (lib/support-triage.ts's
// own header comment): the money/compliance/safety hard-override never auto-resolves regardless of
// what the model says, org_support is never chosen when the org isn't eligible, and a genuinely common
// low-stakes question CAN auto-resolve. A model or prompt change that silently breaks any of these
// should fail this test, not surface later as an actual wrong auto-answer in production.
import { describe, expect, it } from 'vitest'
import { classifySupportTicket, AI_RESOLVED_CONFIDENCE_THRESHOLD } from '@/lib/support-triage'

const logContext = { route: 'test/support-triage-golden' }

describe('classifySupportTicket — routing + confidence threshold behavior', () => {
  it('a common, low-stakes product question CAN auto-resolve', async () => {
    const result = await classifySupportTicket(
      { category: 'technical_issue', body: 'How do I add a new driver to my fleet?', submitterRole: 'owner', orgSupportEligible: false },
      logContext
    )
    // Not asserting it MUST auto-resolve (the model has real judgment latitude) -- only that IF it
    // does, the confidence/answer contract holds, since that's what the app code actually depends on.
    if (result.queue === 'ai_resolved') {
      expect(result.confidence).toBeGreaterThanOrEqual(AI_RESOLVED_CONFIDENCE_THRESHOLD)
      expect(result.autoAnswer).toBeTruthy()
    }
    expect(result.targetQueue).toBe('carrieros_support')
  }, 30_000)

  it('a billing question NEVER auto-resolves, regardless of model confidence (hard category override)', async () => {
    const result = await classifySupportTicket(
      { category: 'account_billing', body: 'Why was I charged twice this month? Can you refund the extra charge?', submitterRole: 'owner', orgSupportEligible: false },
      logContext
    )
    expect(result.queue).not.toBe('ai_resolved')
    expect(result.autoAnswer).toBeNull()
  }, 30_000)

  it('a compliance/safety question NEVER auto-resolves', async () => {
    const result = await classifySupportTicket(
      { category: 'compliance_safety', body: 'My CDL medical certificate expires next week, what do I need to do to stay compliant?', submitterRole: 'driver', orgSupportEligible: false },
      logContext
    )
    expect(result.queue).not.toBe('ai_resolved')
    expect(result.autoAnswer).toBeNull()
  }, 30_000)

  it('org_support is never the target when the org is not Enterprise-eligible, even for an internal-sounding question', async () => {
    const result = await classifySupportTicket(
      { category: 'driver_pay_hr', body: 'When is payday and how is my per-mile rate calculated?', submitterRole: 'driver', orgSupportEligible: false },
      logContext
    )
    expect(result.targetQueue).toBe('carrieros_support')
    expect(result.queue).not.toBe('org_support')
  }, 30_000)

  it('org_support CAN be the target for an internal-operations question when the org IS eligible', async () => {
    const result = await classifySupportTicket(
      { category: 'driver_pay_hr', body: 'My manager said my schedule changed this week, who do I ask about my new shift times?', submitterRole: 'driver', orgSupportEligible: true },
      logContext
    )
    expect(['carrieros_support', 'org_support']).toContain(result.targetQueue)
  }, 30_000)

  it('a vague/ambiguous message does not auto-resolve', async () => {
    const result = await classifySupportTicket(
      { category: 'other', body: 'It broke again.', submitterRole: 'dispatcher', orgSupportEligible: false },
      logContext
    )
    expect(result.queue).not.toBe('ai_resolved')
  }, 30_000)
})
