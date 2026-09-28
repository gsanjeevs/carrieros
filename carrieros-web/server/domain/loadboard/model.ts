// server/domain/loadboard/model.ts
// Read shape for a registered load-board vendor integration (Settings >
// Integrations > Load Board) and for a completed posting. Mirrors
// server/domain/telematics/model.ts's shape: the plaintext credential is
// never part of LoadboardIntegrationSummary -- only whether one is
// configured. Phase 1 supports exactly one provider (DAT, posting only, no
// search/booking) -- LOADBOARD_PROVIDERS is written the same way
// TELEMATICS_PROVIDERS is, so adding a second provider later is a one-line
// change plus a new migration, not a rewrite.
export const LOADBOARD_PROVIDERS = ['dat'] as const
export type LoadboardProvider = (typeof LOADBOARD_PROVIDERS)[number]

export function isLoadboardProvider(v: string): v is LoadboardProvider {
  return (LOADBOARD_PROVIDERS as readonly string[]).includes(v)
}

export interface LoadboardIntegrationSummary {
  readonly provider: LoadboardProvider
  readonly enabled: boolean
  readonly credentialConfigured: boolean
  readonly updatedAt: string
  readonly updatedBy: string | null
}

/** What a successful post to the vendor's load board returns. */
export interface LoadPostingResult {
  readonly externalPostingId: string
  readonly postedAt: string
}

/** An existing loadboard_postings row (the "already posted" record). */
export interface LoadboardPostingSummary {
  readonly loadId: number
  readonly provider: LoadboardProvider
  readonly externalPostingId: string
  readonly postedAt: string
  readonly postedBy: string | null
}
