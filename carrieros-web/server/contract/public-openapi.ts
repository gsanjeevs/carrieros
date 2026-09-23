// server/contract/public-openapi.ts
// Builds the standalone OpenAPI 3.0 document for /api/public/v1 from
// public-endpoints.ts. Pure function, no I/O — same shape as
// server/contract/openapi.ts (the internal /api/v1 document), deliberately
// NOT extended from it: internal callers get a generated TypeScript client
// (openapi-typescript) because they are this repo's own web/mobile code;
// external developers are not TypeScript, so the OpenAPI JSON itself, served
// live at GET /api/public/v1/openapi.json, IS the deliverable — there is no
// second generated client for this document.
import { z, type ZodType } from 'zod'
import { publicEndpoints, PublicApiErrorResponseSchema, type PublicEndpoint } from './public-endpoints'
import { PUBLIC_API_TOKEN_TTL_SECONDS } from '@/lib/public-api-auth'

const toSchema = (schema: ZodType, io: 'input' | 'output' = 'output') =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', io, unrepresentable: 'any' }) as Record<string, unknown>

function parametersFor(where: 'query' | 'path', schema: ZodType) {
  const json = toSchema(schema, 'input') as { properties?: Record<string, unknown>; required?: string[] }
  const required = new Set(json.required ?? [])
  return Object.entries(json.properties ?? {}).map(([name, propSchema]) => ({
    name,
    in: where,
    required: where === 'path' ? true : required.has(name),
    schema: propSchema,
  }))
}

function operationFor(e: PublicEndpoint) {
  const errorSchema = toSchema(PublicApiErrorResponseSchema)
  const responses: Record<string, unknown> = {
    '200': { description: 'OK', content: { 'application/json': { schema: toSchema(e.response) } } },
  }
  for (const status of e.errorStatuses) {
    responses[String(status)] = { description: 'Error', content: { 'application/json': { schema: errorSchema } } }
  }
  return {
    operationId: e.operationId,
    summary: e.summary,
    tags: [e.tag],
    security: e.security === 'none' ? [] : [{ oauth2ClientCredentials: ['read'] }],
    ...(e.params || e.query
      ? {
          parameters: [
            ...(e.params ? parametersFor('path', e.params) : []),
            ...(e.query ? parametersFor('query', e.query) : []),
          ],
        }
      : {}),
    ...(e.body ? { requestBody: { required: true, content: { 'application/json': { schema: toSchema(e.body, 'input') } } } } : {}),
    responses,
  }
}

export function buildPublicOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const e of publicEndpoints) {
    paths[e.path] = { ...(paths[e.path] ?? {}), [e.method]: operationFor(e) }
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'CarrierOS Public API',
      version: '1.0.0',
      description:
        'GENERATED from server/contract/public-*.ts. Read-only in v1: loads and invoices. ' +
        'Authenticate with the OAuth 2.0 client-credentials grant (POST /api/public/v1/oauth/token), ' +
        'then send the returned access_token as `Authorization: Bearer <token>` on every other call. ' +
        'Requires a Growth-tier subscription or above.',
    },
    servers: [{ url: '/', description: 'This deployment' }],
    tags: [
      { name: 'auth', description: 'OAuth 2.0 client-credentials token exchange' },
      { name: 'loads', description: 'Read-only load data' },
      { name: 'invoices', description: 'Read-only invoice data' },
    ],
    components: {
      securitySchemes: {
        oauth2ClientCredentials: {
          type: 'oauth2',
          flows: {
            clientCredentials: {
              tokenUrl: '/api/public/v1/oauth/token',
              scopes: { read: `Read-only access. Tokens expire after ${PUBLIC_API_TOKEN_TTL_SECONDS} seconds.` },
            },
          },
        },
      },
    },
    paths,
  }
}
