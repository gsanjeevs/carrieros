// server/infrastructure/loadboard/dat-client.ts
// Outbound gateway to DAT's load-board API. Phase 1 has no real DAT API
// credentials (a separate business/partnership step, not part of this
// build) -- DatClient is deliberately a narrow, abstract interface so that
// swapping MockDatClient for a real HTTP-backed implementation later needs
// no change at any caller (LoadboardPostingService only ever depends on the
// interface, wired in server/composition.ts).
//
// DAT's actual posting payload/auth shape (REST vs SOAP, OAuth vs API key,
// exact field names) is NOT guessed at here -- inventing that would be
// exactly the kind of "shipped against a spec that doesn't match the real
// API" risk Phase 1 exists to avoid. LoadPostPayload below carries only the
// load fields any freight-posting integration would obviously need
// (origin/destination/equipment/rate); a real client can reshape these into
// whatever DAT's actual request body requires without this interface
// changing.
import type { LoadPostingResult } from '@/server/domain/loadboard/model'
import type { DatClient, LoadPostPayload } from '@/server/ports'

/**
 * Deterministic fake success response -- no network call. Stands in for the
 * real DAT integration until a partnership/API-credential step (outside this
 * repo) produces actual DAT API access.
 *
 * TODO(real DAT integration): replace this class's body with an authenticated
 * HTTP call to DAT's load-posting endpoint once real credentials exist
 * (decrypted org apiKey, from LoadboardIntegrationRepository, is already
 * threaded through by LoadboardPostingService -- see its `postLoad` method).
 * Do not guess the request/response shape now; confirm it against DAT's own
 * API docs/sandbox when that credential exists.
 */
export class MockDatClient implements DatClient {
  async postLoad(payload: LoadPostPayload): Promise<LoadPostingResult> {
    return {
      externalPostingId: `dat-mock-${payload.loadId}-${Date.now()}`,
      postedAt: new Date().toISOString(),
    }
  }
}
