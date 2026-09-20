// lib/api-client.ts
// Browser-side API client (generated runtime, see scripts/gen-api-client.ts).
// Same-origin: requests carry the session cookie, so no token is supplied.
import { createApiClient } from '@/lib/generated/api-client'

export const apiClient = createApiClient({ baseUrl: '' })
