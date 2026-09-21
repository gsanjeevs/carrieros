// server/contract/public-endpoints.ts
// Registry of /api/public/v1 operations — the public developer API's own
// contract, kept separate from server/contract/endpoints.ts (internal
// /api/v1, consumed by web+mobile's generated TS client). External callers
// are not TypeScript, so there is no generated client for this registry —
// only a generated OpenAPI 3.x document (public-openapi.ts), served live at
// GET /api/public/v1/openapi.json.
import type { ZodType } from 'zod'
import {
  GetLoadResponseSchema,
  InvoiceDetailResponseSchema,
  InvoiceIdParamsSchema,
  ListInvoicesResponseSchema,
  ListLoadsResponseSchema,
  LoadIdParamsSchema,
} from './schemas'
import { PublicApiErrorResponseSchema, PublicListLoadsQuerySchema, TokenRequestBodySchema, TokenResponseSchema } from './public-schemas'

export interface PublicEndpoint {
  operationId: string
  method: 'get' | 'post'
  path: string
  summary: string
  tag: string
  params?: ZodType
  query?: ZodType
  body?: ZodType
  response: ZodType
  /** Extra status codes beyond 200, all shaped as PublicApiErrorResponseSchema. */
  errorStatuses: readonly number[]
  security?: 'none' | 'bearer'
}

export const publicEndpoints: readonly PublicEndpoint[] = [
  {
    operationId: 'createToken',
    method: 'post',
    path: '/api/public/v1/oauth/token',
    summary: 'Exchange a client_id/client_secret pair for a short-lived access token (OAuth 2.0 client-credentials grant)',
    tag: 'auth',
    body: TokenRequestBodySchema,
    response: TokenResponseSchema,
    errorStatuses: [400, 401, 403, 429],
    security: 'none',
  },
  {
    operationId: 'listLoads',
    method: 'get',
    path: '/api/public/v1/loads',
    summary: "List the organization's loads",
    tag: 'loads',
    query: PublicListLoadsQuerySchema,
    response: ListLoadsResponseSchema,
    errorStatuses: [401, 403, 429],
    security: 'bearer',
  },
  {
    operationId: 'getLoad',
    method: 'get',
    path: '/api/public/v1/loads/{id}',
    summary: 'Get one load, with its status timeline',
    tag: 'loads',
    params: LoadIdParamsSchema,
    response: GetLoadResponseSchema,
    errorStatuses: [401, 403, 404, 429],
    security: 'bearer',
  },
  {
    operationId: 'listInvoices',
    method: 'get',
    path: '/api/public/v1/invoices',
    summary: "List the organization's invoices",
    tag: 'invoices',
    response: ListInvoicesResponseSchema,
    errorStatuses: [401, 403, 429],
    security: 'bearer',
  },
  {
    operationId: 'getInvoice',
    method: 'get',
    path: '/api/public/v1/invoices/{id}',
    summary: 'Get one invoice',
    tag: 'invoices',
    params: InvoiceIdParamsSchema,
    response: InvoiceDetailResponseSchema,
    errorStatuses: [401, 403, 404, 429],
    security: 'bearer',
  },
]

export { PublicApiErrorResponseSchema }
