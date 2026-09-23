// server/contract/public-schemas.ts
// Shapes unique to /api/public/v1 — the OAuth token exchange and its error
// envelope. Everything else (loads, invoices) reuses the SAME record shapes
// already defined in ./schemas: the data is identical, only the auth
// boundary differs. See public-openapi.ts for how the two are combined into
// one standalone document.
import { z } from 'zod'

export const TokenRequestBodySchema = z.object({
  grant_type: z.literal('client_credentials'),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
})

export const TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int(),
})

// RFC 6749 §5.2-flavored error envelope, shared by every /api/public/v1 route (not just /oauth/token) so
// an external integration parses one error shape for this whole surface.
export const PublicApiErrorResponseSchema = z.object({
  error: z.string(),
  error_description: z.string(),
})

export const PublicListLoadsQuerySchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
})
