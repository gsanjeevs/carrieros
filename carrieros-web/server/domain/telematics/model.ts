// server/domain/telematics/model.ts
// Read shape for a registered telematics vendor integration (Settings >
// Integrations > Telematics). The plaintext credential is never part of
// TelematicsIntegrationSummary -- only whether one is configured, mirroring
// WebhookSummary's secretPreview convention, but without even a preview
// (T17-style "no reveal affordance anywhere" posture, since this credential
// is read back for outbound calls/signature verification, not just signed
// with once like webhooks.secret).
export const TELEMATICS_PROVIDERS = ['samsara', 'motive'] as const
export type TelematicsProvider = (typeof TELEMATICS_PROVIDERS)[number]

export function isTelematicsProvider(v: string): v is TelematicsProvider {
  return (TELEMATICS_PROVIDERS as readonly string[]).includes(v)
}

export interface TelematicsIntegrationSummary {
  readonly provider: TelematicsProvider
  readonly enabled: boolean
  readonly credentialConfigured: boolean
  readonly updatedAt: string
  readonly updatedBy: string | null
}
