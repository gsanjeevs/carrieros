// server/contract/openapi.ts
// Builds the OpenAPI 3.0 document from the endpoint registry. Pure function, no
// I/O, so the generator and the drift test can both call it.
import { z, type ZodType } from 'zod'
import { endpoints, type Endpoint } from './endpoints'
import { ErrorResponseSchema } from './schemas'

const toSchema = (schema: ZodType, io: 'input' | 'output' = 'output') =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', io, unrepresentable: 'any' }) as Record<string, unknown>

function parametersFor(where: 'query' | 'path' | 'header', schema: ZodType) {
  const json = toSchema(schema, 'input') as { properties?: Record<string, unknown>; required?: string[] }
  const required = new Set(json.required ?? [])
  return Object.entries(json.properties ?? {}).map(([name, propSchema]) => ({
    name,
    in: where,
    required: where === 'path' ? true : required.has(name),
    schema: propSchema,
  }))
}

function operationFor(e: Endpoint) {
  const errorSchema = toSchema(ErrorResponseSchema)
  const responses: Record<string, unknown> = e.stream
    ? { '200': { description: 'Server-sent events stream', content: { 'text/event-stream': { schema: { type: 'string' } } } } }
    : { '200': { description: 'OK', content: { 'application/json': { schema: toSchema(e.response) } } } }
  for (const status of e.errorStatuses) {
    responses[String(status)] = { description: 'Error', content: { 'application/json': { schema: errorSchema } } }
  }
  return {
    operationId: e.operationId,
    summary: e.summary,
    tags: [e.tag],
    ...(e.params || e.query || e.headers
      ? {
          parameters: [
            ...(e.params ? parametersFor('path', e.params) : []),
            ...(e.query ? parametersFor('query', e.query) : []),
            ...(e.headers ? parametersFor('header', e.headers) : []),
          ],
        }
      : {}),
    ...(e.body ? { requestBody: { required: true, content: { 'application/json': { schema: toSchema(e.body, 'input') } } } } : {}),
    responses,
  }
}

export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const e of endpoints) {
    paths[e.path] = { ...(paths[e.path] ?? {}), [e.method]: operationFor(e) }
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'CarrierOS API',
      version: '1.0.0',
      description: 'GENERATED from server/contract. Do not edit; run `npm run gen:api` in carrieros-web.',
    },
    paths,
  }
}
